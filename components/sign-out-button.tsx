"use client";

import { Button } from "@/components/ui/button";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut}>
      Sign out
    </Button>
  );
}
