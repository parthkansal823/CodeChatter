"use client";

import { Check, Copy, Globe2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/clipboard";
import { formatRelativeTime } from "@/lib/format";

import { useDocs } from "./docs-context";
import { setPublished, titleOf, type PageRecord } from "./pages-model";
import { publicUrl, writePublished } from "./publish";

type Props = {
  page: PageRecord;
  /** Markdown of the page as it is now. */
  markdown: () => string | null;
};

/** Share a page read-only with anyone who has the link. */
export function SharePopover({ page, markdown }: Props) {
  const { roomId, indexDoc, editable } = useDocs();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const published = Boolean(page.publishToken);
  const link = page.publishToken ? publicUrl(roomId, page.id, page.publishToken) : "";

  const publishNow = async (on: boolean) => {
    const body = on ? markdown() : null;
    if (on && body === null) return;
    setBusy(true);
    try {
      if (on) {
        setPublished(indexDoc, page.id, true);
        await writePublished(roomId, page.id, { title: titleOf(page), markdown: body!, updatedAt: Date.now() });
        toast.success("Page published. Anyone with the link can read it.");
      } else {
        setPublished(indexDoc, page.id, false);
        await writePublished(roomId, page.id, null);
        toast.success("Page unpublished. The link no longer works.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't change publishing. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else toast.message(link);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={published ? "secondary" : "ghost"} size="xs">
          <Globe2 /> {published ? "Published" : "Share"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p id="publish-label" className="text-sm font-medium">
              Publish to the web
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">Anyone with the link can read this page. They can&apos;t edit it or see the rest of the room.</p>
          </div>
          <Switch aria-labelledby="publish-label" checked={published} disabled={!editable || busy} onCheckedChange={(on) => void publishNow(on)} />
        </div>
        {published && (
          <div className="mt-3 grid gap-2">
            <div className="flex gap-1.5">
              <Input readOnly aria-label="Public link" value={link} onFocus={(e) => e.currentTarget.select()} className="h-7 font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {page.publishedAt ? `Published ${formatRelativeTime(new Date(page.publishedAt))}. ` : ""}Edits reach the published copy a few seconds after you stop typing.
            </p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void publishNow(true)}>
              Update published copy now
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
