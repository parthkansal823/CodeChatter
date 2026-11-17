/** Check instance administration on the server before rendering any server-wide account, room or health data. */
import type { AdminAccess } from "@codechatter/contracts";
import { notFound } from "next/navigation";

import { AdminPage } from "@/components/admin/admin-page";
import { serverApiResult } from "@/lib/server-api";

export default async function InstanceAdminPage() {
  const access = await serverApiResult<AdminAccess>("/api/admin/access");
  if (access.status === 401 || access.status === 403 || access.status === 404) notFound();
  if (!access.data) throw new Error("This page couldn't load. Try again shortly.");
  return <AdminPage userId={access.data.userId} />;
}
