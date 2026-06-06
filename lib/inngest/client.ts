import { Inngest } from "inngest";

// Single Inngest client for the whole app.
// INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY are picked up from the environment
// automatically by the Inngest SDK.
export const inngest = new Inngest({ id: "autowatch" });
