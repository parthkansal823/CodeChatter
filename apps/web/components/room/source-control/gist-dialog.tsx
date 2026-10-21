"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { textOf } from "@codechatter/workspace-model";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * Share the open file as a GitHub gist of yours (the palette's "Share the file as a
 * gist"): secret by default, so only people with the link find it.
 */
export function GistDialog({
  file,
  open,
  onOpenChange,
}: {
  file: TreeNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{file && <GistForm key={file.id} file={file} />}</DialogContent>
    </Dialog>
  );
}

function GistForm({ file }: { file: TreeNode }) {
  const { room, doc } = useRoom();
  const [description, setDescription] = useState("");
  const [isPublic, setPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const content = textOf(doc, file.id)?.toString() ?? "";
      const made = await api<{ url: string }>(`/api/rooms/${room.id}/repo/gist`, {
        method: "POST",
        json: { name: file.name, content, description, public: isPublic },
      });
      setUrl(made.url);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.errors?.[0]?.message ?? e.detail) : "Couldn't make the gist. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share {file.name} as a gist</DialogTitle>
        <DialogDescription>A copy of the file as it is now, on your GitHub account.</DialogDescription>
      </DialogHeader>
      {url ? (
        <div className="mt-4 flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate rounded-md border bg-panel px-3 py-2 font-mono text-xs underline-offset-2 hover:underline"
          >
            {url}
          </a>
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy the gist's link"
            onClick={async () => {
              if (!(await copyText(url)))
                return void toast.error("Couldn’t copy. Select the link and copy it by hand.");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
      ) : (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            aria-label="Gist description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <div
            role="radiogroup"
            aria-label="Who can find it"
            className="grid grid-cols-2 rounded-md border p-0.5 text-sm"
          >
            {([false, true] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={isPublic === value}
                onClick={() => setPublic(value)}
                className={cn(
                  "h-7 rounded-sm text-muted-foreground",
                  isPublic === value && "bg-primary text-primary-foreground",
                )}
              >
                {value ? "Public" : "Secret (link only)"}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Making…" : "Make gist"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}
