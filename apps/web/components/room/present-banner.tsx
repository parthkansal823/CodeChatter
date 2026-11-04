"use client";

import { Eye, Presentation } from "lucide-react";
import type { ReactNode } from "react";

import { useEditorUi } from "@/components/room/editor/ui-store";
import type { Peer } from "@/components/room/hooks";

const names = (peers: Peer[]) =>
  peers.length <= 3 ? peers.map((peer) => peer.user.name).join(", ") : `${peers.slice(0, 2).map((peer) => peer.user.name).join(", ")} and ${peers.length - 2} more`;

/**
 * Above the editor while someone presents or you follow someone (editor/present.ts):
 * who, and the one button that changes it.
 */
export function PresentBanner({
  presenter,
  followers,
  followed,
  presentationKey,
}: {
  presenter: Peer | null;
  followers: Peer[];
  followed: Peer | undefined;
  presentationKey: string | null;
}) {
  const presenting = useEditorUi((state) => state.presenting);
  const following = useEditorUi((state) => state.following);
  const ui = useEditorUi.getState;

  if (presenting) {
    return (
      <Banner icon={<Presentation className="size-3.5" />} action="Stop presenting" onAction={() => ui().setPresenting(false)}>
        You’re presenting: {followers.length ? `${names(followers)} ${followers.length === 1 ? "follows" : "follow"} your file and scroll.` : "no one is following yet."}
      </Banner>
    );
  }
  if (presenter && following === presenter.user.id) {
    return (
      <Banner
        icon={<Presentation className="size-3.5" />}
        action="Stop following"
        onAction={() => {
          ui().setPresentOptOut(presentationKey);
          ui().follow(null);
        }}
      >
        {presenter.user.name} is presenting: their file and scroll follow here.
      </Banner>
    );
  }
  if (presenter) {
    return (
      <Banner
        icon={<Presentation className="size-3.5" />}
        action="Follow"
        onAction={() => {
          ui().setPresentOptOut(null);
          ui().follow(presenter.user.id);
        }}
      >
        {presenter.user.name} is presenting.
      </Banner>
    );
  }
  if (followed) {
    return (
      <Banner icon={<Eye className="size-3.5" />} action="Stop following" onAction={() => ui().follow(null)}>
        Following {followed.user.name}: their file and scroll follow here.
      </Banner>
    );
  }
  return null;
}

function Banner({ icon, children, action, onAction }: { icon: ReactNode; children: ReactNode; action: string; onAction: () => void }) {
  return (
    <div role="status" className="flex h-7 shrink-0 items-center gap-2 border-b bg-brand-muted/40 px-3 text-xs">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      <button type="button" className="ml-auto shrink-0 font-medium underline-offset-2 hover:underline" onClick={onAction}>
        {action}
      </button>
    </div>
  );
}
