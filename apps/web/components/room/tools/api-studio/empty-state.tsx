"use client";

import { createFileAtPath, findByPath } from "@codechatter/workspace-model";
import { FilePlus2, FolderPlus, Import, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

import { focusUrlSoon } from "./collections-tree";
import { EXAMPLE_REQUESTS, EXAMPLE_SERVER, EXAMPLE_SERVER_PATH } from "./examples";
import { createFolderWith, createRequest } from "./model";
import { useStudio } from "./studio-context";

/** Shown when no request is open: first use, or a collection with nothing in it. */
export function EmptyState() {
  const { doc, tree, canEdit, select, openDialog, openFile, user } = useStudio();
  const { doc: files, can } = useRoom();
  const fresh = tree.length === 0;

  const addExamples = () => {
    createFolderWith(doc, "Sandbox example", null, EXAMPLE_REQUESTS);
    toast.success("Added four requests. Add the example server and run it, then send them.");
  };

  const addServer = () => {
    const id = findByPath(files, EXAMPLE_SERVER_PATH)?.id ?? createFileAtPath(files, EXAMPLE_SERVER_PATH, EXAMPLE_SERVER, user.id);
    toast.success(`Opened ${EXAMPLE_SERVER_PATH}. Press Run, then come back to API Studio and send.`);
    // The new file reaches the editor's file list a moment after it is created.
    setTimeout(() => openFile(id), 200);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="grid w-full max-w-lg gap-5">
        <div className="grid gap-1">
          <Send className="mb-1 size-5 text-muted-foreground" aria-hidden />
          <h3 className="text-lg font-medium">{fresh ? "Try an API together" : "Pick a request"}</h3>
          <p className="text-sm text-muted-foreground">
            {fresh
              ? "Build requests, send them and keep them in this room. Everyone sees the same collection as it changes."
              : "Choose a request on the left, or make a new one."}
          </p>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                select(createRequest(doc, { name: "New request" }));
                focusUrlSoon();
              }}
            >
              <Plus /> New request
            </Button>
            {fresh && (
              <Button size="sm" variant="outline" onClick={addExamples}>
                <FolderPlus /> Add the example requests
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openDialog({ kind: "import" })}>
              <Import /> Import
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">You can look at this room but not edit it. Ask an editor to add requests.</p>
        )}

        <div className="grid gap-2 rounded-md border p-3">
          <h4 className="text-sm font-medium">Test the server running in this room</h4>
          <p className="text-sm text-muted-foreground">
            Use <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">http://localhost:3000/your/path</code> as the URL, with the port your server listens on. The request goes to this room&apos;s sandbox, so you can
            try the API as you build it. Servers on the internet work too; addresses inside private networks are blocked.
          </p>
          {can("files.edit") && (
            <div>
              <Button size="sm" variant="outline" onClick={addServer}>
                <FilePlus2 /> Add an example server to the room
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
