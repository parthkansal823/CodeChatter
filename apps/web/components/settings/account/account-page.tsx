/** Assemble account controls on a dedicated page and derive password availability from linked Better Auth accounts. */
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { AccountProfile, PasswordSettings } from "./profile-password";
import { AccountSessions } from "./sessions";
import { TwoFactorSettings } from "./two-factor-settings";

class AccountIdentityError extends Error {
  constructor() { super("Sign in again to manage your account."); }
}

function AccountContent() {
  const me = useMe();
  const accounts = useQuery({
    queryKey: ["account-providers", me.user.id],
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const [result, current] = await Promise.all([
        authClient.listAccounts({ fetchOptions: { signal } }),
        authClient.getSession({ query: { disableCookieCache: true }, fetchOptions: { signal } }),
      ]);
      if (current.error?.status === 401 || current.error?.status === 403 || (!current.error && !current.data) || (current.data && current.data.user.id !== me.user.id)) throw new AccountIdentityError();
      if (result.error?.status === 401 || result.error?.status === 403) throw new AccountIdentityError();
      if (result.data?.some((account) => account.userId !== me.user.id)) throw new AccountIdentityError();
      if (current.error || result.error || !result.data) throw new Error("Couldn't load how you sign in. Try again.");
      return result.data;
    },
  });
  const hasPassword = Boolean(accounts.data?.some((account) => account.providerId === "credential"));
  const providers = [...new Set(accounts.data?.map((account) => account.providerId === "credential" ? "password" : account.providerId === "github" ? "GitHub" : account.providerId === "google" ? "Google" : "another provider") ?? [])];

  return (
    <>
      <PageHeader title="Account security" description="Your profile, password, two-factor sign-in and devices." actions={<Button size="sm" variant="outline" asChild><Link href="/settings">Back to settings</Link></Button>} />
      <div className="grid max-w-4xl gap-6 px-6 py-6 sm:px-8">
        {accounts.isPending ? <p role="status" className="text-muted-foreground">Loading your account…</p> : accounts.isError && (!accounts.data || accounts.error instanceof AccountIdentityError) ? (
          <div role="alert" className="grid gap-3"><p className="text-destructive">{accounts.error.message}</p><div><Button size="sm" variant="outline" onClick={() => void accounts.refetch()}>Try again</Button></div></div>
        ) : (
          <>
            {accounts.isError && <div role="alert" className="grid gap-2"><p className="text-muted-foreground">Couldn&apos;t refresh how you sign in. Showing your last loaded settings.</p><div><Button size="sm" variant="outline" onClick={() => void accounts.refetch()}>Try again</Button></div></div>}
            <AccountProfile user={me.user} providers={providers} />
            <PasswordSettings userId={me.user.id} email={me.user.email} hasPassword={hasPassword} />
            <TwoFactorSettings hasPassword={hasPassword} />
          </>
        )}
        <AccountSessions userId={me.user.id} />
      </div>
    </>
  );
}

export function AccountPage() {
  const me = useMe();
  return <AccountContent key={me.user.id} />;
}
