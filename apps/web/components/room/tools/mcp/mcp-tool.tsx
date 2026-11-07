/** The MCP tool: the MCP servers listed in the room's .mcp.json, what each offers (tools, resources, prompts) and trying them, through the official MCP Inspector in the sandbox. */
"use client";

import { MCP_CONFIG_PATH, type McpInput, type McpOutput } from "@codechatter/contracts";
import { createFileAtPath, flatten, setText, textOf } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, Plug, Plus, RotateCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import * as Y from "yjs";

import { useFileTree } from "@/components/room/hooks";
import { useYSnapshot } from "@/components/room/notebook/use-y";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { addMcpServer, argumentsFrom, EXAMPLE_NAME, EXAMPLE_PATH, EXAMPLE_SERVER, fieldsOf, readMcpConfig, removeMcpServer, type McpServerEntry, type SchemaField } from "./config";

type McpTool = { name: string; description?: string; inputSchema?: unknown };
type McpResource = { uri: string; name?: string; description?: string; mimeType?: string };
type McpPrompt = { name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> };
type Ask = (input: McpInput) => Promise<McpOutput>;

const FIELD = "w-full rounded-sm border bg-background px-1.5 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70";

const stateVectorOf = (doc: Y.Doc) => {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** A tool's or prompt's answer: its text, and all of it as JSON beneath. */
function Answer({ output }: { output: McpOutput }) {
  if (!output.ok) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {output.error}
      </p>
    );
  }
  const result = output.result as { isError?: boolean; content?: Array<{ type?: string; text?: string }>; messages?: Array<{ role?: string; content?: { text?: string } }>; contents?: Array<{ text?: string }> };
  const texts = [
    ...(result.content ?? []).map((part) => (part.type === "text" ? part.text : `[${part.type}]`)),
    ...(result.messages ?? []).map((message) => `${message.role}: ${message.content?.text ?? ""}`),
    ...(result.contents ?? []).map((part) => part.text),
  ].filter((text): text is string => typeof text === "string");
  return (
    <div className="grid gap-1.5 text-xs">
      {result.isError && <p className="font-medium text-destructive">The tool reported a failure.</p>}
      {texts.length > 0 && <p className="rounded-sm bg-chrome p-1.5 font-mono leading-5 break-words whitespace-pre-wrap">{texts.join("\n")}</p>}
      <details>
        <summary className="cursor-pointer text-muted-foreground">The whole answer, in {output.ms.toLocaleString()} ms</summary>
        <pre tabIndex={0} role="group" aria-label="The whole answer" className="mt-1 max-h-72 overflow-auto rounded-sm border p-1.5 font-mono break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {JSON.stringify(output.result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function FormField({ field, value, onChange, disabled }: { field: SchemaField; value: string | boolean | undefined; onChange: (next: string | boolean) => void; disabled: boolean }) {
  const label = (
    <span className="text-xs">
      <span className="font-mono">{field.label}</span>
      {field.required && <span className="text-muted-foreground"> (needed)</span>}
      {field.description && <span className="text-muted-foreground"> · {field.description}</span>}
    </span>
  );
  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }
  if (field.kind === "choice") {
    return (
      <label className="grid gap-0.5">
        {label}
        <select value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={FIELD}>
          <option value="">{field.required ? "Choose" : "None"}</option>
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="grid gap-0.5">
      {label}
      {field.kind === "json" ? (
        <textarea rows={3} value={typeof value === "string" ? value : ""} disabled={disabled} spellCheck={false} placeholder="JSON" onChange={(event) => onChange(event.target.value)} className={FIELD} />
      ) : (
        <input type={field.kind === "number" ? "number" : "text"} step="any" value={typeof value === "string" ? value : ""} disabled={disabled} spellCheck={false} onChange={(event) => onChange(event.target.value)} className={FIELD} />
      )}
    </label>
  );
}

function ToolCard({ server, tool, ask }: { server: string; tool: McpTool; ask: Ask }) {
  const fields = useMemo(() => fieldsOf(tool.inputSchema), [tool.inputSchema]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<McpOutput | null>(null);
  const call = async () => {
    const built = argumentsFrom(fields, values);
    if ("problem" in built) return setProblem(built.problem);
    setProblem(null);
    setBusy(true);
    try {
      setOutput(await ask({ server, method: "tools/call", tool: tool.name, args: built.args }));
    } catch (error) {
      setOutput({ ok: false, error: error instanceof ApiError ? error.message : "Couldn't reach the server.", ms: 0 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={`Tool ${tool.name}`} className="grid min-w-0 content-start gap-2 rounded-md border p-2">
      <div>
        <h4 className="font-mono text-xs font-medium">{tool.name}</h4>
        {tool.description && <p className="text-xs text-muted-foreground">{tool.description}</p>}
      </div>
      {fields.length === 0 && <p className="text-xs text-muted-foreground">It takes nothing.</p>}
      <div className="grid gap-1.5">
        {fields.map((field) => (
          <FormField key={field.name} field={field} value={values[field.name]} disabled={busy} onChange={(next) => setValues((current) => ({ ...current, [field.name]: next }))} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="xs" disabled={busy} onClick={() => void call()}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />} Call {tool.name}
        </Button>
        {problem && <span className="text-xs text-destructive">{problem}</span>}
      </div>
      {output && <Answer output={output} />}
    </section>
  );
}

function ResourceRow({ server, resource, ask }: { server: string; resource: McpResource; ask: Ask }) {
  const [output, setOutput] = useState<McpOutput | null>(null);
  return (
    <li className="grid gap-1 rounded-md border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{resource.name ?? resource.uri}</span>
        <span className="font-mono text-muted-foreground">{resource.uri}</span>
        <Button size="xs" variant="outline" className="ml-auto" aria-label={`Read ${resource.name ?? resource.uri}`} onClick={() => void ask({ server, method: "resources/read", uri: resource.uri }).then(setOutput)}>
          Read
        </Button>
      </div>
      {resource.description && <p className="text-muted-foreground">{resource.description}</p>}
      {output && <Answer output={output} />}
    </li>
  );
}

function PromptRow({ server, prompt, ask }: { server: string; prompt: McpPrompt; ask: Ask }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState<McpOutput | null>(null);
  const missing = (prompt.arguments ?? []).some((argument) => argument.required && !values[argument.name]?.trim());
  return (
    <li className="grid gap-1.5 rounded-md border p-2 text-xs">
      <div>
        <span className="font-mono font-medium">{prompt.name}</span>
        {prompt.description && <span className="text-muted-foreground"> · {prompt.description}</span>}
      </div>
      {(prompt.arguments ?? []).map((argument) => (
        <label key={argument.name} className="grid gap-0.5">
          <span>
            <span className="font-mono">{argument.name}</span>
            {argument.required && <span className="text-muted-foreground"> (needed)</span>}
          </span>
          <input value={values[argument.name] ?? ""} spellCheck={false} onChange={(event) => setValues((current) => ({ ...current, [argument.name]: event.target.value }))} className={FIELD} />
        </label>
      ))}
      <div>
        <Button size="xs" variant="outline" disabled={missing} aria-label={`Get ${prompt.name}`} onClick={() => void ask({ server, method: "prompts/get", prompt: prompt.name, args: values }).then(setOutput)}>
          Get it
        </Button>
      </div>
      {output && <Answer output={output} />}
    </li>
  );
}

function ServerView({ server, configText, ask, editable, onRemove }: { server: McpServerEntry; configText: string; ask: Ask; editable: boolean; onRemove: () => void }) {
  const { room } = useRoom();
  const [view, setView] = useState<"tools" | "resources" | "prompts">("tools");
  const [open, setOpen] = useState<string | null>(null);
  const offers = useQuery({
    // Its entry changing is a reason to look again.
    queryKey: ["mcp-offers", room.id, server.name, configText],
    retry: false,
    queryFn: async () => {
      const [tools, resources, prompts] = await Promise.all((["tools/list", "resources/list", "prompts/list"] as const).map((method) => ask({ server: server.name, method })));
      const list = <T,>(output: McpOutput | undefined, key: string) => (output?.ok ? (((output.result as Record<string, unknown>)[key] as T[] | undefined) ?? []) : []);
      // A server needn't offer resources or prompts, so only failing to list its tools says it's not working.
      return { tools: list<McpTool>(tools, "tools"), resources: list<McpResource>(resources, "resources"), prompts: list<McpPrompt>(prompts, "prompts"), problem: tools?.ok === false ? tools.error : null };
    },
  });
  const data = offers.data;
  const counts = { tools: data?.tools.length ?? 0, resources: data?.resources.length ?? 0, prompts: data?.prompts.length ?? 0 };
  const tool = data?.tools.find((item) => item.name === open) ?? data?.tools[0];
  const failure = offers.error instanceof Error ? offers.error.message : (data?.problem ?? null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1">
        <h3 className="font-medium">{server.name}</h3>
        <code className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={server.url ?? server.command}>
          {server.url ?? server.command}
        </code>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" disabled={offers.isFetching} onClick={() => void offers.refetch()}>
            {offers.isFetching ? <Loader2 className="animate-spin" /> : <RotateCw />} Look again
          </Button>
          {editable && (
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${server.name}`} title="Remove this server from .mcp.json" onClick={onRemove}>
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-auto p-3">
        {offers.isPending && (
          <div className="grid gap-2" aria-label="Asking the server" aria-busy>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {failure && (
          <div role="alert" className="grid gap-1 text-xs">
            <p className="font-medium text-destructive">Couldn&apos;t talk to it.</p>
            <p className="font-mono break-words text-destructive">{failure}</p>
          </div>
        )}
        {data && !failure && (
          <>
            <div role="group" aria-label="What it offers" className="flex items-center gap-1">
              {(["tools", "resources", "prompts"] as const).map((name) => (
                <Button key={name} size="xs" variant={view === name ? "secondary" : "ghost"} aria-pressed={view === name} className="capitalize" onClick={() => setView(name)}>
                  {name} {counts[name]}
                </Button>
              ))}
            </div>
            {view === "tools" &&
              (counts.tools === 0 ? (
                <p className="text-xs text-muted-foreground">It offers no tools.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
                  <nav aria-label="Its tools" className="flex flex-wrap content-start gap-1 md:flex-col md:flex-nowrap">
                    {data.tools.map((item) => (
                      <button key={item.name} type="button" aria-current={item.name === tool?.name ? "true" : undefined} title={item.description} className={cn("min-h-6 truncate rounded-sm px-2 text-left font-mono text-xs hover:bg-accent", item.name === tool?.name && "bg-accent font-medium")} onClick={() => setOpen(item.name)}>
                        {item.name}
                      </button>
                    ))}
                  </nav>
                  {tool && <ToolCard key={tool.name} server={server.name} tool={tool} ask={ask} />}
                </div>
              ))}
            {view === "resources" &&
              (counts.resources === 0 ? (
                <p className="text-xs text-muted-foreground">It offers no resources.</p>
              ) : (
                <ul className="grid gap-2">
                  {data.resources.map((resource) => (
                    <ResourceRow key={resource.uri} server={server.name} resource={resource} ask={ask} />
                  ))}
                </ul>
              ))}
            {view === "prompts" &&
              (counts.prompts === 0 ? (
                <p className="text-xs text-muted-foreground">It offers no prompts.</p>
              ) : (
                <ul className="grid gap-2">
                  {data.prompts.map((prompt) => (
                    <PromptRow key={prompt.name} server={server.name} prompt={prompt} ask={ask} />
                  ))}
                </ul>
              ))}
            {!server.url && <p className="text-xs text-muted-foreground">A server started by a command starts afresh for each call, so it keeps nothing between them. One that stays up can run in a terminal, and be added by its address.</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default function McpTool(_props: RoomToolProps) {
  const { room, doc, me, can, synced } = useRoom();
  const tree = useFileTree();
  const editable = can("files.edit");
  const file = useMemo(() => flatten(tree).find((node) => node.path === MCP_CONFIG_PATH && node.kind === "file") ?? null, [tree]);
  const text = file ? textOf(doc, file.id) : undefined;
  const configText = useYSnapshot([text], () => text?.toString() ?? null);
  const config = useMemo(() => readMcpConfig(configText), [configText]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const current = config.servers.find((server) => server.name === selected) ?? config.servers[0] ?? null;

  const ask: Ask = (input) => api<McpOutput>(`/api/rooms/${room.id}/mcp`, { method: "POST", json: { ...input, stateVector: stateVectorOf(doc) } });

  /** Writes .mcp.json, making it if it isn't there. */
  const writeConfig = (next: string) => {
    if (text) setText(text, next);
    else createFileAtPath(doc, MCP_CONFIG_PATH, next, me.user.id);
  };

  const add = (serverName: string, serverTarget: string) => {
    const out = addMcpServer(configText, serverName, serverTarget);
    if ("problem" in out) return setProblem(out.problem);
    setProblem(null);
    writeConfig(out.text);
    setSelected(serverName.trim());
    setAdding(false);
    setName("");
    setTarget("");
  };

  const tryExample = () => {
    if (!flatten(tree).some((node) => node.path === EXAMPLE_PATH)) createFileAtPath(doc, EXAMPLE_PATH, EXAMPLE_SERVER, me.user.id);
    add(EXAMPLE_NAME, `node ${EXAMPLE_PATH}`);
  };

  const addForm = (
    <form
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        add(name, target);
      }}
    >
      <label className="grid gap-0.5 text-xs">
        Name
        <Input value={name} className="h-6 text-xs" maxLength={64} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="grid gap-0.5 text-xs">
        How to start it, or its address
        <Input value={target} className="h-6 font-mono text-xs" spellCheck={false} placeholder="node server.mjs" onChange={(event) => setTarget(event.target.value)} />
      </label>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-1">
        <Button size="xs" type="submit">
          Add it
        </Button>
        <Button size="xs" type="button" variant="ghost" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <section aria-label="MCP servers" className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Plug className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">MCP servers</h2>
        <span className="truncate text-xs text-muted-foreground">Through the official MCP Inspector, in this room&apos;s sandbox</span>
      </header>
      {config.problem && <p className="border-b px-3 py-1.5 text-xs text-brand-text">{config.problem}</p>}
      {!synced ? (
        <div className="grid gap-2 p-4" aria-label="Opening" aria-busy>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {config.servers.length > 0 && (
            <nav aria-label="Servers in this room" className="flex shrink-0 gap-1 overflow-x-auto border-b p-1.5 md:w-52 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0">
              {config.servers.map((server) => (
                <button key={server.name} type="button" aria-current={server.name === current?.name ? "true" : undefined} title={server.url ?? server.command} className={cn("min-h-6 shrink-0 truncate rounded-sm px-2 text-left text-xs hover:bg-accent md:w-full", server.name === current?.name && "bg-accent font-medium")} onClick={() => setSelected(server.name)}>
                  {server.name}
                </button>
              ))}
              {editable &&
                (adding ? (
                  addForm
                ) : (
                  <Button size="xs" variant="ghost" className="shrink-0 justify-start" onClick={() => setAdding(true)}>
                    <Plus /> Add a server
                  </Button>
                ))}
            </nav>
          )}
          {current ? (
            <ServerView key={current.name} server={current} configText={configText ?? ""} ask={ask} editable={editable} onRemove={() => writeConfig(removeMcpServer(configText ?? "{}", current.name))} />
          ) : (
            <div className="grid max-w-prose flex-1 content-start gap-2 overflow-auto p-4">
              <h3 className="font-medium">Try an MCP server from here</h3>
              <p className="text-xs text-muted-foreground">
                MCP is how AI tools reach other programs. Add a server you&apos;re writing or using, see the tools, resources and prompts it offers, and call them to check they work. Servers are kept in <code className="font-mono">.mcp.json</code>, the file other MCP tools read too.
              </p>
              {editable ? (
                <>
                  <div>
                    <Button size="xs" onClick={tryExample}>
                      <Play /> Try an example
                    </Button>
                  </div>
                  {addForm}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Nobody has added one in this room yet.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
