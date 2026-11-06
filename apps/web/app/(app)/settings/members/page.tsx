/** Show team membership management inside the authenticated settings frame. */
import type { Metadata } from "next";

import { MembersPage } from "@/components/settings/members/members-page";

export const metadata: Metadata = { title: "Members" };

export default function OrganisationMembersPage() { return <MembersPage />; }
