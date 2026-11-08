/** Show configured sign-in methods and safely start or remove social links without exposing provider tokens. */
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";

import { useMe } from "@/components/app/app-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { ServerMeta } from "@/lib/server-api";

type SocialProvider = "google" | "github";
type LinkedAccount = { id: string; providerId: string; userId: string };
type SignInMethods = { accounts: LinkedAccount[]; google: boolean; github: boolean };
const LABELS = { google: "Google", github: "GitHub" } as const;

class IdentityError extends Error {
  constructor() { super("Sign in again before changing how you sign in."); }
}

/** Map known API and callback codes to fixed copy; never render the provider's free-form error text. */
function linkError(code: string | undefined): string {
  switch (code?.toLowerCase()) {
    case "email_does_not_match":
    case "linking_different_emails_not_allowed":
      return "That account uses a different email address. Choose a provider account with the same email as your CodeChatter account.";
    case "access_denied":
      return "The connection was cancelled. You can try again.";
    case "account_already_linked_to_different_user":
    case "social_account_already_linked":
      return "That provider account is already connected to another CodeChatter account.";
    case "email_not_verified":
    case "unable_to_link_account":
    case "linking_not_allowed":
      return "Couldn't connect that account. Check that its email is verified and matches your CodeChatter email, then try again.";
    case "provider_not_found":
    case "oauth_provider_not_found":
      return "That sign-in provider is no longer available on this server. Refresh the page.";
    default:
      return "Couldn't connect the account. Try again. If it keeps failing, sign in again first.";
  }
}

function usableAccounts(methods: SignInMethods): LinkedAccount[] {
  return methods.accounts.filter((account) => account.providerId === "credential" || (account.providerId === "google" && methods.google) || (account.providerId === "github" && methods.github));
}

function AccountConnections() {
  const me = useMe();
  const client = useQueryClient();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dismissReturn, setDismissReturn] = useState(false);
  const [selected, setSelected] = useState<{ account: LinkedAccount; provider: SocialProvider } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const key = ["preferences-accounts", me.user.id] as const;

  async function loadMethods(signal?: AbortSignal): Promise<SignInMethods> {
    const [result, current, meta] = await Promise.all([
      authClient.listAccounts({ fetchOptions: { signal } }),
      authClient.getSession({ query: { disableCookieCache: true }, fetchOptions: { signal } }),
      api<ServerMeta>("/api/meta", { signal }),
    ]);
    if (current.error?.status === 401 || current.error?.status === 403 || (!current.error && !current.data) || (current.data && current.data.user.id !== me.user.id)) throw new IdentityError();
    if (result.error?.status === 401 || result.error?.status === 403 || result.data?.some((account) => account.userId !== me.user.id)) throw new IdentityError();
    if (current.error || result.error || !result.data || !meta?.auth) throw new Error("Couldn't load your sign-in methods. Try again.");
    return {
      accounts: result.data.map(({ id, providerId, userId }) => ({ id, providerId, userId })),
      google: meta.auth.google === true,
      github: meta.auth.github === true,
    };
  }

  const methods = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => loadMethods(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const data = methods.data;
  const canChange = Boolean(data) && !methods.isError && !methods.isFetching && !busy;
  const hasPassword = Boolean(data?.accounts.some((account) => account.providerId === "credential"));
  const linked = search.get("linked");
  const returnedProvider = linked === "google" || linked === "github" ? linked : null;
  const callbackError = search.has("error") || search.get("link") === "failed";
  const returnedLinked = returnedProvider && data?.accounts.some((account) => account.providerId === returnedProvider);

  async function refreshMethods(): Promise<SignInMethods> {
    const fresh = await loadMethods();
    client.setQueryData(key, fresh);
    return fresh;
  }

  async function connect(provider: SocialProvider) {
    if (!canChange) return;
    setDismissReturn(true);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fresh = await refreshMethods();
      if (!fresh[provider]) { setError("That sign-in provider is no longer available on this server. Refresh the page."); return; }
      if (fresh.accounts.some((account) => account.providerId === provider)) { setMessage(`${LABELS[provider]} is already connected.`); return; }
      const callbackURL = new URL("/settings/preferences", window.location.origin);
      callbackURL.searchParams.set("linked", provider);
      const errorCallbackURL = new URL("/settings/preferences", window.location.origin);
      errorCallbackURL.searchParams.set("link", "failed");
      const result = await authClient.linkSocial({ provider, callbackURL: callbackURL.href, errorCallbackURL: errorCallbackURL.href });
      if (result.error) {
        setError(result.error.status === 401 || result.error.status === 403 ? "Sign in again before connecting an account." : result.error.status === 429 ? "Too many attempts. Wait a minute, then try again." : linkError(result.error.code));
        return;
      }
      if (!result.data?.redirect) {
        const confirmed = await refreshMethods();
        if (confirmed.accounts.some((account) => account.providerId === provider)) setMessage(`${LABELS[provider]} is connected.`);
        else setError("The connection didn't finish. Try again.");
      }
    } catch (failure) {
      setError(failure instanceof IdentityError ? failure.message : "Couldn't connect. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!selected || !canChange) return;
    setDismissReturn(true);
    setBusy(true);
    setError("");
    setMessage("");
    let removed = false;
    try {
      const fresh = await refreshMethods();
      const account = fresh.accounts.find((item) => item.id === selected.account.id && item.providerId === selected.provider);
      if (!account) { setSelected(null); setMessage("That account has already been disconnected."); return; }
      if (!usableAccounts(fresh).some((item) => item.id !== account.id)) {
        setSelected(null);
        setError("Keep at least one way to sign in. Set a password or connect another account first.");
        return;
      }
      const result = await authClient.unlinkAccount({ accountId: account.id });
      if (result.error) {
        setError(result.error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT" ? "Keep at least one way to sign in. Set a password or connect another account first." : result.error.status === 401 || result.error.status === 403 ? "Sign in again before disconnecting an account." : "Couldn't disconnect the account. Try again.");
        return;
      }
      removed = true;
      setSelected(null);
      await refreshMethods();
      await client.invalidateQueries({ queryKey: ["account-providers", me.user.id] });
      setMessage(`${LABELS[selected.provider]} disconnected.`);
    } catch (failure) {
      setError(failure instanceof IdentityError ? failure.message : removed ? "The account was disconnected. Refresh the page to update your sign-in methods." : "Couldn't finish the request. Check your connection before trying again.");
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="preferences-accounts-heading" className="grid gap-4 border-t pt-6">
      <div><h2 id="preferences-accounts-heading" className="font-medium">Connected accounts</h2><p className="text-muted-foreground">Choose how you sign in to CodeChatter.</p></div>
      {!dismissReturn && (callbackError ? <p role="alert" className="text-destructive">{linkError(search.get("error") ?? undefined)}</p> : returnedProvider && data && !methods.isError && (
        <p role={returnedLinked ? "status" : "alert"} className={returnedLinked ? "text-muted-foreground" : "text-destructive"}>{returnedLinked ? `${LABELS[returnedProvider]} is connected.` : "The connection didn't finish. Try again."}</p>
      ))}
      {methods.isPending ? <p role="status" className="text-muted-foreground">Loading your sign-in methods…</p> : methods.isError ? (
        <div role="alert" className="grid gap-2"><p className="text-destructive">{methods.error instanceof IdentityError ? methods.error.message : "Couldn't load your sign-in methods. Try again."}</p><div><Button size="sm" variant="outline" onClick={() => void methods.refetch()}>Try again</Button></div></div>
      ) : data && (
        <>
          <div role="region" aria-label="Password sign-in" className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <div><h3 className="font-medium">Password</h3><p className="text-muted-foreground">{hasPassword ? "Connected" : "Not connected"}</p></div>
            <Button variant="outline" size="sm" asChild><Link href="/settings/account">{hasPassword ? "Manage password" : "Set a password"}</Link></Button>
          </div>
          {!data.google && !data.github && <p className="text-muted-foreground">No social sign-in providers are set up on this server.</p>}
          {(["google", "github"] as const).filter((provider) => data[provider]).map((provider) => {
            const account = data.accounts.find((item) => item.providerId === provider);
            const last = account && !usableAccounts(data).some((item) => item.id !== account.id);
            return (
              <div role="region" aria-label={`${LABELS[provider]} sign-in`} key={provider} className="grid gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="font-medium">{LABELS[provider]}</h3><p className="text-muted-foreground">{account ? "Connected" : "Not connected"}</p></div>
                  {account ? <Button size="sm" variant="outline" disabled={!canChange || Boolean(last)} aria-label={`Disconnect ${LABELS[provider]}`} onClick={(event) => { opener.current = event.currentTarget; setSelected({ account, provider }); }}>Disconnect</Button> : <Button size="sm" variant="outline" disabled={!canChange} aria-label={`Connect ${LABELS[provider]}`} onClick={() => void connect(provider)}>Connect</Button>}
                </div>
                {last && <p className="text-xs text-muted-foreground">This is your last way to sign in. Set a password or connect another account before disconnecting it.</p>}
              </div>
            );
          })}
          {hasPassword && usableAccounts(data).length === 1 && <p className="text-xs text-muted-foreground">Password is your last way to sign in, so it cannot be disconnected.</p>}
          {!hasPassword && <p className="text-muted-foreground">You can email yourself a link to set a password from account security.</p>}
          <p className="text-xs text-muted-foreground">Use a provider account with the same email as your CodeChatter account.</p>
        </>
      )}
      {message && <p role="status" className="text-muted-foreground">{message}</p>}
      {error && !selected && <p role="alert" className="text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Your GitHub token lets room source control act for you; it is separate from signing in with GitHub.</p>
      <AlertDialog open={selected !== null} onOpenChange={(open) => { if (!open && !busy) setSelected(null); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}>
          <AlertDialogHeader><AlertDialogTitle>Disconnect {selected ? LABELS[selected.provider] : "account"}?</AlertDialogTitle><AlertDialogDescription>You will use another connected account or your password to sign in. This does not remove your GitHub source control token.</AlertDialogDescription></AlertDialogHeader>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <AlertDialogFooter><AlertDialogCancel size="sm" disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction size="sm" disabled={!canChange} onClick={(event) => { event.preventDefault(); void disconnect(); }}>{busy ? "Disconnecting…" : "Disconnect account"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function ConnectedAccounts() {
  const me = useMe();
  return <Suspense fallback={<p role="status" className="text-muted-foreground">Loading your sign-in methods…</p>}><AccountConnections key={me.user.id} /></Suspense>;
}
