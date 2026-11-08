/** Put personal appearance, digest delivery and sign-in connections in one settings destination. */
import type { Metadata } from "next";

import { PreferencesPage } from "@/components/settings/preferences/preferences-page";

export const metadata: Metadata = { title: "Preferences" };

export default function PreferencesSettingsPage() {
  return <PreferencesPage />;
}
