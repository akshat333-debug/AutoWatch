import "server-only";
import { GoogleGenAI } from "@google/genai";

// Server-only: GEMINI_API_KEY must never reach the client bundle.
export const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Model constants — per CLAUDE.md cost rule, per-event work uses a cheap
// Flash-tier model, never a Pro-tier model.
//   Flash-Lite → per-event summaries. Cheapest tier; highest free-tier daily
//                quota (500 RPD / 15 RPM) of the available models, which is the
//                binding constraint for a per-event pipeline.
//   3.5 Flash  → daily digest (Phase 6) — once-daily, so low RPD is fine.
export const MODEL_SUMMARY = "gemini-3.1-flash-lite" as const;
export const MODEL_DIGEST = "gemini-3.5-flash" as const;
