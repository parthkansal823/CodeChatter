/** Resolve the sidebar's new-organisation destination inside the signed-in app frame. */
import type { Metadata } from "next";

import { CreateOrganisation } from "@/components/settings/members/create-organisation";

export const metadata: Metadata = { title: "New organisation" };

export default function NewOrganisationPage() {
  return <CreateOrganisation />;
}
