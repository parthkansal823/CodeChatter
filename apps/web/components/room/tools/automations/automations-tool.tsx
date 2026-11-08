/** The Automations tool: flows as a chart of boxes and arrows, with what ran and failed lit up on it and the data at every step, as n8n shows them. Each flow is a file in the room in Activepieces' own format, run in the room's sandbox by Activepieces' real engine and pieces. */
"use client";

import { isFlowFile, type AutomationInput, type AutomationLive, type AutomationManifest } from "@codechatter/contracts";
import { createFileAtPath, findByPath, flatten } from "@codechatter/workspace-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode, Plus, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

import { useFileTree } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";

import { ExamplesView } from "./examples-view";
import { FlowFileView } from "./flow-view";
import { newTrigger, SCHEMA_VERSION, type Flow } from "./model";

const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const WEBHOOK = "@activepieces/piece-webhook";

/** A file name from a name someone chose. */
const fileNameOf = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "automation"}.flow.json`;

export function newFlowFile(doc: Y.Doc, by: string, flow: Flow, taken: (path: string) => boolean): string {
  const base = fileNameOf(flow.displayName);
  let path = `automations/${base}`;
  for (let copy = 2; taken(path); copy++) path = `automations/${base.replace(/\.flow\.json$/, `-${copy}.flow.json`)}`;
  createFileAtPath(doc, path, `${JSON.stringify({ id: `flow_${crypto.randomUUID()}`, ...flow }, null, 2)}\n`, by);
  return path;
}

export default function AutomationsTool({ openFile }: RoomToolProps) {
  const { room, doc, me, can } = useRoom();
  const tree = useFileTree();
  const queryClient = useQueryClient();
  const canEdit = can("files.edit");
  const ask = <T,>(input: AutomationInput) => api<T>(`/api/rooms/${room.id}/automations`, { method: "POST", json: input });

  const manifest = useQuery({ queryKey: ["automations", "manifest", room.id], queryFn: () => ask<AutomationManifest>({ op: "manifest" }), staleTime: Number.POSITIVE_INFINITY, retry: false });
  const status = useQuery({
    queryKey: ["automations", room.id, "status"],
    queryFn: () => ask<AutomationLive>({ op: "status" }),
    staleTime: 0,
    retry: false,
    // While something's running, each step shows as it happens; anyone with this open sees it.
    refetchInterval: (query) => (query.state.data?.state === "running" ? 1000 : 8000),
  });
  const live = status.data;
  const version = `${live?.id ?? "none"}-${live?.state ?? "idle"}`;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    if (live?.state !== "running") void queryClient.invalidateQueries({ queryKey: ["automations", room.id, "run"] });
  }, [version, live?.state, queryClient, room.id]);

  const flows = flatten(tree).filter((node) => node.kind === "file" && !node.blob && isFlowFile(node.name));
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "examples">("flow");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [wanted, setWanted] = useState<string | null>(null);
  const current = flows.find((node) => node.path === (wanted ?? chosen)) ?? flows.find((node) => node.path === chosen) ?? flows[0] ?? null;
  // A file just made isn't in the list until the tree has caught up.
  if (wanted && flows.some((node) => node.path === wanted)) {
    setChosen(wanted);
    setWanted(null);
  }

  const pieces = manifest.data?.pieces;
  const taken = (path: string) => Boolean(findByPath(doc, path));
  const addFlow = (flow: Flow) => {
    setWanted(newFlowFile(doc, me.user.id, flow, taken));
    setView("flow");
  };
  const create = () => {
    const webhook = pieces?.[WEBHOOK];
    if (!webhook || !name.trim()) return;
    addFlow({ displayName: name.trim(), schemaVersion: SCHEMA_VERSION, trigger: newTrigger(WEBHOOK, webhook, "catch_webhook") });
    setName("");
    setNaming(false);
  };

  return (
    <section aria-label="Automations" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1">
        <Workflow className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Automations</h2>
        {flows.length > 0 && view === "flow" && (
          <select aria-label="Automation to show" className="h-7 max-w-64 rounded-md border bg-background px-2 text-xs" value={current?.path ?? ""} onChange={(event) => setChosen(event.target.value)}>
            {flows.map((node) => (
              <option key={node.id} value={node.path}>
                {node.name.replace(/\.flow\.json$/i, "")}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {canEdit && current && view === "flow" && (
            <Button size="xs" variant="ghost" onClick={() => openFile(current.id)}>
              <FileCode /> Its file
            </Button>
          )}
          <Button size="xs" variant={view === "examples" ? "secondary" : "ghost"} aria-pressed={view === "examples"} onClick={() => setView(view === "examples" ? "flow" : "examples")}>
            Examples
          </Button>
          {canEdit && pieces &&
            (naming ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  create();
                }}
              >
                <Input autoFocus aria-label="Name of the new automation" className="h-7 w-48 text-xs" value={name} onChange={(event) => setName(event.target.value)} />
                <Button size="xs" type="submit">
                  Make it
                </Button>
                <Button size="xs" type="button" variant="ghost" onClick={() => setNaming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <Button size="xs" onClick={() => setNaming(true)}>
                <Plus /> New automation
              </Button>
            ))}
        </div>
      </header>

      {manifest.isPending ? (
        <div role="status" aria-label="Reading what's available" aria-busy className="grid gap-2 p-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : manifest.isError ? (
        <p role="alert" className="max-w-prose p-3 text-xs text-destructive">
          {failure(manifest.error)}
        </p>
      ) : view === "examples" ? (
        <ExamplesView pieces={pieces ?? {}} canEdit={canEdit} onUse={addFlow} />
      ) : !current ? (
        <div className="grid max-w-prose gap-2 p-3">
          <h3 className="font-medium">Make things happen by themselves</h3>
          <p className="text-xs text-muted-foreground">An automation is a chart of steps: something starts it, and each step passes on what it found. Steps can be code, or real services like GitHub and Slack, and they run in this room&apos;s sandbox, so what one room keeps stays in that room.</p>
          <p className="text-xs text-muted-foreground">Each is a file in this room, and you can see what every step took in and gave out on every run.</p>
          <div>
            <Button size="xs" onClick={() => setView("examples")}>
              See the examples
            </Button>
          </div>
        </div>
      ) : pieces ? (
        <FlowFileView key={current.id} node={current} pieces={pieces} live={live} ask={ask} version={version} />
      ) : null}
    </section>
  );
}
