import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { InvitationAuth } from "@/components/settings/members/invitation-auth";
import { safeReturnTo } from "@/lib/safe-return";
import { getMeta } from "@/lib/server-api";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const [{ returnTo }, meta] = await Promise.all([searchParams, getMeta()]);
  const destination = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  if (destination.startsWith("/invite/")) return <InvitationAuth mode="sign-up" returnTo={destination} google={meta.auth.google} github={meta.auth.github} showUnconfigured={process.env.NODE_ENV !== "production"} />;
  return <SignUpForm
      returnTo={destination}
      google={meta.auth.google}
      github={meta.auth.github}
      showUnconfigured={process.env.NODE_ENV !== "production"}
    />;
}
