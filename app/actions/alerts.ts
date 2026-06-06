"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// ── Resolve alert ─────────────────────────────────────────────────────────────
// Marks an alert as resolved. Uses the RLS-scoped client so the user can only
// resolve alerts that belong to their own org.

export async function resolveAlert(alertId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("alerts")
    .update({ resolved: true })
    .eq("id", alertId);

  if (error) {
    throw new Error(`Failed to resolve alert: ${error.message}`);
  }

  revalidatePath("/dashboard/alerts");
}
