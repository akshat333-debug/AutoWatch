"use server";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

export async function sendMagicLink(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/login?error=invalid_email");
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/callback`,
    },
  });

  if (error) {
    redirect("/login?error=send_failed");
  }

  redirect(`/login?sent=1&email=${encodeURIComponent(parsed.data.email)}`);
}
