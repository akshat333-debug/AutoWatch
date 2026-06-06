"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createEndpoint, type CreateEndpointState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initialState: CreateEndpointState = { status: "idle" };

export function CreateEndpointForm() {
  const router = useRouter();
  const [state, action, isPending] = useActionState(createEndpoint, initialState);
  const [showReveal, setShowReveal] = useState(false);
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      setShowReveal(true);
    }
  }, [state]);

  async function handleCopy(text: string, type: "url" | "secret") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback: select the text manually
    }
  }

  function handleDone() {
    setShowReveal(false);
    formRef.current?.reset();
    router.refresh();
  }

  if (showReveal && state.status === "success") {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20">
        <CardHeader>
          <CardTitle className="text-base">
            Endpoint &ldquo;{state.label}&rdquo; created
          </CardTitle>
          <CardDescription className="text-amber-700 dark:text-amber-400 font-medium">
            Copy your signing secret now — it will never be shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Webhook URL</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                {state.webhookUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => handleCopy(state.webhookUrl, "url")}
              >
                {copied === "url" ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Signing Secret{" "}
              <span className="text-amber-700 dark:text-amber-400">
                (shown once)
              </span>
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                {state.signingSecret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => handleCopy(state.signingSecret, "secret")}
              >
                {copied === "secret" ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          <Button type="button" onClick={handleDone} className="w-full sm:w-auto">
            Done
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Create endpoint</CardTitle>
        <CardDescription>
          Each endpoint gets a unique webhook URL and HMAC signing secret.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              name="label"
              placeholder="e.g. Zapier — CRM sync"
              required
              maxLength={100}
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="source">Source</Label>
            <select
              id="source"
              name="source"
              disabled={isPending}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— select platform —</option>
              <option value="zapier">Zapier</option>
              <option value="make">Make</option>
              <option value="n8n">n8n</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="expected_interval_seconds">
              Expected interval{" "}
              <span className="text-muted-foreground font-normal">(optional, seconds)</span>
            </Label>
            <Input
              id="expected_interval_seconds"
              name="expected_interval_seconds"
              type="number"
              min="60"
              placeholder="e.g. 3600 for hourly"
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Used to detect stalled automations. Leave blank to skip.
            </p>
          </div>

          {state.status === "error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create endpoint"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
