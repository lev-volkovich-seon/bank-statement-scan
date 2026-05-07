import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const check = (key: string | undefined) =>
    key && key !== "placeholder" ? "configured" : "missing";

  return res.json({
    claude: check(process.env.ANTHROPIC_API_KEY),
    gemini: check(process.env.GOOGLE_API_KEY),
    mistral: check(process.env.AI_GATEWAY_API_KEY),
  });
}
