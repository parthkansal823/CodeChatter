import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";
import { safeReturnTo } from "@/lib/safe-return";
import { getMeta } from "@/lib/server-api";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const [{ returnTo }, meta] = await Promise.all([searchParams, getMeta()]);
  return <SignInForm
      returnTo={safeReturnTo(returnTo)}
      google={meta.auth.google}
      github={meta.auth.github}
      showUnconfigured={process.env.NODE_ENV !== "production"}
    />;
}
