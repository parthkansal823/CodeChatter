/** Keep invitation return paths intact for signed-out visitors instead of using the app layout's generic sign-in redirect. */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Invitation } from "@/components/settings/members/invitation";
import type { Me } from "@/lib/me";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "Organisation invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await serverApi<Me>("/api/me");
  if (!me) redirect(`/sign-in?returnTo=${encodeURIComponent(`/invite/${encodeURIComponent(id)}`)}`);
  return <Invitation id={id} email={me.user.email} />;
}
