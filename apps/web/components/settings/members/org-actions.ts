/** Reload the server-owned organisation context after membership changes and discard cached data from the previous account or team. */
"use client";

import type { QueryClient } from "@tanstack/react-query";

export function navigateFresh(queryClient: QueryClient, path: string): void {
  const destination = new URL(path, window.location.origin);
  if (destination.origin !== window.location.origin) throw new Error("Choose a page on this site.");
  queryClient.clear();
  // useMe is a server-layout prop here; a fresh navigation also resets the switcher's local selection.
  window.location.replace(destination.href);
}
