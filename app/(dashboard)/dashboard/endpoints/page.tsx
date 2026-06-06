import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { CreateEndpointForm } from "./create-endpoint-form";

// Never expose signing_secret in list queries — only shown once at creation.
type EndpointRow = {
  id: string;
  label: string;
  source: string | null;
  endpoint_key: string;
  is_active: boolean | null;
  created_at: string | null;
  expected_interval_seconds: number | null;
};

export default async function EndpointsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: endpoints } = await supabase
    .from("endpoints")
    .select(
      "id, label, source, endpoint_key, is_active, created_at, expected_interval_seconds"
    )
    .order("created_at", { ascending: false });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const typedEndpoints = (endpoints ?? []) as EndpointRow[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Endpoints</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Connect your automations by sending signed webhooks to these URLs.
        </p>
      </div>

      <CreateEndpointForm />

      {typedEndpoints.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Your endpoints
          </h2>
          <div className="divide-y rounded-lg border">
            {typedEndpoints.map((ep) => (
              <EndpointRow
                key={ep.id}
                endpoint={ep}
                siteUrl={siteUrl}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EndpointRow({
  endpoint,
  siteUrl,
}: {
  endpoint: EndpointRow;
  siteUrl: string;
}) {
  const webhookUrl = `${siteUrl}/api/ingest/${endpoint.endpoint_key}`;
  const sourceLabels: Record<string, string> = {
    zapier: "Zapier",
    make: "Make",
    n8n: "n8n",
    custom: "Custom",
  };

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{endpoint.label}</span>
          {endpoint.source && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {sourceLabels[endpoint.source] ?? endpoint.source}
            </span>
          )}
          {endpoint.is_active === false && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              Inactive
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">
          {webhookUrl}
        </p>
      </div>
      <time className="shrink-0 text-xs text-muted-foreground pt-0.5">
        {endpoint.created_at
          ? new Date(endpoint.created_at).toLocaleDateString()
          : "—"}
      </time>
    </div>
  );
}
