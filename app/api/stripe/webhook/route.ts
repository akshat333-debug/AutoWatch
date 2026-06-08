import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, planFromPriceId, PLANS } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Use Node.js runtime so Buffer + crypto are available.
export const runtime = "nodejs";
// Never cache this route or pre-render it.
export const dynamic = "force-dynamic";

// ── POST /api/stripe/webhook ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.text(); // raw body for signature verification
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe/webhook] signature verification failed:", msg);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${msg}` },
      { status: 400 }
    );
  }

  try {
    await handleEvent(event);
  } catch (err) {
    // Log the error but return 200 so Stripe doesn't retry forever.
    // Persistent issues should be investigated via Stripe dashboard.
    console.error("[stripe/webhook] unhandled error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return;

      const orgId =
        (session.metadata?.org_id as string | undefined) ??
        (session.client_reference_id as string | null) ??
        null;
      if (!orgId) {
        console.error("[stripe/webhook] checkout.session.completed: no org_id");
        return;
      }

      // Retrieve full subscription object (session.subscription may be string ID)
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) return;

      const sub = await getStripe().subscriptions.retrieve(subId);
      await upsertSubscription(orgId, session.customer as string, sub);
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId = await orgIdFromCustomer(sub.customer as string);
      if (!orgId) return;
      await upsertSubscription(orgId, sub.customer as string, sub);
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      // Try org_id from subscription metadata first (most reliable)
      const orgIdFromMeta = sub.metadata?.org_id as string | undefined;
      const orgId = orgIdFromMeta ?? (await orgIdFromCustomer(sub.customer as string));
      if (!orgId) return;
      await downgradeToFree(orgId, sub.customer as string, sub.id);
      break;
    }

    case "invoice.payment_failed": {
      // Update status so the UI can warn the user; don't downgrade yet —
      // Stripe will retry and emit subscription.updated with status=past_due.
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId) return;
      const orgId = await orgIdFromCustomer(customerId);
      if (!orgId) return;
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "past_due", updated_at: new Date().toISOString() })
        .eq("org_id", orgId);
      break;
    }

    default:
      // Unhandled event type — ignore silently.
      break;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function orgIdFromCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("org_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.org_id ?? null;
}

async function upsertSubscription(
  orgId: string,
  customerId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const priceId = sub.items.data[0]?.price.id;
  const plan = planFromPriceId(priceId);
  const quota = PLANS[plan].quota;

  // In Stripe API 2026-05-27+, current_period_end moved to
  // billing_schedules[0].bill_until.computed_timestamp (Unix timestamp).
  const periodEndTs = sub.billing_schedules?.[0]?.bill_until?.computed_timestamp;
  const currentPeriodEnd = periodEndTs
    ? new Date(periodEndTs * 1000).toISOString()
    : null;

  await Promise.all([
    supabaseAdmin.from("subscriptions").upsert(
      {
        org_id: orgId,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        plan,
        status: sub.status,
        current_period_end: currentPeriodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" }
    ),
    supabaseAdmin
      .from("orgs")
      .update({ plan, monthly_event_quota: quota })
      .eq("id", orgId),
  ]);
}

async function downgradeToFree(
  orgId: string,
  customerId: string,
  subscriptionId: string
): Promise<void> {
  await Promise.all([
    supabaseAdmin.from("subscriptions").upsert(
      {
        org_id: orgId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        plan: "free",
        status: "canceled",
        current_period_end: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" }
    ),
    supabaseAdmin
      .from("orgs")
      .update({ plan: "free", monthly_event_quota: PLANS.free.quota })
      .eq("id", orgId),
  ]);
}
