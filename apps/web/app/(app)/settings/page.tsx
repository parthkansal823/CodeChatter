"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { GithubToken } from "@/components/app/github-token";
import { Button } from "@/components/ui/button";

/** Your account's connections. Editor settings live in the room (Settings in the editor) and follow you from there. */
export default function SettingsPage() {
  const me = useMe();
  const org = me.organizations.find((item) => item.id === me.session.activeOrganizationId);
  const canReadAudit = org?.role === "owner" || org?.role === "admin";
  return (
    <>
      <PageHeader title="Settings" description="Connections for your account." />
      <div className="grid max-w-2xl gap-8 px-6 py-6 sm:px-8">
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
