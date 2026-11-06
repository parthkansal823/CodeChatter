/** Let only the invited signed-in email inspect and answer a Better Auth organisation invitation. */
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { navigateFresh } from "./org-actions";

class InvitationError extends Error {
  constructor(readonly code: string, readonly status: number) { super("Couldn't open the invitation."); }
}

export function Invitation({ id, email }: { id: string; email: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const returnTo = `/invite/${encodeURIComponent(id)}`;
  const signIn = `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  const invitation = useQuery({
    queryKey: ["organisation-invitation", id, email],
    enabled: !joinedId && !declined,
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const result = await authClient.organization.getInvitation({ query: { id }, fetchOptions: { signal } });
      if (result.error) throw new InvitationError(result.error.code ?? "", result.error.status);
      if (!result.data) throw new InvitationError("INVITATION_NOT_FOUND", 400);
      return result.data;
    },
  });

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) { setError("Couldn't sign out. Try again."); return; }
      navigateFresh(queryClient, signIn);
    } catch { setError("Couldn't sign out. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function answer(join: boolean) {
    if (busy || (!invitation.data && !joinedId)) return;
    setBusy(true);
    setError("");
    try {
      if (join) {
        let organizationId = joinedId;
        if (!organizationId) {
          const result = await authClient.organization.acceptInvitation({ invitationId: id });
          if (result.error || !result.data) { setError("Couldn't join. This invitation may no longer be available. Refresh and try again."); return; }
          organizationId = result.data.invitation.organizationId;
          setJoinedId(organizationId);
        }
        const active = await authClient.organization.setActive({ organizationId });
        if (active.error) { setError("You joined the organisation. Try opening it again."); return; }
        toast.success("You joined the organisation.");
        navigateFresh(queryClient, "/dashboard");
      } else {
        const result = await authClient.organization.rejectInvitation({ invitationId: id });
        if (result.error) { setError("Couldn't decline. Refresh the invitation and try again."); return; }
        setDeclined(true);
        void queryClient.invalidateQueries({ queryKey: ["org-invitations"] });
      }
    } catch { setError("Couldn't finish the request. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function verifyEmail() {
    setBusy(true);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: returnTo });
      if (result.error) toast.error("Couldn't send the verification email. Try again later.");
      else toast.success("Check your inbox, then open the verification link.");
    } catch { toast.error("Couldn't send the email. Check your connection."); }
    finally { setBusy(false); }
  }

  const failure = invitation.error;
  const wrongEmail = failure instanceof InvitationError && failure.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION";
  const needsVerification = failure instanceof InvitationError && failure.code.includes("EMAIL_VERIFICATION_REQUIRED");
  const unavailable = failure instanceof InvitationError && (failure.status === 400 || failure.status === 404);
  const signedOut = failure instanceof InvitationError && failure.status === 401;
  return (
    <section className="grid gap-5" aria-labelledby="invitation-title">
      <h1 id="invitation-title" className="font-wide text-2xl font-semibold">{declined ? "Invitation declined" : "Organisation invitation"}</h1>
      {declined ? <p className="text-muted-foreground">You haven&apos;t joined this organisation.</p> : joinedId ? (
        <><p className="text-muted-foreground">You joined the organisation. Open it to continue.</p><Button size="sm" disabled={busy} onClick={() => void answer(true)}>{busy ? "Opening…" : "Open organisation"}</Button></>
      ) : wrongEmail ? (
        <><p className="text-muted-foreground">You&apos;re signed in as <strong className="break-all text-foreground">{email}</strong>. This invitation is for a different email address.</p><Button size="sm" onClick={signOut} disabled={busy}>Sign out and use another email</Button></>
      ) : needsVerification ? (
        <><p className="text-muted-foreground">Verify {email} before opening this invitation.</p><Button size="sm" onClick={verifyEmail} disabled={busy}>Send verification email</Button></>
      ) : signedOut ? <><p className="text-muted-foreground">Sign in to open this invitation.</p><Button size="sm" asChild><Link href={signIn as never}>Sign in</Link></Button></>
        : invitation.isPending ? <p role="status" className="text-muted-foreground">Loading invitation…</p>
          : unavailable ? <p className="text-muted-foreground">This invitation has expired, was cancelled, or has already been used.</p>
            : invitation.isError ? <><p role="alert">Couldn&apos;t load this invitation.</p><Button size="sm" variant="outline" onClick={() => void invitation.refetch()}>Try again</Button></>
              : invitation.data ? (
                <><p className="text-muted-foreground"><strong className="break-all text-foreground">{invitation.data.inviterEmail}</strong> invited you to <strong className="break-words text-foreground">{invitation.data.organizationName}</strong>.</p>
                  <p>Role: <span className="font-medium capitalize">{invitation.data.role}</span></p>
                  <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => void answer(true)}>{busy ? "Saving…" : joinedId ? "Open organisation" : "Join"}</Button><Button size="sm" variant="outline" disabled={busy || Boolean(joinedId)} onClick={() => void answer(false)}>Decline</Button></div></>
              ) : null}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Link href="/dashboard" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">Go to dashboard</Link>
    </section>
  );
}
