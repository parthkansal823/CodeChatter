/** Keep personal preferences together and reset their state when the signed-in user changes. */
"use client";

import Link from "next/link";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";

import { Appearance } from "./appearance";
import { ConnectedAccounts } from "./connected-accounts";
import { NotificationPreferences } from "./notification-preferences";

export function PreferencesPage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Preferences" description="Appearance, notifications and how you sign in." actions={<Button size="sm" variant="outline" asChild><Link href="/settings">Back to settings</Link></Button>} />
      <div key={me.user.id} className="grid max-w-4xl gap-8 px-6 py-6 sm:px-8">
        <Appearance />
        <NotificationPreferences />
        <ConnectedAccounts />
      </div>
    </>
  );
}
