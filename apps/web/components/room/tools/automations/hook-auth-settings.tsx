/**
 * Who may call a webhook, on its trigger's panel: anyone with the address, or a call that also shows a header's secret value, basic auth, or a signature of
 * its body made with a shared secret (GitHub's X-Hub-Signature-256, Shopify's), as n8n's Webhook node asks. The API checks it (apps/api/src/automations/
 * hook-auth.ts); a secret goes in and is never shown again.
 */
"use client";

import type { AutomationTrigger } from "@codechatter/contracts";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Kind = "none" | "header" | "basic" | "signature";
type Auth = NonNullable<AutomationTrigger["auth"]>;

const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const KINDS: Array<[Kind, string]> = [
  ["none", "Anyone with the address"],
  ["header", "A header with a secret value"],
  ["basic", "Basic auth"],
  ["signature", "A signature of the body (GitHub, Shopify and others)"],
];

function describe(auth: Auth): string {
  if (auth.kind === "header") return `Calls must have the ${auth.header} header with its secret value.`;
  if (auth.kind === "basic") return `Calls must use basic auth, as ${auth.user}.`;
  if (auth.kind === "signature") return `Calls must sign their body in the ${auth.header} header${auth.prefix ? `, after "${auth.prefix}"` : ""}.`;
  return "Anyone with the address can call it: keep the address secret.";
}

export function HookAuthSettings({ auth, busy, onSave }: { auth: Auth; busy: boolean; onSave: (input: Record<string, unknown>) => Promise<unknown> }) {
  const [kind, setKind] = useState<Kind>(auth.kind);
  const [header, setHeader] = useState(auth.kind === "header" ? (auth.header ?? "") : auth.kind === "signature" ? (auth.header ?? "") : "");
  const [user, setUser] = useState(auth.user ?? "");
  const [prefix, setPrefix] = useState(auth.kind === "signature" ? (auth.prefix ?? "") : "sha256=");
  const [secret, setSecret] = useState("");
  const help = useId();
  const choose = (next: Kind) => {
    setKind(next);
    setSecret("");
    if (next === "header" && !header) setHeader("X-Api-Key");
    if (next === "signature" && (!header || header.toLowerCase() === "x-api-key")) {
      setHeader("X-Hub-Signature-256");
      setPrefix("sha256=");
    }
  };
  const ready = kind === "none" ? auth.kind !== "none" : secret.length >= 8 && (kind === "basic" ? user.trim().length > 0 : header.trim().length > 0);
  const input = kind === "header" ? { kind, header, value: secret } : kind === "basic" ? { kind, user, password: secret } : kind === "signature" ? { kind, header, prefix, secret } : { kind };

  return (
    <section aria-label="Who may call it" className="grid gap-2 border-t pt-2">
      <label className="grid gap-1">
        Who may call it
        <select className={field} aria-describedby={help} disabled={busy} value={kind} onChange={(event) => choose(event.target.value as Kind)}>
          {KINDS.map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </select>
      </label>
      <span id={help} className="text-muted-foreground">
        Now: {describe(auth)}
      </span>
      {(kind === "header" || kind === "signature") && (
        <label className="grid gap-1">
          Header
          <Input className="h-7 font-mono text-xs" value={header} onChange={(event) => setHeader(event.target.value)} />
        </label>
      )}
      {kind === "signature" && (
        <label className="grid gap-1">
          Before the signature
          <Input className="h-7 font-mono text-xs" placeholder="Nothing" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          <span className="text-muted-foreground">GitHub sends sha256= first; Shopify, nothing. The signature is an HMAC-SHA256 of the body, in hex or base64.</span>
        </label>
      )}
      {kind === "basic" && (
        <label className="grid gap-1">
          User name
          <Input className="h-7 text-xs" autoComplete="off" value={user} onChange={(event) => setUser(event.target.value)} />
        </label>
      )}
      {kind !== "none" && (
        <label className="grid gap-1">
          {kind === "basic" ? "Password" : kind === "header" ? "Its value" : "Shared secret"}
          <Input className="h-7 font-mono text-xs" type="password" autoComplete="new-password" placeholder={auth.kind === kind ? "Set: type a new one to change it" : "At least 8 characters"} value={secret} onChange={(event) => setSecret(event.target.value)} />
          {kind === "signature" && <span className="text-muted-foreground">On GitHub, put the same secret in the webhook&apos;s Secret: it signs every call in X-Hub-Signature-256.</span>}
        </label>
      )}
      {(kind !== auth.kind || kind !== "none") && (
        <div>
          <Button
            size="xs"
            variant="outline"
            disabled={busy || !ready}
            onClick={() =>
              void onSave(input).then(() => {
                setSecret("");
              })
            }
          >
            Save who may call it
          </Button>
        </div>
      )}
    </section>
  );
}
