import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PLANS, type PlanKey } from "@/lib/stripe";
import {
  createCheckoutSession,
  createBillingPortalSession,
} from "@/app/actions/billing";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ upgraded?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  // ── Fetch org + subscription + usage ──────────────────────────────────────
  const { data: member } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .single();
  if (!member) redirect("/login");

  const startOfMonth = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
  ).toISOString();

  const [{ data: org }, { data: sub }, { count: usedCount }] =
    await Promise.all([
      supabase
        .from("orgs")
        .select("plan, monthly_event_quota")
        .eq("id", member.org_id)
        .single(),
      supabase
        .from("subscriptions")
        .select("plan, status, current_period_end, stripe_customer_id")
        .eq("org_id", member.org_id)
        .maybeSingle(),
      supabase
        .from("events")
        .select("*", { count: "exact", head: true })
        .eq("org_id", member.org_id)
        .gte("occurred_at", startOfMonth),
    ]);

  const currentPlan = (org?.plan ?? "free") as PlanKey;
  const quota = org?.monthly_event_quota ?? 500;
  const used = usedCount ?? 0;
  const usedPct = Math.min(100, Math.round((used / quota) * 100));

  // A user is "paying" if they have an active Stripe subscription.
  const isPaying =
    sub?.status === "active" && currentPlan !== "free";

  const renewalDate = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your plan and billing.
        </p>
      </div>

      {/* Success banner */}
      {params.upgraded && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800/40 dark:bg-green-950/30 dark:text-green-400">
          ✓ Subscription activated — thank you! Your quota has been updated.
        </div>
      )}

      {/* Plan + usage */}
      <section className="rounded-lg border p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Current plan</h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              {PLANS[currentPlan]?.name ?? currentPlan}
              {sub?.status === "past_due" && (
                <span className="ml-2 text-xs text-destructive font-medium">
                  (payment past due)
                </span>
              )}
            </p>
          </div>
          {renewalDate && (
            <p className="text-xs text-muted-foreground shrink-0">
              Renews {renewalDate}
            </p>
          )}
        </div>

        {/* Usage bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Events this month</span>
            <span>
              {used.toLocaleString()} / {quota.toLocaleString()}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usedPct >= 90
                  ? "bg-destructive"
                  : usedPct >= 70
                    ? "bg-yellow-500"
                    : "bg-primary"
              }`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          {usedPct >= 90 && (
            <p className="text-xs text-destructive">
              You&apos;re near your monthly limit — upgrade to avoid drops.
            </p>
          )}
        </div>
      </section>

      {/* Upgrade cards (shown to free users) */}
      {!isPaying && (
        <section className="rounded-lg border p-6 space-y-5">
          <div>
            <h2 className="font-medium">Upgrade your plan</h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              More events, longer retention, and richer reporting.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <PlanCard
              name="Starter"
              price="$9"
              period="month"
              features={[
                "5,000 events / month",
                "Email failure & stall alerts",
                "30-day retention",
              ]}
              action={
                <form
                  action={async () => {
                    "use server";
                    await createCheckoutSession("starter");
                  }}
                >
                  <button
                    type="submit"
                    className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Upgrade to Starter
                  </button>
                </form>
              }
            />
            <PlanCard
              name="Pro"
              price="$29"
              period="month"
              highlight
              features={[
                "50,000 events / month",
                "Alerts + daily digest email",
                "90-day retention",
                "PDF compliance export",
              ]}
              action={
                <form
                  action={async () => {
                    "use server";
                    await createCheckoutSession("pro");
                  }}
                >
                  <button
                    type="submit"
                    className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Upgrade to Pro
                  </button>
                </form>
              }
            />
          </div>
        </section>
      )}

      {/* Billing portal (shown to paying users) */}
      {isPaying && (
        <section className="rounded-lg border p-6 space-y-3">
          <h2 className="font-medium">Billing</h2>
          <p className="text-muted-foreground text-sm">
            Update your payment method, view invoices, or cancel your
            subscription.
          </p>
          <form
            action={async () => {
              "use server";
              await createBillingPortalSession();
            }}
          >
            <button
              type="submit"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Open Billing Portal →
            </button>
          </form>
        </section>
      )}

      {/* PDF export — Pro only */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium flex items-center gap-2">
              Export
              {currentPlan !== "pro" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Pro
                </span>
              )}
            </h2>
            <p className="text-muted-foreground text-sm mt-0.5">
              Download a PDF of your automation events for any date range.
            </p>
          </div>
        </div>

        {currentPlan === "pro" ? (
          <ExportForm />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Upgrade to Pro to unlock PDF compliance exports.
          </p>
        )}
      </section>

      {/* Account */}
      <section className="rounded-lg border p-6 space-y-2">
        <h2 className="font-medium">Account</h2>
        <p className="text-sm text-muted-foreground">{user.email}</p>
      </section>
    </div>
  );
}

// ── Export form component ─────────────────────────────────────────────────────
// A plain GET form — the browser navigates to /api/export?from=...&to=...
// which returns a PDF download. No JS needed; works with session cookies.

function ExportForm() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  return (
    <form
      method="GET"
      action="/api/export"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="export-from" className="text-xs text-muted-foreground">
          From
        </label>
        <input
          id="export-from"
          type="date"
          name="from"
          defaultValue={thirtyDaysAgo}
          max={today}
          required
          className="rounded-md border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="export-to" className="text-xs text-muted-foreground">
          To
        </label>
        <input
          id="export-to"
          type="date"
          name="to"
          defaultValue={today}
          max={today}
          required
          className="rounded-md border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Download PDF
      </button>
    </form>
  );
}

// ── Plan card component ───────────────────────────────────────────────────────

function PlanCard({
  name,
  price,
  period,
  features,
  highlight,
  action,
}: {
  name: string;
  price: string;
  period: string;
  features: string[];
  highlight?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-5 flex flex-col gap-4 ${
        highlight ? "border-primary/50 bg-primary/5" : ""
      }`}
    >
      <div>
        <h3 className="font-semibold">{name}</h3>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-bold">{price}</span>
          <span className="text-muted-foreground text-sm">/{period}</span>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <span className="text-primary shrink-0">✓</span>
            {f}
          </li>
        ))}
      </ul>
      {action}
    </div>
  );
}
