import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Server-only: ANTHROPIC_API_KEY must never reach the client bundle.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model constants — per CLAUDE.md hard rules:
//   Haiku 4.5  → per-event summaries (cost)
//   Sonnet 4.6 → daily digest via Batch API (Phase 6)
export const MODEL_SUMMARY = "claude-haiku-4-5" as const;
export const MODEL_DIGEST = "claude-sonnet-4-6" as const;
