"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getStripe, getPriceId } from "@/lib/stripe";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrgAndCustomer() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single();
  if (!member) redirect("/login");

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("org_id", member.org_id)
    .maybeSingle();

  return { user, orgId: member.org_id, customerId: sub?.stripe_customer_id ?? null };
}

// ── Stripe Checkout ───────────────────────────────────────────────────────────
// Creates a hosted Checkout session and redirects to Stripe.
// Uses existing Stripe customer when available (prevents creating duplicates).

export async function createCheckoutSession(
  plan: "starter" | "pro"
): Promise<void> {
  const { user, orgId, customerId } = await getOrgAndCustomer();
  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{ price: getPriceId(plan), quantity: 1 }],
    // If we already have a customer, re-use it; otherwise let Stripe create one.
    ...(customerId
      ? { customer: customerId }
      : { customer_email: user.email }),
    // client_reference_id lets the webhook find the org without a DB lookup.
    client_reference_id: orgId,
    metadata: { org_id: orgId },
    success_url: `${siteUrl}/dashboard/settings?upgraded=1`,
    cancel_url: `${siteUrl}/dashboard/settings`,
    subscription_data: {
      metadata: { org_id: orgId },
    },
  });

  redirect(session.url!);
}

// ── Stripe Billing Portal ─────────────────────────────────────────────────────
// Redirects the user to the Stripe-hosted portal to manage/cancel their sub.

export async function createBillingPortalSession(): Promise<void> {
  const { orgId, customerId } = await getOrgAndCustomer();

  if (!customerId) {
    // No Stripe customer yet — shouldn't be reachable from the UI, but guard.
    redirect(`/dashboard/settings`);
  }

  const stripe = getStripe();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${siteUrl}/dashboard/settings`,
  });

  // Suppress unused-variable warning — orgId is destructured for auth check.
  void orgId;

  redirect(portalSession.url);
}
