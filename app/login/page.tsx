import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { sendMagicLink } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; email?: string; error?: string }>;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">AutoWatch</CardTitle>
          <CardDescription>
            Enter your email to receive a sign-in link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm searchParams={searchParams} />
        </CardContent>
      </Card>
    </div>
  );
}

async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; email?: string; error?: string }>;
}) {
  const params = await searchParams;

  if (params.sent) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Check <strong className="text-foreground">{params.email}</strong> for
          your sign-in link.
        </p>
        <p>You can close this tab.</p>
      </div>
    );
  }

  return (
    <form action={sendMagicLink} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoComplete="email"
        />
      </div>
      {params.error && (
        <p className="text-sm text-destructive">Something went wrong. Try again.</p>
      )}
      <Button type="submit" className="w-full">
        Send sign-in link
      </Button>
    </form>
  );
}
