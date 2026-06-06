"use server";

import { randomBytes } from "crypto";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const CreateEndpointSchema = z.object({
  label: z.string().min(1, "Label is required").max(100, "Label too long"),
  source: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.enum(["zapier", "make", "n8n", "custom"]).optional()
  ),
  expected_interval_seconds: z.preprocess(
    (v) => {
      if (v === "" || v === null || v === undefined) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    },
    z.number().int().positive().nullable()
  ),
});

export type CreateEndpointState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      endpointId: string;
      signingSecret: string;
      webhookUrl: string;
      label: string;
    };

export async function createEndpoint(
  _prevState: CreateEndpointState,
  formData: FormData
): Promise<CreateEndpointState> {
  const parsed = CreateEndpointSchema.safeParse({
    label: formData.get("label"),
    source: formData.get("source"),
    expected_interval_seconds: formData.get("expected_interval_seconds"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "error", message: "Not authenticated" };
  }

  const { data: member } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single();

  if (!member) {
    return { status: "error", message: "No organisation found" };
  }

  const endpointKey = randomBytes(32).toString("hex");
  const signingSecret = randomBytes(32).toString("hex");

  const { data: endpoint, error } = await supabase
    .from("endpoints")
    .insert({
      org_id: member.org_id,
      label: parsed.data.label,
      endpoint_key: endpointKey,
      signing_secret: signingSecret,
      source: parsed.data.source ?? null,
      expected_interval_seconds: parsed.data.expected_interval_seconds,
    })
    .select("id")
    .single();

  if (error || !endpoint) {
    return { status: "error", message: "Failed to create endpoint. Please try again." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    status: "success",
    endpointId: endpoint.id,
    signingSecret,
    webhookUrl: `${siteUrl}/api/ingest/${endpointKey}`,
    label: parsed.data.label,
  };
}
