import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Include summaries now so Phase 3 just needs to INSERT rows — no UI change.
// Supabase returns a 1-to-1 FK child as an array; we take index 0.
type EventRow = {
  id: string;
  status: string;
  is_error: boolean | null;
  action_type: string | null;
  object_type: string | null;
  object_count: number | null;
  target_system: string | null;
  occurred_at: string | null;
  endpoints: { label: string; source: string | null } | null;
  summaries: Array<{ text: string }> | null;
};

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, status, is_error, action_type, object_type, object_count, target_system, occurred_at, endpoints(label, source), summaries(text)"
    )
    .order("occurred_at", { ascending: false })
    .limit(50);

  const typedEvents = (events ?? []) as EventRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Events from your connected automations will appear here.
        </p>
      </div>

      {typedEvents.length > 0 ? (
        <EventTimeline events={typedEvents} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EventTimeline({ events }: { events: EventRow[] }) {
  return (
    <div className="divide-y rounded-lg border">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: EventRow }) {
  const summaryText = event.summaries?.[0]?.text ?? null;
  const description = summaryText ?? buildDescription(event);
  const isPending = event.status === "pending" && !summaryText;

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex-1 space-y-1">
        {/* Top row: endpoint badge + error badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {event.endpoints?.label && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {event.endpoints.label}
            </span>
          )}
          {event.is_error && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Error
            </span>
          )}
          {event.status === "failed" && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              Failed
            </span>
          )}
        </div>

        {/* Description / summary */}
        <p
          className={
            isPending
              ? "text-sm text-muted-foreground italic"
              : "text-sm text-foreground"
          }
        >
          {description}
        </p>
      </div>

      {/* Timestamp */}
      <time
        dateTime={event.occurred_at ?? ""}
        className="shrink-0 text-xs text-muted-foreground pt-0.5 tabular-nums"
        title={event.occurred_at ? new Date(event.occurred_at).toISOString() : ""}
      >
        {formatRelative(event.occurred_at)}
      </time>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <h3 className="font-medium text-sm">No events yet</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
        Create an{" "}
        <Link href="/dashboard/endpoints" className="underline underline-offset-2">
          endpoint
        </Link>{" "}
        and send a signed webhook to get started.
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a human-readable description from structured fields when no summary exists yet. */
function buildDescription(event: EventRow): string {
  if (event.action_type && event.object_type) {
    const parts: string[] = [capitalise(event.action_type)];
    if (event.object_count !== null) parts.push(String(event.object_count));
    const noun =
      event.object_count === 1
        ? event.object_type
        : `${event.object_type}s`;
    parts.push(noun);
    if (event.target_system) parts.push(`in ${event.target_system}`);
    return parts.join(" ");
  }
  if (event.status === "summarized") return "Event processed";
  return "Pending processing…";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Server-side relative time. Accurate at page render; good enough for V1. */
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
