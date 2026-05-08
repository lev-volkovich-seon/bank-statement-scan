import express from "express";
import path from "path";
import type { Request, Response } from "express";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import extractHandler from "./api/extract";
import healthHandler from "./api/health";

const app = express();
const PORT = process.env.PORT || 3000;

function wrap(handler: (req: VercelRequest, res: VercelResponse) => any) {
  return (req: Request, res: Response) => handler(req as any, res as any);
}

app.post("/api/extract", wrap(extractHandler));
app.get("/api/health", wrap(healthHandler));

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
