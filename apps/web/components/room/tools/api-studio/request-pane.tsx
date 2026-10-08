"use client";

import { HTTP_METHODS, substituteVariables, type HttpMethod } from "@codechatter/contracts";
import { Code2, Copy, Ellipsis, Send, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PresenceAvatar } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";

import { AuthEditor } from "./auth-editor";
import { BodyEditor } from "./body-editor";
import { CompactSelect } from "./compact-select";
import { methodTone } from "./format";
import { KeyValueTable } from "./key-value-table";
import { duplicateRequest, renameNode, setField, type RequestData } from "./model";
import { StudioTabs, TabCount } from "./studio-tabs";
import { useStudio } from "./studio-context";
import { TestsEditor } from "./tests-editor";
import { UrlInput } from "./url-input";

type Tab = "params" | "headers" | "body" | "auth" | "tests";

export function RequestPane({ request }: { request: RequestData }) {
  const { doc, canEdit, canSend, send, cancel, runs, peers, lookup, select, openDialog } = useStudio();
  const [tab, setTab] = useState<Tab>("params");
  const sending = runs[request.id]?.phase === "sending";
  const here = peers.filter((peer) => peer.requestId === request.id);
  const missing = substituteVariables(request.url, lookup).missing;

  const submit = () => {
    if (canSend && !sending) void send(request.id);
  };

  const enabled = (rows: Array<{ enabled: boolean }>) => rows.filter((row) => row.enabled).length;

  return (
    <section aria-label="Request" className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <input
          key={`${request.id}-${request.name}`}
          defaultValue={request.name}
          readOnly={!canEdit}
          aria-label="Request name"
          maxLength={120}
          onBlur={(event) => event.target.value.trim() !== request.name && renameNode(doc, request.id, event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className="h-6 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm font-medium outline-none hover:bg-accent focus:bg-accent"
        />
        {here.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5" aria-label={`Also on this request: ${here.map((p) => p.user.name).join(", ")}`}>
            {here.slice(0, 4).map((peer) => (
              <PresenceAvatar key={peer.user.id} name={peer.user.name} slot={peer.user.slot} image={peer.user.image} size={20} />
            ))}
          </div>
        )}
        <Button size="xs" variant="ghost" onClick={() => openDialog({ kind: "snippets", requestId: request.id })}>
          <Code2 /> Code
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="More actions for this request">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem
                onSelect={() => {
                  const copy = duplicateRequest(doc, request.id);
                  if (copy) select(copy);
                }}
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openDialog({ kind: "snippets", requestId: request.id })}>
              <Code2 /> Code snippets
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => openDialog({ kind: "delete", id: request.id })}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b p-2">
        <CompactSelect
          label="Method"
          value={request.method}
          onChange={(method: HttpMethod) => setField(doc, request.id, "method", method)}
          options={HTTP_METHODS.map((id) => ({ id, label: id }))}
          disabled={!canEdit}
          className={`w-28 font-mono font-medium ${methodTone(request.method)}`}
        />
        <UrlInput requestId={request.id} onSubmit={submit} />
        {sending ? (
          <Button size="sm" variant="secondary" onClick={() => cancel(request.id)}>
            <Square /> Cancel
          </Button>
        ) : (
          <span title={canSend ? "Send (Ctrl+Enter)" : "You can look at this room but not send requests. Ask the owner for run access."}>
            <Button size="sm" variant="brand" disabled={!canSend} onClick={submit}>
              <Send /> Send
            </Button>
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <p className="shrink-0 border-b bg-panel px-3 py-1 text-xs text-warning">
          No value for {missing.map((name) => `{{${name}}}`).join(", ")}. Pick an environment, or add {missing.length > 1 ? "them" : "it"} under Environments.
        </p>
      )}

      <StudioTabs
        label="Request"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "params", label: <>Params <TabCount n={enabled(request.params)} /></> },
          { id: "headers", label: <>Headers <TabCount n={enabled(request.headers)} /></> },
          { id: "body", label: <>Body {request.body.mode !== "none" && <span className="text-2xs font-normal text-muted-foreground">{request.body.mode === "graphql" ? "GraphQL" : request.body.mode === "json" ? "JSON" : request.body.mode === "form" ? "Form" : "Text"}</span>}</> },
          { id: "auth", label: <>Auth {request.auth.type !== "none" && <span className="size-1.5 rounded-full bg-brand" aria-label="Auth is set" />}</> },
          { id: "tests", label: <>Tests <TabCount n={request.assertions.length + request.extracts.length} /></> },
        ]}
      >
        <span className="hidden items-center gap-1 text-xs text-muted-foreground lg:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd> to send
        </span>
      </StudioTabs>
      <div role="tabpanel" aria-label={tab} className="min-h-0 flex-1 overflow-auto">
        {tab === "params" && <KeyValueTable ownerId={request.id} list="params" rows={request.params} keyLabel="Parameter" addLabel="Add parameter" emptyHint="No query parameters. Add one here or type ?name=value in the URL." />}
        {tab === "headers" && <KeyValueTable ownerId={request.id} list="headers" rows={request.headers} keyLabel="Header" addLabel="Add header" suggestHeaders warnSecrets emptyHint="No headers. Host, Content-Length and a Content-Type for the body are added when you send." />}
        {tab === "body" && <BodyEditor request={request} />}
        {tab === "auth" && <AuthEditor request={request} />}
        {tab === "tests" && <TestsEditor request={request} />}
      </div>
    </section>
  );
}

export function copyToast(ok: boolean, what: string) {
  if (ok) toast.success(`Copied ${what}.`);
  else toast.error(`Couldn't copy ${what}. Select it and copy by hand.`);
}
