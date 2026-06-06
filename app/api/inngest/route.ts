import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { summarize } from "@/lib/inngest/summarize";

// Inngest function registration endpoint.
// GET  — Inngest dev server / cloud discovery
// POST — Inngest invokes registered functions
// PUT  — sync / health check
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [summarize],
});
