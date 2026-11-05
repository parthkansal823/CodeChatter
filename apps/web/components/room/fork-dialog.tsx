"use client";

import type { CreatedRoom } from "@codechatter/contracts";
import { filesDocName } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { GitFork } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import * as Y from "yjs";

import { collabUrl, useRoom } from "@/components/room/room-context";
import { replaceFiles, roomBlobs, roomContents } from "@/components/room/source-control/room-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

/** Copy files into another room's files document, and wait until collab has them all. */
async function copyInto(roomId: string, files: Map<string, string>, userId: string): Promise<void> {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(roomId), document: doc, token: "session" });
  provider.attach();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The new room didn't open in time.")), 20_000);
      provider.on("synced", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    replaceFiles(doc, files, userId, "fork");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The files didn't finish copying. Open the new room to check.")), 30_000);
      const check = () => {
        if (provider.hasUnsyncedChanges) return;
        clearTimeout(timer);
        provider.off("unsyncedChanges", check);
        resolve();
      };
      provider.on("unsyncedChanges", check);
      check();
    });
  } finally {
    provider.destroy();
    socket.destroy();
    doc.destroy();
  }
}

/**
 * Fork: a new room of yours with this room's code (the files as they are now), private to
 * begin with. Anyone who can see the room can fork it, a public room's visitors too. The
 * room's other tools (docs, designs, chat) stay here.
 */
export function ForkButton() {
  const { room, doc, me } = useRoom();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${room.name} (fork)`.slice(0, 80));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fork() {
    setBusy(true);
    setError(null);
    try {
      // Text files and binary ones (as markers); the binaries' bytes are copied on the server first.
      const files = roomContents(doc);
      const hashes = [...new Set([...roomBlobs(doc).values()].map((blob) => blob.sha256))];
      const created = await api<CreatedRoom>(`/api/rooms/${room.id}/fork`, { method: "POST", json: { name: name.trim() } });
      let missing = 0;
      for (let at = 0; at < hashes.length; at += 1000) {
        const copied = await api<{ copied: number; missing: string[] }>(`/api/rooms/${created.id}/blobs/copy`, {
          method: "POST",
          json: { from: room.id, sha256: hashes.slice(at, at + 1000) },
        });
        missing += copied.missing.length;
      }
      await copyInto(created.id, files, me.user.id);
      toast.success(`Forked into ${created.name}`);
      if (missing) toast.warning(`${missing === 1 ? "One binary file's" : `${missing} binary files'`} bytes were missing, so they won't open in the fork.`);
      setOpen(false);
      router.push(`/rooms/${created.id}` as never);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "Couldn't fork the room. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title="A copy of this room's code that's yours">
        <GitFork /> Fork
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void fork();
            }}
          >
            <DialogHeader>
              <DialogTitle>Fork {room.name}</DialogTitle>
              <DialogDescription>A new private room of yours with this room’s code as it is now. Docs, designs and chat stay here.</DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-2">
              <Input aria-label="New room's name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? "Forking…" : "Fork"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
