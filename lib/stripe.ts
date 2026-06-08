import "server-only";
import Stripe from "stripe";

// ── Singleton Stripe client ────────────────────────────────────────────────────

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("[stripe] STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: Stripe.API_VERSION,
    });
  }
  return _stripe;
}

// ── Plan definitions ──────────────────────────────────────────────────────────
// quota must stay in sync with orgs.monthly_event_quota defaults in SCHEMA.md.

export const PLANS = {
  free: { name: "Free", quota: 500, price: null },
  starter: { name: "Starter", quota: 5_000, price: "$9" },
  pro: { name: "Pro", quota: 50_000, price: "$29" },
} as const;

export type PlanKey = keyof typeof PLANS;

export function getPriceId(plan: "starter" | "pro"): string {
  const envKey =
    plan === "starter" ? "STRIPE_STARTER_PRICE_ID" : "STRIPE_PRO_PRICE_ID";
  const id = process.env[envKey];
  if (!id) throw new Error(`[stripe] ${envKey} is not set`);
  return id;
}

export function planFromPriceId(priceId: string | undefined): PlanKey {
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return "starter";
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  return "free";
}
