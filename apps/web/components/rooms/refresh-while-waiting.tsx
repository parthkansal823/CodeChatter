/** On the "waiting to join" page: looks again every few seconds, so the room opens as soon as the owner approves. */
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshWhileWaiting() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
