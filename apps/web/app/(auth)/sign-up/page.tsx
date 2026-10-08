import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { safeReturnTo } from "@/lib/safe-return";
import { getMeta } from "@/lib/server-api";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const [{ returnTo }, meta] = await Promise.all([searchParams, getMeta()]);
  return <SignUpForm
      returnTo={safeReturnTo(returnTo)}
      google={meta.auth.google}
      github={meta.auth.github}
      showUnconfigured={process.env.NODE_ENV !== "production"}
    />;
}
