"use client";

import { parseCurl, type CurlImport } from "@codechatter/contracts";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { focusUrlSoon } from "./collections-tree";
import { createRequest } from "./model";
import { useStudio } from "./studio-context";

function nameFor(imported: CurlImport): string {
  try {
    const url = new URL(imported.url);
    return `${imported.method} ${url.pathname === "/" ? url.host : url.pathname}`.slice(0, 80);
  } catch {
    return `${imported.method} ${imported.url}`.slice(0, 80);
  }
}

export function ImportDialog() {
  const { dialog, openDialog } = useStudio();
  return (
    <Dialog open={dialog?.kind === "import"} onOpenChange={(open) => !open && openDialog(null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>Paste a cURL command, like the one browser dev tools give you with Copy as cURL.</DialogDescription>
        </DialogHeader>
        <CurlPanel />
      </DialogContent>
    </Dialog>
  );
}

function CurlPanel() {
  const { doc, select, openDialog, canEdit } = useStudio();
  const [text, setText] = useState("");
  const parsed = useMemo((): { ok: true; value: CurlImport } | { ok: false; error: string } | null => {
    if (!text.trim()) return null;
    try {
      return { ok: true, value: parseCurl(text) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Couldn't read that command." };
    }
  }, [text]);

  const add = () => {
    if (!parsed?.ok) return;
    const { value } = parsed;
    select(createRequest(doc, { name: nameFor(value), method: value.method, url: value.url, headers: value.headers, body: value.body, auth: value.auth }));
    openDialog(null);
    toast.success("Imported the request.");
    focusUrlSoon();
  };

  return (
    <>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="cURL command"
        placeholder={"curl -X POST https://api.example.com/items \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"Ada\"}'"}
        spellCheck={false}
        className="max-h-64 min-h-32 font-mono text-sm md:text-sm"
      />
      <div role="status" className="min-h-10 text-sm">
        {parsed?.ok === false && <p className="text-destructive">{parsed.error}</p>}
        {parsed?.ok && (
          <div className="grid gap-1">
            <p>
              <span className="font-mono font-medium">{parsed.value.method}</span> <span className="font-mono break-all">{parsed.value.url}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {parsed.value.headers.length} {parsed.value.headers.length === 1 ? "header" : "headers"}
              {parsed.value.body.mode !== "none" && `, ${parsed.value.body.mode === "graphql" ? "a GraphQL" : `a ${parsed.value.body.mode}`} body`}
              {parsed.value.auth.type !== "none" && `, ${parsed.value.auth.type === "apiKey" ? "an API key" : parsed.value.auth.type} auth`}.
            </p>
            {parsed.value.warnings.map((warning) => (
              <p key={warning} className="text-xs text-warning">
                {warning}
              </p>
            ))}
            {parsed.value.auth.type !== "none" && (
              <p className="text-xs text-warning">Credentials in this command will be saved in the shared collection. Move them into a secret variable after importing.</p>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => openDialog(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={!parsed?.ok || !canEdit} onClick={add}>
          Add to collection
        </Button>
      </DialogFooter>
      {!canEdit && <p className="text-xs text-muted-foreground">You can look at this room but not edit it, so you can&apos;t add requests.</p>}
    </>
  );
}
