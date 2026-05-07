import { generateText, gateway } from "ai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MODELS = [
  "mistral/pixtral-large-2409",
  "mistral/pixtral-large-latest",
  "mistral/pixtral-12b-2409",
];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const results: Record<string, unknown> = {};

  for (const model of MODELS) {
    try {
      const { text } = await generateText({
        model: gateway(model),
        prompt: 'Say "ok".',
        maxOutputTokens: 10,
      });
      results[model] = { ok: true, text };
    } catch (e: any) {
      results[model] = {
        ok: false,
        message: e.message,
        statusCode: e.statusCode,
        responseBody: e.responseBody,
      };
    }
  }

  return res.json(results);
}
