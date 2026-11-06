/** Let signed-in people update their public name and manage their existing password through Better Auth. */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function AccountProfile({ user, providers }: { user: { id: string; name: string; email: string }; providers: string[] }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const value = name.trim();
    if (!value || value.length > 80) { setError("Use a name between 1 and 80 characters."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await authClient.updateUser({ name: value });
      if (result.error) { setError(result.error.status === 401 ? "Sign in again before saving your name." : "Couldn't save your name. Try again."); return; }
      setName(value);
      toast.success("Name saved.");
      router.refresh();
    } catch { setError("Couldn't connect. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="account-profile-heading" className="grid gap-4">
      <div><h2 id="account-profile-heading" className="font-medium">Profile</h2><p className="text-muted-foreground">How people see you in CodeChatter.</p></div>
      <form onSubmit={save} noValidate className="grid gap-3">
        <Field><FieldLabel htmlFor="account-name">Name</FieldLabel><Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" disabled={busy} required /></Field>
        <Field><FieldLabel htmlFor="account-email">Email</FieldLabel><Input id="account-email" value={user.email} readOnly type="email" autoComplete="email" /><FieldDescription>Email changes are not available yet.</FieldDescription></Field>
        <p className="text-xs text-muted-foreground">You sign in with {providers.length ? providers.join(", ") : "your linked account"}.</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div><Button size="sm" type="submit" disabled={busy || name.trim() === user.name}>{busy ? "Saving…" : "Save name"}</Button></div>
      </form>
    </section>
  );
}

export function PasswordSettings({ userId, email, hasPassword }: { userId: string; email: string; hasPassword: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!currentPassword) { setError("Enter your current password."); return; }
    if (newPassword.length < 10 || newPassword.length > 128) { setError("Use between 10 and 128 characters for the new password."); return; }
    if (newPassword !== confirmation) { setError("The two new passwords don't match."); return; }
    setBusy(true);
    setError("");
    let changed = false;
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: revokeOthers });
      if (result.error) {
        setError(result.error.code === "INVALID_PASSWORD" ? "Your current password is incorrect."
          : result.error.status === 401 || result.error.status === 403 ? "Sign in again before changing your password."
            : result.error.status === 429 ? "Too many attempts. Wait a minute, then try again." : "Couldn't change your password. Try again.");
        return;
      }
      changed = true;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      toast.success("Password changed.");
      await authClient.getSession({ query: { disableCookieCache: true } });
      await queryClient.invalidateQueries({ queryKey: ["account-sessions", userId] });
      router.refresh();
    } catch { setError(changed ? "Your password changed. Refresh the page to update your device list." : "Couldn't finish the request. Check your connection before trying again."); }
    finally { setBusy(false); }
  }

  async function sendPasswordLink() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.requestPasswordReset({ email, redirectTo: new URL("/reset-password", window.location.origin).href });
      if (result.error) { setError(result.error.status === 429 ? "Please wait before asking for another email." : "Couldn't send the email. Try again."); return; }
      setSent(true);
      toast.success("Check your inbox for the password link.");
    } catch { setError("Couldn't connect. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="account-password-heading" className="grid gap-4 border-t pt-6">
      <div><h2 id="account-password-heading" className="font-medium">Password</h2><p className="text-muted-foreground">Choose a password you use only for CodeChatter.</p></div>
      {hasPassword ? (
        <form onSubmit={change} noValidate className="grid gap-3">
          <Field><FieldLabel htmlFor="current-password">Current password</FieldLabel><PasswordInput id="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={128} autoComplete="current-password" disabled={busy} required /></Field>
          <Field><FieldLabel htmlFor="new-password">New password</FieldLabel><PasswordInput id="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} maxLength={128} autoComplete="new-password" disabled={busy} required /><FieldDescription>Use at least 10 characters.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="confirm-new-password">Confirm new password</FieldLabel><PasswordInput id="confirm-new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={128} autoComplete="new-password" disabled={busy} required /></Field>
          <div className="flex items-start gap-2"><Checkbox id="revoke-other-devices" checked={revokeOthers} onCheckedChange={(value) => setRevokeOthers(value === true)} disabled={busy} /><Label htmlFor="revoke-other-devices" className="text-xs font-normal">Sign out my other devices</Label></div>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div><Button size="sm" type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button></div>
        </form>
      ) : (
        <div className="grid gap-3">
          <p className="text-muted-foreground">This account has no password yet. Set one by email to use password sign-in and two-factor sign-in.</p>
          {sent && <p role="status" className="text-muted-foreground">Check {email} for a link to choose a password.</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <div><Button size="sm" variant="outline" onClick={sendPasswordLink} disabled={busy}>{busy ? "Sending…" : "Email me a link to set one"}</Button></div>
        </div>
      )}
    </section>
  );
}
