/** Set up verified authenticator sign-in and show freshly generated recovery codes only in local component state. */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";

type Action = "enable" | "disable" | "regenerate";
type Setup = { uri: string; secret: string; backupCodes: string[] };

export function TwoFactorSettings({ hasPassword }: { hasPassword: boolean }) {
  const session = authClient.useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  if (session.isPending && !session.data) return <section aria-labelledby="two-factor-heading"><h2 id="two-factor-heading" className="font-medium">Two-factor sign-in</h2><p role="status" className="mt-2 text-muted-foreground">Loading security settings…</p></section>;
  if (!session.data) return <section className="grid gap-3" aria-labelledby="two-factor-heading"><h2 id="two-factor-heading" className="font-medium">Two-factor sign-in</h2><p role="alert" className="text-destructive">Couldn&apos;t load your security settings.</p><div><Button size="sm" variant="outline" onClick={() => void session.refetch({ query: { disableCookieCache: true } })}>Try again</Button></div></section>;
  return <TwoFactorControls key={session.data.user.id} hasPassword={hasPassword} enabled={Boolean(session.data.user.twoFactorEnabled)} changed={async () => {
    await Promise.allSettled([session.refetch({ query: { disableCookieCache: true } }), queryClient.invalidateQueries({ queryKey: ["account-sessions"] })]);
    router.refresh();
  }} />;
}

function TwoFactorControls({ hasPassword, enabled, changed }: { hasPassword: boolean; enabled: boolean; changed: () => Promise<void> }) {
  const [action, setAction] = useState<Action | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function choose(next: Action) { setAction(next); setPassword(""); setCode(""); setError(""); }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied.`); }
    catch { toast.error("Copy isn't available. Select the text and copy it manually."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !action) return;
    if (!password) { setError("Enter your password."); return; }
    setBusy(true);
    setError("");
    try {
      if (action === "enable") {
        const result = await authClient.twoFactor.enable({ password, method: "totp" });
        if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Wait a minute, then try again." : "Couldn't start setup. Check your password and try again."); return; }
        if (!result.data || result.data.method !== "totp") throw new Error("Setup unavailable");
        const uri = new URL(result.data.totpURI);
        const secret = uri.searchParams.get("secret") ?? "";
        if (uri.protocol !== "otpauth:" || uri.hostname !== "totp" || !/^[a-z2-7]+=*$/i.test(secret)) throw new Error("Invalid setup");
        setSetup({ uri: uri.href, secret, backupCodes: result.data.backupCodes });
        setAction(null);
      } else if (action === "disable") {
        const result = await authClient.twoFactor.disable({ password });
        if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Wait a minute, then try again." : "Couldn't turn off two-factor sign-in. Check your password and try again."); return; }
        setAction(null);
        setSetup(null);
        setBackupCodes(null);
        toast.success("Two-factor sign-in turned off.");
        await changed();
      } else {
        const result = await authClient.twoFactor.generateBackupCodes({ password });
        if (result.error || !result.data?.backupCodes.length) { setError(result.error?.status === 429 ? "Too many attempts. Wait a minute, then try again." : "Couldn't create backup codes. Check your password and try again."); return; }
        setBackupCodes(result.data.backupCodes);
        setAction(null);
        toast.success("New backup codes created. The old codes no longer work.");
        await changed();
      }
    } catch { setError("Couldn't finish the request. Check your connection and try again."); }
    finally { setPassword(""); setBusy(false); }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !setup) return;
    if (!/^\d{6}$/.test(code)) { setError("Enter the six-digit code from your authenticator."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
      if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Wait a minute, then try again." : "That code didn't work. Use the current code from your authenticator."); return; }
      setBackupCodes(setup.backupCodes);
      setSetup(null);
      toast.success("Two-factor sign-in turned on.");
      await changed();
    } catch { setError("Couldn't confirm the code. Check your connection and try again."); }
    finally { setCode(""); setBusy(false); }
  }

  function downloadCodes() {
    if (!backupCodes) return;
    const file = new Blob([`CodeChatter backup codes\nEach code works once. Keep these somewhere safe.\n\n${backupCodes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "codechatter-backup-codes.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="grid gap-3" aria-labelledby="two-factor-heading">
      <div><h2 id="two-factor-heading" className="font-medium">Two-factor sign-in</h2><p className="mt-1 text-muted-foreground">Use your password and a code from your authenticator app when you sign in.</p></div>
      <p role="status" className="text-xs">Status: <span className="font-medium">{enabled ? "On" : "Off"}</span>{setup && " — confirm an authenticator code to finish setup."}</p>
      {!hasPassword ? <p className="text-muted-foreground">Set a password before managing two-factor sign-in. <Link href="/forgot-password" className="text-foreground underline underline-offset-4">Set a password</Link></p> : backupCodes ? (
        <div className="grid gap-3 rounded-md border p-4" data-account-secret>
          <h3 className="font-medium">Save your backup codes</h3>
          <p className="text-xs text-muted-foreground">Each code works once. These codes are shown only now. Store them somewhere safe before continuing.</p>
          <Field><FieldLabel htmlFor="backup-codes">Backup codes</FieldLabel><Textarea id="backup-codes" readOnly value={backupCodes.join("\n")} className="min-h-48 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} spellCheck={false} autoComplete="off" /></Field>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void copy(backupCodes.join("\n"), "Backup codes")}>Copy backup codes</Button><Button size="sm" variant="outline" onClick={downloadCodes}>Download backup codes</Button><Button size="sm" onClick={() => setBackupCodes(null)}>I&apos;ve saved these codes</Button></div>
        </div>
      ) : setup ? (
        <div className="grid gap-4 rounded-md border p-4">
          <div className="grid gap-2" data-account-secret><h3 className="font-medium">Add CodeChatter to your authenticator</h3><p className="text-xs text-muted-foreground">Enter this secret manually, or open the link on a device with your authenticator installed.</p><code data-testid="totp-secret" className="break-all rounded-md bg-muted p-3 font-mono text-xs select-all">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code><div className="flex flex-wrap items-center gap-3"><Button size="xs" variant="outline" onClick={() => void copy(setup.secret, "Secret")}>Copy secret</Button><a href={setup.uri} className="text-xs underline underline-offset-4">Open in authenticator</a></div></div>
          <form onSubmit={confirm} className="grid gap-3" noValidate><Field><FieldLabel htmlFor="setup-code">Authenticator code</FieldLabel><Input id="setup-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="max-w-48 font-mono" /><FieldDescription>Two-factor sign-in stays off until a code checks out.</FieldDescription></Field><div className="flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={busy}>{busy ? "Checking…" : "Confirm code"}</Button><Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => { setSetup(null); setCode(""); setError(""); }}>Cancel setup</Button></div></form>
        </div>
      ) : action ? (
        <form onSubmit={submit} className="grid gap-3 rounded-md border p-4" noValidate>
          <p className="text-xs text-muted-foreground">{action === "enable" ? "Confirm your password to start authenticator setup." : action === "disable" ? "Confirm your password to turn off two-factor sign-in." : "Confirm your password. New backup codes replace all your old codes."}</p>
          <Field><FieldLabel htmlFor="two-factor-password">Password</FieldLabel><PasswordInput id="two-factor-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" maxLength={128} className="max-w-sm" /></Field>
          <div className="flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={busy}>{busy ? "Saving…" : action === "enable" ? "Continue" : action === "disable" ? "Confirm turn off" : "Create new backup codes"}</Button><Button size="sm" type="button" variant="outline" disabled={busy} onClick={() => { setAction(null); setPassword(""); setError(""); }}>Cancel</Button></div>
        </form>
      ) : <div className="flex flex-wrap gap-2">{enabled ? <><Button size="sm" variant="outline" onClick={() => choose("disable")}>Turn off</Button><Button size="sm" variant="outline" onClick={() => choose("regenerate")}>New backup codes</Button></> : <Button size="sm" variant="outline" onClick={() => choose("enable")}>Turn on</Button>}</div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </section>
  );
}
