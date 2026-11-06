/** Keep the longer profile and security controls together inside the signed-in settings frame. */
import type { Metadata } from "next";

import { AccountPage } from "@/components/settings/account/account-page";

export const metadata: Metadata = { title: "Account security" };

export default function AccountSettingsPage() {
  return <AccountPage />;
}
