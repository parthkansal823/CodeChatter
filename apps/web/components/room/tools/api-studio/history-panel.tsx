"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { formatMs, methodLabel, methodTone, shortUrl, statusTone } from "./format";
import { clearHistory, HISTORY_LIMIT, useHistory } from "./local-store";
import { createRequest, findItem } from "./model";
import { useStudio } from "./studio-context";

/** Your last sends, kept in this browser only: no one else sees them. */
export function HistoryPanel() {
  const { roomId, user, tree, doc, canEdit, select } = useStudio();
  const [history] = useHistory(roomId, user.id);

  const open = (entry: (typeof history)[number]) => {
    if (entry.requestId && findItem(tree, entry.requestId)) {
      select(entry.requestId);
      return;
    }
    if (!canEdit) {
      toast.info("That request was deleted from the collection.");
      return;
    }
    select(createRequest(doc, { name: entry.name, method: entry.method, url: entry.url }));
    toast.success("Added it back to the collection.");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center px-2">
        <span className="mr-auto text-xs text-muted-foreground">Last {HISTORY_LIMIT} sends, on this device</span>
        <Button size="icon-xs" variant="ghost" aria-label="Clear history" title="Clear history" disabled={history.length === 0} onClick={() => clearHistory(roomId, user.id)}>
          <Trash2 />
        </Button>
      </div>
      {history.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">Nothing sent yet. Requests you send show up here.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="History">
          {history.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => open(entry)} className="flex w-full flex-col gap-0.5 px-3 py-1 text-left hover:bg-accent">
                <span className="flex items-center gap-1.5">
                  <span className={cn("w-8 shrink-0 text-right font-mono text-2xs font-semibold", methodTone(entry.method))}>{methodLabel(entry.method)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortUrl(entry.url) || entry.name}</span>
                </span>
                <span className="flex items-center gap-2 pl-[2.375rem] text-2xs text-muted-foreground">
                  {entry.status !== null ? <span className={cn("font-medium tabular-nums", statusTone(entry.status))}>{entry.status}</span> : <span className="text-destructive">Failed</span>}
                  <span className="tabular-nums">{formatMs(entry.timeMs)}</span>
                  <span>{formatRelativeTime(new Date(entry.at))}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
