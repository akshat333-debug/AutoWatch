import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { summarize } from "@/lib/inngest/summarize";
import { alertOnFailure } from "@/lib/inngest/alert-on-failure";
import { checkStalled } from "@/lib/inngest/check-stalled";
import { dailyDigest } from "@/lib/inngest/daily-digest";
import { retentionPurge } from "@/lib/inngest/retention-purge";

// Inngest function registration endpoint.
// GET  — Inngest dev server / cloud discovery
// POST — Inngest invokes registered functions
// PUT  — sync / health check
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [summarize, alertOnFailure, checkStalled, dailyDigest, retentionPurge],
});
