export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Events from your connected automations will appear here.
        </p>
      </div>
      <EmptyState />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      <h3 className="font-medium text-sm">No events yet</h3>
      <p className="text-muted-foreground text-sm mt-1">
        Create an endpoint and send your first signed webhook to get started.
      </p>
    </div>
  );
}
