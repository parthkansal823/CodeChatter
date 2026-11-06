/** Preserve invitation destinations through sign-in, account creation, verification and resending without changing the shared auth forms. */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PasswordInput } from "@/components/auth/password-input";
import { SocialButtons } from "@/components/auth/social-buttons";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

import { navigateFresh } from "./org-actions";

// The shared client's 2FA page returns to the dashboard. Complete this challenge
// inline so the invitation destination survives without changing other sign-ins.
const invitationAuthClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [twoFactorClient({ onTwoFactorRedirect() { /* The form displays its own challenge. */ } })],
});

export function InvitationAuth({ mode, returnTo, google, github, showUnconfigured }: {
  mode: "sign-in" | "sign-up";
  returnTo: string;
  google: boolean;
  github: boolean;
  showUnconfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(false);
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const signUp = mode === "sign-up";
  const signInHref = `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  const signUpHref = `/sign-up?returnTo=${encodeURIComponent(returnTo)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalEmail = email.trim();
    if (!z.email().safeParse(normalEmail).success) { setError("Enter a valid email address."); return; }
    if (signUp && !name.trim()) { setError("Enter your name."); return; }
    if (!password || (signUp && password.length < 10)) { setError(signUp ? "Use at least 10 characters for your password." : "Enter your password."); return; }
    setBusy(true);
    setError("");
    try {
      const result = signUp
        ? await authClient.signUp.email({ name: name.trim(), email: normalEmail, password, callbackURL: returnTo })
        : await invitationAuthClient.signIn.email({ email: normalEmail, password, callbackURL: returnTo, rememberMe: true });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") { setVerification(normalEmail); return; }
        setError(result.error.status === 429 ? "Too many attempts. Wait a minute, then try again."
          : result.error.code === "INVALID_EMAIL_OR_PASSWORD" ? "That email and password don't match."
            : result.error.code?.startsWith("USER_ALREADY_EXISTS") ? "An account with this email already exists. Sign in instead."
              : result.error.message ?? "Couldn't finish the request. Try again.");
        return;
      }
      if (!signUp && result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        setChallenge(true);
        setPassword("");
        return;
      }
      if (signUp) setVerification(normalEmail);
      else navigateFresh(queryClient, returnTo);
    } catch { setError("Couldn't connect. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function verifyChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = code.trim();
    if (backup ? !value : !/^\d{6}$/.test(value)) { setError(backup ? "Enter a backup code." : "Enter the six-digit code from your authenticator."); return; }
    setBusy(true);
    setError("");
    try {
      const result = backup
        ? await invitationAuthClient.twoFactor.verifyBackupCode({ code: value })
        : await invitationAuthClient.twoFactor.verifyTotp({ code: value, trustDevice: false });
      if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Wait a minute, then try again." : "That code didn't work. Try again."); return; }
      navigateFresh(queryClient, returnTo);
    } catch { setError("Couldn't connect. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  if (challenge) return (
    <section className="grid gap-5">
      <h1 className="font-wide text-2xl font-semibold">Verify it&apos;s you</h1>
      <p className="text-muted-foreground">{backup ? "Use one of your saved backup codes." : "Open your authenticator app and enter the six-digit code."} You&apos;ll return to your invitation.</p>
      <form onSubmit={verifyChallenge} className="grid gap-4" noValidate>
        <Field><FieldLabel htmlFor="invitation-code">{backup ? "Backup code" : "Authenticator code"}</FieldLabel><Input id="invitation-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode={backup ? "text" : "numeric"} maxLength={backup ? 64 : 6} autoFocus /></Field>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button size="sm" type="submit" disabled={busy}>{busy ? "Checking…" : "Verify"}</Button>
      </form>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setBackup(!backup); setCode(""); setError(""); }}>{backup ? "Use an authenticator code" : "Use a backup code"}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setChallenge(false); setCode(""); setError(""); }}>Use another email</Button>
    </section>
  );

  async function resend() {
    if (!verification || busy) return;
    setBusy(true);
    try {
      const result = await authClient.sendVerificationEmail({ email: verification, callbackURL: returnTo });
      if (result.error) toast.error(result.error.status === 429 ? "Please wait before asking for another email." : "Couldn't send the email. Try again.");
      else toast.success("Sent. Check your inbox.");
    } catch { toast.error("Couldn't connect. Try again."); }
    finally { setBusy(false); }
  }

  if (verification) return (
    <section className="grid gap-5">
      <h1 className="font-wide text-2xl font-semibold">Check your inbox</h1>
      <p className="text-muted-foreground">Open the verification link sent to <strong className="break-all text-foreground">{verification}</strong>. It will bring you back to this invitation.</p>
      <Button size="sm" variant="outline" onClick={resend} disabled={busy}>{busy ? "Sending…" : "Send the link again"}</Button>
      <Link href={signInHref as never} className="text-xs underline underline-offset-4">Sign in to your invitation</Link>
      <Button size="sm" variant="ghost" onClick={() => { setVerification(null); setPassword(""); setError(""); }}>Use another email</Button>
    </section>
  );

  return (
    <>
      <h1 className="font-wide text-2xl font-semibold">{signUp ? "Create your account" : "Sign in to your invitation"}</h1>
      <p className="mt-2 text-muted-foreground">Use the email address that received the invitation.</p>
      <div className="mt-6"><SocialButtons google={google} github={github} returnTo={returnTo} showUnconfigured={showUnconfigured} /></div>
      <form onSubmit={submit} className="mt-5" noValidate>
        <FieldGroup className="gap-4">
          {signUp && <Field><FieldLabel htmlFor="name">Name</FieldLabel><Input id="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" required /></Field>}
          <Field><FieldLabel htmlFor="email">Email</FieldLabel><Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></Field>
          <Field><FieldLabel htmlFor="password">Password</FieldLabel><PasswordInput id="password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} autoComplete={signUp ? "new-password" : "current-password"} required />{signUp && <p className="text-xs text-muted-foreground">Use at least 10 characters.</p>}</Field>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={busy}>{busy ? "Please wait…" : signUp ? "Create account" : "Sign in"}</Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-xs text-muted-foreground">{signUp ? "Already have an account? " : "New to CodeChatter? "}<Link href={(signUp ? signInHref : signUpHref) as never} className="text-foreground underline underline-offset-4">{signUp ? "Sign in" : "Create an account"}</Link></p>
    </>
  );
}
