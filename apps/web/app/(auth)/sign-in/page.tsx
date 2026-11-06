import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";
import { InvitationAuth } from "@/components/settings/members/invitation-auth";
import { safeReturnTo } from "@/lib/safe-return";
import { getMeta } from "@/lib/server-api";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const [{ returnTo }, meta] = await Promise.all([searchParams, getMeta()]);
  const destination = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  if (destination.startsWith("/invite/")) return <InvitationAuth mode="sign-in" returnTo={destination} google={meta.auth.google} github={meta.auth.github} showUnconfigured={process.env.NODE_ENV !== "production"} />;
  return <SignInForm
      returnTo={destination}
      google={meta.auth.google}
      github={meta.auth.github}
      showUnconfigured={process.env.NODE_ENV !== "production"}
    />;
}
