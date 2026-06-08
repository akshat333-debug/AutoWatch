"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { SignOutButton } from "@/components/sign-out-button";

const NAV_LINKS = [
  { href: "/dashboard", label: "Activity" },
  { href: "/dashboard/alerts", label: "Alerts" },
  { href: "/dashboard/endpoints", label: "Endpoints" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function DashboardNav({ email }: { email: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 bg-background border-b">
      <div className="container max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo + desktop nav */}
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/dashboard" className="font-semibold shrink-0">
            AutoWatch
          </Link>
          <Separator orientation="vertical" className="h-4 hidden sm:block" />
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`hidden sm:block transition-colors ${
                isActive(href)
                  ? "text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Desktop right side */}
        <div className="hidden sm:flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{email}</span>
          <SignOutButton />
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            // X icon
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            // Hamburger icon
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="sm:hidden border-t bg-background px-4 py-3 flex flex-col gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={`px-3 py-2 rounded-md text-sm transition-colors ${
                isActive(href)
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {label}
            </Link>
          ))}
          <Separator className="my-2" />
          <p className="px-3 text-xs text-muted-foreground truncate">{email}</p>
          <div className="px-3">
            <SignOutButton />
          </div>
        </div>
      )}
    </header>
  );
}
