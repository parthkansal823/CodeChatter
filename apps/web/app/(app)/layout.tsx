import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import type { Me } from "@/lib/me";
import { serverApi } from "@/lib/server-api";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Validated server-side before anything renders: no signed-out flash, and
  // an expired session lands on sign-in instead of a broken page.
  const me = await serverApi<Me>("/api/me");
  if (!me) redirect("/sign-in");
  return <AppShell me={me}>{children}</AppShell>;
}
