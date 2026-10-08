"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

type Provider = "google" | "github";

// Brand glyphs are drawn inline; lucide deliberately ships no brand logos.
function GitHubGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="currentColor" d="M21.35 11.1h-9.17v2.98h5.27c-.23 1.4-1.64 4.1-5.27 4.1-3.17 0-5.76-2.62-5.76-5.86s2.59-5.86 5.76-5.86c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.83 3.9 14.72 3 12.18 3 7.03 3 2.86 7.17 2.86 12.32s4.17 9.32 9.32 9.32c5.38 0 8.95-3.78 8.95-9.11 0-.61-.07-1.08-.16-1.43Z" />
    </svg>
  );
}

const PROVIDERS: Array<{ id: Provider; label: string; glyph: () => React.JSX.Element; envVar: string }> = [
  { id: "github", label: "GitHub", glyph: GitHubGlyph, envVar: "GITHUB_CLIENT_ID" },
  { id: "google", label: "Google", glyph: GoogleGlyph, envVar: "GOOGLE_CLIENT_ID" },
];

/**
 * OAuth sign-in. Creating an account and signing in are the same click: the
 * first "Continue with Google" makes the account. In development, providers
 * that aren't configured still show (disabled, with the env var to set) so
 * the feature is discoverable; in production only working ones render.
 */
export function SocialButtons({
  google,
  github,
  returnTo,
  showUnconfigured,
}: {
  google: boolean;
  github: boolean;
  returnTo: string;
  showUnconfigured: boolean;
}) {
  const [pending, setPending] = useState<Provider | null>(null);
  const enabled: Record<Provider, boolean> = { google, github };
  const visible = PROVIDERS.filter((p) => enabled[p.id] || showUnconfigured);
  if (visible.length === 0) return null;

  async function go(provider: Provider) {
    setPending(provider);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: returnTo,
      newUserCallbackURL: returnTo,
      errorCallbackURL: "/sign-in",
    });
    if (error) {
      setPending(null);
      toast.error(error.message ?? `Couldn't continue with ${provider}. Try again.`);
    }
  }

  // OAuth comes first (the fastest path), then the email form below it.
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-2">
        {visible.map(({ id, label, glyph: Glyph, envVar }) =>
          enabled[id] ? (
            <Button key={id} variant="outline" className="h-10" disabled={pending !== null} onClick={() => go(id)}>
              <Glyph /> {pending === id ? "Opening…" : label}
            </Button>
          ) : (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                {/* A disabled button swallows pointer events; the span keeps the tooltip reachable. */}
                <span tabIndex={0} className="grid rounded-md">
                  <Button variant="outline" className="h-10 justify-between px-3" disabled>
                    <span className="flex items-center gap-2">
                      <Glyph /> {label}
                    </span>
                    <span className="rounded-sm bg-muted px-1.5 py-px text-2xs font-normal">Setup needed</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {label} sign-in isn’t set up yet. Add <code className="font-mono">{envVar}</code> to .env and restart the API.
              </TooltipContent>
            </Tooltip>
          ),
        )}
      </div>
      <FieldSeparator>or use email</FieldSeparator>
    </div>
  );
}
