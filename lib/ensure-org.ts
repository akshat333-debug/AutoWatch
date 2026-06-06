import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Called once per new user after their first login.
// Creates an org + org_members row if none exists.
export async function ensureOrgForUser(userId: string, email: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (existing) return;

  const orgName = email.split("@")[0] ?? "My Org";

  const { data: org, error: orgError } = await supabaseAdmin
    .from("orgs")
    .insert({ name: orgName })
    .select("id")
    .single();

  if (orgError || !org) {
    throw new Error(`Failed to create org: ${orgError?.message}`);
  }

  const { error: memberError } = await supabaseAdmin
    .from("org_members")
    .insert({ org_id: org.id, user_id: userId, role: "owner" });

  if (memberError) {
    throw new Error(`Failed to create org_members: ${memberError.message}`);
  }
}
