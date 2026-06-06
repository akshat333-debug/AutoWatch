import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAlert } from "@/app/actions/alerts";

type AlertRow = {
  id: string;
  kind: string;
  message: string;
  severity: string;
  resolved: boolean | null;
  created_at: string | null;
  endpoints: { label: string } | null;
};

export default async function AlertsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch last 100 alerts (most recent first), open + resolved, joined to endpoint label.
  const { data: alerts } = await supabase
    .from("alerts")
    .select("id, kind, message, severity, resolved, created_at, endpoints(label)")
    .order("created_at", { ascending: false })
    .limit(100);

  const typedAlerts = (alerts ?? []) as AlertRow[];
  const openAlerts = typedAlerts.filter((a) => !a.resolved);
  const resolvedAlerts = typedAlerts.filter((a) => a.resolved);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Failures and stalled automations will appear here.
        </p>
      </div>

      {openAlerts.length === 0 && resolvedAlerts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {openAlerts.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Open · {openAlerts.length}
              </h2>
              <div className="divide-y rounded-lg border">
                {openAlerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            </section>
          )}

          {resolvedAlerts.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Resolved
              </h2>
              <div className="divide-y rounded-lg border opacity-60">
                {resolvedAlerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: AlertRow }) {
  const { icon, label, colorClass } = getKindMeta(alert.kind);
  const { dot, severityClass } = getSeverityMeta(alert.severity);
  const isResolved = !!alert.resolved;

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1 space-y-1">
        {/* Kind + severity + endpoint badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
          >
            {icon} {label}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityClass}`}
          >
            {dot} {capitalise(alert.severity)}
          </span>
          {alert.endpoints?.label && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {alert.endpoints.label}
            </span>
          )}
        </div>

        {/* Message */}
        <p className="text-sm text-foreground">{alert.message}</p>
      </div>

      {/* Right side: timestamp + resolve button */}
      <div className="shrink-0 flex flex-col items-end gap-2">
        <time
          dateTime={alert.created_at ?? ""}
          className="text-xs text-muted-foreground tabular-nums"
          title={
            alert.created_at ? new Date(alert.created_at).toISOString() : ""
          }
        >
          {formatRelative(alert.created_at)}
        </time>

        {!isResolved && (
          <form
            action={async () => {
              "use server";
              await resolveAlert(alert.id);
            }}
          >
            <button
              type="submit"
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Resolve
            </button>
          </form>
        )}

        {isResolved && (
          <span className="text-xs text-muted-foreground">Resolved</span>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <h3 className="font-medium text-sm">No alerts yet</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
        Alerts fire automatically when an automation sends a failure event or
        goes silent longer than its expected interval.
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getKindMeta(kind: string): {
  icon: string;
  label: string;
  colorClass: string;
} {
  switch (kind) {
    case "stalled":
      return {
        icon: "⏸",
        label: "Stalled",
        colorClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      };
    case "failure":
    case "failure_spike":
      return {
        icon: "✕",
        label: kind === "failure_spike" ? "Failure Spike" : "Failure",
        colorClass: "bg-destructive/10 text-destructive",
      };
    case "volume_anomaly":
      return {
        icon: "↕",
        label: "Volume Anomaly",
        colorClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      };
    default:
      return {
        icon: "⚠",
        label: capitalise(kind),
        colorClass: "bg-muted text-muted-foreground",
      };
  }
}

function getSeverityMeta(severity: string): {
  dot: string;
  severityClass: string;
} {
  switch (severity) {
    case "critical":
      return { dot: "●", severityClass: "bg-destructive/10 text-destructive" };
    case "warning":
      return {
        dot: "●",
        severityClass:
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
      };
    default:
      return { dot: "●", severityClass: "bg-muted text-muted-foreground" };
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
