import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";

/**
 * Open a server in the sandbox as a live preview on its own origin, through a
 * one-time link. The tab opens first, synchronously, so popup blockers allow
 * it; then it's pointed at the link.
 */
export async function openPreview(roomId: string, port: number): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  try {
    const { url } = await api<{ url: string }>(`/api/rooms/${roomId}/preview`, {
      method: "POST",
      json: { port },
    });
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (e) {
    tab?.close();
    toast.error(e instanceof ApiError ? e.detail : "Couldn't open the preview.");
  }
}
