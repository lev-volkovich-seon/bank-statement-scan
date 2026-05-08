import { generateText, gateway } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Ollama } from "ollama";
import { OAuth2Client } from "google-auth-library";
import formidable from "formidable";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { api: { bodyParser: false } };

const GOOGLE_CLIENT_ID =
  "339298080830-o4su9baqe0i5m4s7mg6hu4ofnceklm0r.apps.googleusercontent.com";
const ALLOWED_DOMAIN = "@seon.io";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROVIDERS = ["claude", "gemini", "mistral", "llama"];

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(process.cwd(), "prompts/v1_0_0.txt"),
  "utf-8"
);

const authClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ── Helpers ──────────────────────────────────────────────────────────────────

function rfc7807(
  res: VercelResponse,
  status: number,
  title: string,
  detail: string,
  instance = `/v1/extractions/bank-deposit/req_${uuidv4().split("-")[0]}`
) {
  return res.status(status).json({
    type: `https://api.seon.com/errors/${title.toLowerCase().replace(/ /g, "-")}`,
    title,
    status,
    detail,
    instance,
  });
}

function getModel(provider: string) {
  switch (provider) {
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY })("gemini-2.5-flash");
    case "mistral":
      return gateway("mistral/pixtral-large-latest");
    case "llama":
      return null as any; // handled via Ollama Cloud native client
    default:
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })("claude-sonnet-4-6");
  }
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  return JSON.parse(cleaned);
}

// ── Verification ──────────────────────────────────────────────────────────────

function runVerification(
  fields: Record<string, unknown>,
  expectedAmount?: number,
  expectedAccount?: string,
  sessionRef?: string
): Record<string, unknown> | null {
  if (!expectedAmount && !expectedAccount && !sessionRef) return null;

  const result: Record<string, unknown> = {};
  let checksRun = 0;
  let checksPassed = 0;

  if (expectedAmount !== undefined) {
    checksRun++;
    const extracted = (fields?.amounts as any)?.transfer_amount?.value;
    const match =
      extracted != null && Math.abs(Number(extracted) - expectedAmount) <= 0.01;
    result.amount_match = match;
    if (match) checksPassed++;
  }

  if (expectedAccount) {
    checksRun++;
    const extracted = (
      ((fields?.recipient_account as any)?.value as string) || ""
    )
      .replace(/\s/g, "")
      .toLowerCase();
    const match = extracted === expectedAccount.replace(/\s/g, "").toLowerCase();
    result.recipient_account_match = match;
    if (match) checksPassed++;
  }

  if (sessionRef) {
    checksRun++;
    const extracted = (
      ((fields?.payment_description as any)?.value as string) || ""
    )
      .trim()
      .toLowerCase();
    const match = extracted === sessionRef.trim().toLowerCase();
    result.session_reference_match = match;
    if (match) checksPassed++;
  }

  result.overall =
    checksRun === 0
      ? "null"
      : checksPassed === checksRun
      ? "pass"
      : checksPassed === 0
      ? "fail"
      : "partial";

  return result;
}

function computeReviewRequired(
  document: Record<string, unknown>,
  fields: Record<string, unknown>,
  warnings: string[],
  verification: Record<string, unknown> | null,
  status: string
): boolean {
  if (status === "rejected") return true;
  if (((document?.confidence as number) ?? 1) < 0.85) return true;
  if (((fields?.amounts as any)?.transfer_amount?.confidence ?? 1) < 0.8) return true;
  if (((fields?.reference_number as any)?.confidence ?? 1) < 0.8) return true;
  if (warnings.length >= 3) return true;
  if (verification) {
    for (const [key, val] of Object.entries(verification)) {
      if (key !== "overall" && val === false) return true;
    }
  }
  return false;
}

// ── Ollama Cloud ─────────────────────────────────────────────────────────────

async function ollamaCloudGenerate(imageBytes: Buffer): Promise<string> {
  const ollama = new Ollama({
    host: "https://ollama.com",
    headers: { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` },
  });
  const response = await ollama.chat({
    model: "gemma4:31b",
    stream: false,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: "Extract the data from this bank deposit screenshot.", images: [imageBytes.toString("base64")] },
    ],
  });
  return response.message.content;
}

// ── Single-provider extraction ────────────────────────────────────────────────

async function extractSingle(
  provider: string,
  imageBytes: Buffer,
  expectedAmount: number | undefined,
  expectedAccount: string | undefined,
  sessionRef: string | undefined
): Promise<Record<string, unknown>> {
  const startMs = Date.now();

  const text = provider === "llama"
    ? await ollamaCloudGenerate(imageBytes)
    : await generateText({
        model: getModel(provider),
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: imageBytes },
              { type: "text", text: "Extract the data from this bank deposit screenshot." },
            ],
          },
        ],
        maxOutputTokens: 4096,
      }).then((r) => r.text);

  const processingTimeMs = Date.now() - startMs;
  const modelResponse = parseJson(text);
  const status = (modelResponse.status as string) || "success";
  const metadata = { prompt_version: "1.0.0", processing_time_ms: processingTimeMs };

  if (status === "rejected") {
    return {
      status: "rejected",
      metadata,
      reason: modelResponse.reason || "not_a_bank_document",
      review_required: true,
    };
  }

  const fields = (modelResponse.fields as Record<string, unknown>) || {};
  const document = (modelResponse.document as Record<string, unknown>) || {};
  const warnings = (modelResponse.warnings as string[]) || [];
  const verification = runVerification(fields, expectedAmount, expectedAccount, sessionRef);
  const reviewRequired = computeReviewRequired(document, fields, warnings, verification, status);

  return { status, metadata, document, fields, verification, warnings, review_required: reviewRequired };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const instance = `/v1/extractions/bank-deposit/req_${uuidv4().split("-")[0]}`;

  // ── Google SSO auth ──
  const auth = (req.headers.authorization as string) || "";
  if (!auth.startsWith("Bearer "))
    return rfc7807(res, 401, "Unauthorized", "Missing Authorization header.", instance);

  const idToken = auth.slice(7).trim();
  try {
    const ticket = await authClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const email = ticket.getPayload()?.email || "";
    if (!email.endsWith(ALLOWED_DOMAIN))
      return rfc7807(res, 403, "Forbidden", `Access restricted to ${ALLOWED_DOMAIN} accounts.`, instance);
  } catch {
    return rfc7807(res, 401, "Unauthorized", "Invalid or expired Google ID token.", instance);
  }

  // ── Parse multipart form ──
  const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
  let formFields: formidable.Fields;
  let files: formidable.Files;
  try {
    [formFields, files] = await form.parse(req);
  } catch {
    return rfc7807(res, 400, "Invalid Request", "Failed to parse multipart form data.", instance);
  }

  const imageFile = Array.isArray(files.image) ? files.image[0] : files.image;
  if (!imageFile)
    return rfc7807(res, 400, "Invalid Request", "Missing required field: image.", instance);

  const mimeType = imageFile.mimetype || "";
  if (!ALLOWED_MIME.has(mimeType))
    return rfc7807(res, 400, "Invalid Request", `Unsupported image type '${mimeType}'. Use JPEG, PNG, or WEBP.`, instance);

  const imageBytes = fs.readFileSync(imageFile.filepath);

  // ── Provider ──
  const provider = ((req.query.provider as string) || "claude").toLowerCase();
  if (provider !== "all" && !PROVIDERS.includes(provider))
    return rfc7807(res, 400, "Invalid Request", `Unknown provider '${provider}'. Use: claude, gemini, mistral, all`, instance);

  // ── Shared verification params ──
  const expectedAmount = formFields.expected_amount
    ? parseFloat(String(Array.isArray(formFields.expected_amount) ? formFields.expected_amount[0] : formFields.expected_amount))
    : undefined;
  const expectedAccount = formFields.expected_recipient_account
    ? String(Array.isArray(formFields.expected_recipient_account) ? formFields.expected_recipient_account[0] : formFields.expected_recipient_account)
    : undefined;
  const sessionRef = formFields.session_reference
    ? String(Array.isArray(formFields.session_reference) ? formFields.session_reference[0] : formFields.session_reference)
    : undefined;

  const extractionId = uuidv4();
  const wallStart = Date.now();

  // ── All providers in parallel ──
  if (provider === "all") {
    try {
      const settled = await Promise.allSettled(
        PROVIDERS.map(p => extractSingle(p, imageBytes, expectedAmount, expectedAccount, sessionRef))
      );

      const results: Record<string, unknown> = {};
      for (let i = 0; i < PROVIDERS.length; i++) {
        const s = settled[i];
        if (s.status === "fulfilled") {
          results[PROVIDERS[i]] = s.value;
        } else {
          const e = s.reason;
          results[PROVIDERS[i]] = {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            error_detail: e instanceof Error ? {
              name: e.name,
              statusCode: (e as any).statusCode,
              url: (e as any).url,
              responseBody: (e as any).responseBody,
            } : undefined,
          };
        }
      }

      return res.json({
        extraction_id: extractionId,
        status: "all",
        metadata: { prompt_version: "1.0.0", processing_time_ms: Date.now() - wallStart },
        results,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return rfc7807(res, 500, "Internal Server Error", msg, instance);
    }
  }

  // ── Single provider ──
  try {
    const result = await extractSingle(provider, imageBytes, expectedAmount, expectedAccount, sessionRef);
    return res.json({ extraction_id: extractionId, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error ? {
      name: (err as any).name,
      statusCode: (err as any).statusCode,
      url: (err as any).url,
      responseBody: (err as any).responseBody,
    } : undefined;
    return res.status(500).json({
      type: `https://api.seon.com/errors/internal-server-error`,
      title: "Internal Server Error",
      status: 500,
      detail: msg,
      error_detail: detail,
      instance,
    });
  }
}
