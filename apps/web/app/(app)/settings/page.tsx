"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { GithubToken } from "@/components/app/github-token";
import { Button } from "@/components/ui/button";

/** Links to personal preferences, account security and workspace connections. */
export default function SettingsPage() {
  const me = useMe();
  const org = me.organizations.find((item) => item.id === me.session.activeOrganizationId);
  const canReadAudit = org?.role === "owner" || org?.role === "admin";
  return (
    <>
      <PageHeader title="Settings" description="Preferences and connections for your account." />
      <div className="grid max-w-2xl gap-8 px-6 py-6 sm:px-8">
        <section className="grid gap-2">
          <h2 className="font-medium">Preferences</h2>
          <p className="text-muted-foreground">Choose your appearance, email digest and ways to sign in.</p>
          <div><Button variant="outline" size="sm" asChild><Link href="/settings/preferences">Open preferences <ArrowRight /></Link></Button></div>
        </section>
        <section className="grid gap-2">
          <h2 className="font-medium">Account security</h2>
          <p className="text-muted-foreground">Update your name and password, set up two-factor sign-in and manage your devices.</p>
          <div><Button variant="outline" size="sm" asChild><Link href="/settings/account">Open account security <ArrowRight /></Link></Button></div>
        </section>
        <GithubToken />
        {org && org.id !== me.personalOrgId && (
          <section className="grid gap-2 border-t pt-6">
            <h2 className="font-medium">Members</h2>
            <p className="text-muted-foreground">See the people in {org.name} and manage membership and invitations.</p>
            <div><Button variant="outline" size="sm" asChild><Link href="/settings/members">Open members <ArrowRight /></Link></Button></div>
          </section>
        )}
        {canReadAudit && (
          <section className="grid gap-2 border-t pt-6">
            <h2 className="font-medium">Audit log</h2>
            <p className="text-muted-foreground">See who changed rooms, code and sandbox settings in {org?.name}.</p>
            <div><Button variant="outline" size="sm" asChild><Link href="/settings/audit">Open audit log <ArrowRight /></Link></Button></div>
          </section>
        )}
        {canReadAudit && (
          <section className="grid gap-2 border-t pt-6">
            <h2 className="font-medium">Webhooks</h2>
            <p className="text-muted-foreground">Send signed events from {org?.name} to your services and inspect delivery attempts.</p>
            <div><Button variant="outline" size="sm" asChild><Link href="/settings/webhooks">Open webhooks <ArrowRight /></Link></Button></div>
          </section>
        )}
      </div>
    </>
  );
}
