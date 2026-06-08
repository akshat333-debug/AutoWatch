import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { SignOutButton } from "@/components/sign-out-button";

export function DashboardNav({ email }: { email: string }) {
  return (
    <header className="sticky top-0 z-50 bg-background border-b">
      <div className="container max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/dashboard" className="font-semibold">
            AutoWatch
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Activity
          </Link>
          <Link
            href="/dashboard/alerts"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Alerts
          </Link>
          <Link
            href="/dashboard/endpoints"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Endpoints
          </Link>
          <Link
            href="/dashboard/settings"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Settings
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground hidden sm:block">{email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
