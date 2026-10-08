"use client";

import { Import, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { PresenceAvatar } from "@/components/presence/presence";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";

import { useApiConnection, useRequest } from "./connection";
import { DeleteDialog } from "./delete-dialog";
import { EmptyState } from "./empty-state";
import { EnvironmentsDialog } from "./environments-dialog";
import { ImportDialog } from "./import-dialog";
import type { RequestData } from "./model";
import { RequestPane } from "./request-pane";
import { ResponsePane } from "./response-pane";
import { RunDialog } from "./run-dialog";
import { Sidebar } from "./sidebar";
import { SnippetsDialog } from "./snippets-dialog";
import { StudioProvider, useStudio } from "./studio-context";

/**
 * API Studio: a shared collection of requests (Yjs document `api`), sent
 * through the API server so private networks stay out of reach, with the
 * room's own sandbox as a target. Environments are shared, but secret values
 * stay on each person's device.
 */
export default function ApiStudio({ openFile, close }: RoomToolProps) {
  const { room, me } = useRoom();
  const conn = useApiConnection(room.id, me.user);

  if (!conn?.synced) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <Header close={close} />
        <div className="grid gap-2 p-4" aria-label="Opening API Studio" aria-busy>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }
  return (
    <StudioProvider conn={conn} openFile={openFile} close={close}>
      <Studio />
    </StudioProvider>
  );
}

function Studio() {
  const { doc, selectedId, canSend, send, close } = useStudio();
  const request = useRequest(doc, selectedId);
  const root = useRef<HTMLDivElement>(null);

  // Ctrl+Enter sends the open request. The room's own Run shortcut listens on
  // window too, so this one listens there as well, and only for keys typed in this tool.
  const sendOpen = useRef(() => {});
  useEffect(() => {
    sendOpen.current = () => {
      if (selectedId && canSend) void send(selectedId);
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key !== "Enter") return;
      if (!root.current?.contains(event.target as Node)) return;
      event.preventDefault();
      sendOpen.current();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col bg-background">
      <Header close={close} full />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel id="api-sidebar" defaultSize={236} minSize={180} maxSize={420}>
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="api-work" minSize={320}>
          {request ? <Workbench request={request} /> : <EmptyState />}
        </ResizablePanel>
      </ResizablePanelGroup>
      <EnvironmentsDialog />
      <ImportDialog />
      <SnippetsDialog />
      <RunDialog />
      <DeleteDialog />
    </div>
  );
}

/** The open request on top, its response underneath. */
function Workbench({ request }: { request: RequestData }) {
  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel id="api-request" defaultSize="55%" minSize={200}>
        <RequestPane key={request.id} request={request} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="api-response" minSize={120}>
        <ResponsePane request={request} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function Header({ close, full }: { close: () => void; full?: boolean }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-chrome px-2">
      <Send className="size-4 text-muted-foreground" aria-hidden />
      <h2 className="text-sm font-medium">API Studio</h2>
      {full && <HeaderActions />}
      <Button size="icon-xs" variant="ghost" className={full ? undefined : "ml-auto"} aria-label="Close API Studio" onClick={close}>
        <X />
      </Button>
    </div>
  );
}

function HeaderActions() {
  const { peers, openDialog, canEdit } = useStudio();
  return (
    <>
      {peers.length > 0 && (
        <div className="ml-2 flex items-center gap-1.5" aria-label={`Also here: ${peers.map((p) => p.user.name).join(", ")}`}>
          {peers.slice(0, 5).map((peer) => (
            <PresenceAvatar key={peer.user.id} name={peer.user.name} slot={peer.user.slot} image={peer.user.image} size={20} />
          ))}
          {peers.length > 5 && <span className="text-xs text-muted-foreground">+{peers.length - 5}</span>}
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        {canEdit && (
          <Button size="xs" variant="ghost" onClick={() => openDialog({ kind: "import" })}>
            <Import /> Import
          </Button>
        )}
      </div>
    </>
  );
}
