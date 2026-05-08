import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const check = (key: string | undefined) =>
    key && key !== "placeholder" ? "configured" : "missing";

  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  let llama = "unavailable";
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json() as { models?: { name: string }[] };
      const hasVision = data.models?.some((m) => m.name.includes("llama3.2-vision")) ?? false;
      llama = hasVision ? "configured" : "model_not_pulled";
    }
  } catch { llama = "unavailable"; }

  return res.json({
    claude: check(process.env.ANTHROPIC_API_KEY),
    gemini: check(process.env.GOOGLE_API_KEY),
    mistral: check(process.env.AI_GATEWAY_API_KEY),
    llama,
  });
}
