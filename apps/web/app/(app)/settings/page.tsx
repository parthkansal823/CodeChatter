"use client";

import { PageHeader } from "@/components/app/app-shell";
import { GithubToken } from "@/components/app/github-token";

/** Your account's connections. Editor settings live in the room (Settings in the editor) and follow you from there. */
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Connections for your account." />
      <div className="grid max-w-2xl gap-8 px-6 py-6 sm:px-8">
        <GithubToken />
      </div>
    </>
  );
}
