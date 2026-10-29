"use client";

import type {
  KubeCheck,
  KubeEvent,
  KubeItem,
  KubeKind,
  KubeRef,
  KubeRequest,
  KubeResources,
  KubeStatus,
} from "@codechatter/contracts";
import { textOf } from "@codechatter/workspace-model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CircleAlert, CircleCheck, ListChecks, Loader2, Play, RefreshCw, Square, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ label: string; kinds: Array<[KubeKind, string]> }> = [
  {
    label: "Workloads",
    kinds: [
      ["deployment", "Deployments"],
      ["statefulset", "StatefulSets"],
      ["daemonset", "DaemonSets"],
      ["job", "Jobs"],
      ["cronjob", "CronJobs"],
      ["pod", "Pods"],
    ],
  },
  {
    label: "Network",
    kinds: [
      ["service", "Services"],
      ["ingress", "Ingresses"],
    ],
  },
  { label: "Config", kinds: [["configmap", "ConfigMaps"]] },
  {
    label: "Cluster",
    kinds: [
      ["namespace", "Namespaces"],
      ["node", "Nodes"],
    ],
  },
];
const KIND_LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.kinds)) as Record<KubeKind, string>;
const CLUSTER_WIDE = new Set<KubeKind>(["namespace", "node"]);
const ALL = "*";

const isManifest = (name: string) => /\.(ya?ml|json)$/i.test(name);
const failure = (error: unknown) =>
  error instanceof ApiError ? error.detail : "The playground didn't answer. Try again.";

/** "4m", "2h", "3d": how long ago, from the moment the list was fetched. */
function ageOf(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * The room's Kubernetes panel (roadmap §14 F), like Lens or VS Code's Kubernetes view,
 * on the playground in the room's sandbox (`k8s up`): start and stop it, its workloads,
 * services, config, namespaces, nodes and events, any object's YAML and description,
 * delete, and apply the open manifest in one click. Check tests the open manifest against
 * the Kubernetes schemas without the playground running (kubeconform). Pods are simulated,
 * so there are no logs or port-forwards yet.
 */
export default function KubernetesTool({ activeFile, close }: RoomToolProps) {
  const { room, doc } = useRoom();
  const client = useQueryClient();
  const kube = <T,>(body: KubeRequest) =>
    api<T>(`/api/rooms/${room.id}/kube`, { method: "POST", json: body });
  const status = useQuery({
    queryKey: ["kube-status", room.id],
    queryFn: () => kube<KubeStatus>({ op: "status" }),
    refetchInterval: 15_000,
  });
  const running = status.data?.running === true;
  const resources = useQuery({
    queryKey: ["kube-resources", room.id],
    queryFn: () => kube<KubeResources>({ op: "resources" }),
    enabled: running,
    refetchInterval: 5_000,
  });
  const [kind, setKind] = useState<KubeKind | "events">("deployment");
  const [namespace, setNamespace] = useState(ALL);
  const [selected, setSelected] = useState<KubeRef | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["kube-resources", room.id] });

  const power = useMutation({
    mutationFn: (op: "up" | "down") => kube<{ output: string }>({ op }),
    onSuccess: (_, op) => {
      setSelected(null);
      void client.invalidateQueries({ queryKey: ["kube-status", room.id] });
      void refresh();
      toast.success(op === "up" ? "The playground is up" : "The playground is stopped");
    },
    onError: (error) => toast.error(failure(error)),
  });
  const apply = useMutation({
    mutationFn: (text: string) => kube<{ output: string }>({ op: "apply", text }),
    onSuccess: ({ output }) => {
      void refresh();
      toast.success(output || "Applied");
    },
    onError: (error) => toast.error(failure(error)),
  });
  const openText = () => {
    if (!activeFile) return null;
    const text = textOf(doc, activeFile.id)?.toString() ?? "";
    if (!text.trim()) toast.error(`${activeFile.name} is empty.`);
    return text.trim() ? text : null;
  };
  const applyOpenFile = () => {
    const text = openText();
    if (text) apply.mutate(text);
  };
  const check = useMutation({
    mutationFn: ({ text }: { text: string; file: string }) => kube<KubeCheck>({ op: "check", text }),
    onError: (error) => toast.error(failure(error)),
  });
  const checkOpenFile = () => {
    const text = openText();
    if (text && activeFile) check.mutate({ text, file: activeFile.name });
  };

  const items = useMemo(() => resources.data?.items ?? [], [resources.data]);
  const namespaces = items.filter((item) => item.kind === "namespace").map((item) => item.name);
  const inNamespace = (ns: string | null) => namespace === ALL || ns === namespace;
  const counts = new Map<KubeKind, number>();
  for (const item of items)
    if (CLUSTER_WIDE.has(item.kind) || inNamespace(item.namespace))
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const show = (next: KubeKind | "events") => {
    setKind(next);
    setSelected(null);
  };
  const events = (resources.data?.events ?? []).filter((event) => inNamespace(event.namespace));
  const warnings = events.filter((event) => event.type === "Warning").length;
  const shown =
    kind === "events"
      ? []
      : items.filter((item) => item.kind === kind && (CLUSTER_WIDE.has(kind) || inNamespace(item.namespace)));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-chrome px-3">
        <Boxes className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Kubernetes</h2>
        {status.data?.available && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className={cn("size-2 rounded-full", running ? "bg-success" : "bg-muted-foreground/40")}
            />
            {power.isPending
              ? power.variables === "up"
                ? "Starting…"
                : "Stopping…"
              : running
                ? "Playground running"
                : "Playground stopped"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {status.data?.available && activeFile && isManifest(activeFile.name) && (
            <Button
              size="xs"
              variant="ghost"
              disabled={check.isPending}
              onClick={checkOpenFile}
              title="Check it against the Kubernetes schemas, without a cluster"
            >
              {check.isPending ? <Loader2 className="animate-spin" /> : <ListChecks />} Check
            </Button>
          )}
          {running && activeFile && isManifest(activeFile.name) && (
            <Button
              size="xs"
              variant="outline"
              disabled={apply.isPending}
              onClick={applyOpenFile}
              title="kubectl apply, with the file as it is in the editor"
            >
              {apply.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Apply {activeFile.name}
            </Button>
          )}
          {status.data?.available &&
            (running ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={power.isPending}
                onClick={() => power.mutate("down")}
              >
                <Square /> Stop
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={power.isPending}
                onClick={() => power.mutate("up")}
              >
                {power.isPending ? <Loader2 className="animate-spin" /> : <Play />} Start
              </Button>
            ))}
          {running && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh"
              disabled={resources.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCw className={cn(resources.isFetching && "animate-spin")} />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
            <X />
          </Button>
        </div>
      </header>
      {check.data && check.variables && (
        <CheckResults result={check.data} file={check.variables.file} onClose={() => check.reset()} />
      )}

      {status.isPending ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-32" />
        </div>
      ) : status.isError ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {failure(status.error)}
        </p>
      ) : !status.data.available ? (
        <Explainer>
          The Kubernetes playground comes with the full sandbox image (
          <span className="font-mono">codechatter-sandbox:full</span>). Ask whoever runs this server to use
          it.
        </Explainer>
      ) : !running ? (
        <Explainer>
          A real Kubernetes API server runs inside this room’s sandbox: Deployments roll out, Services get
          addresses, Helm installs charts. Pods are simulated, so no containers run. Start it here or with{" "}
          <span className="font-mono">k8s up</span> in a terminal; everyone in the room sees the same cluster.
        </Explainer>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Kinds" className="w-48 shrink-0 overflow-y-auto border-r bg-panel py-2 text-xs">
            <div className="px-2 pb-2">
              <Select value={namespace} onValueChange={setNamespace}>
                <SelectTrigger size="sm" aria-label="Namespace" className="w-full text-xs data-[size=sm]:h-7">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All namespaces</SelectItem>
                  {namespaces.map((ns) => (
                    <SelectItem key={ns} value={ns}>
                      {ns}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {GROUPS.map((group) => (
              <div key={group.label} className="pb-2">
                <p className="px-3 py-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                {group.kinds.map(([id, label]) => (
                  <KindButton
                    key={id}
                    label={label}
                    count={counts.get(id) ?? 0}
                    active={kind === id}
                    onClick={() => show(id)}
                  />
                ))}
              </div>
            ))}
            <KindButton
              label="Events"
              count={warnings}
              warn={warnings > 0}
              active={kind === "events"}
              onClick={() => show("events")}
            />
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            {resources.isError ? (
              <p role="alert" className="p-4 text-sm text-destructive">
                {failure(resources.error)}
              </p>
            ) : !resources.data ? (
              <div className="grid gap-2 p-4">
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
              </div>
            ) : kind === "events" ? (
              <EventsTable events={events} now={resources.dataUpdatedAt} />
            ) : (
              <ObjectsTable
                kind={kind}
                items={shown}
                now={resources.dataUpdatedAt}
                selected={selected}
                onSelect={setSelected}
              />
            )}
            {selected && (
              <ObjectDetail
                key={`${selected.kind}/${selected.namespace}/${selected.name}`}
                target={selected}
                onClose={() => setSelected(null)}
                onDeleted={() => {
                  setSelected(null);
                  void refresh();
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Explainer({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-xl p-6 text-sm text-muted-foreground">{children}</p>;
}

function KindButton({
  label,
  count,
  active,
  warn = false,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-6 w-full items-center px-3 text-left hover:bg-accent",
        active && "bg-accent font-medium",
      )}
    >
      {label}
      <span className={cn("ml-auto font-mono text-muted-foreground", warn && "text-destructive")}>
        {count || ""}
      </span>
    </button>
  );
}

function Health({ healthy }: { healthy: boolean | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        healthy === true ? "bg-success" : healthy === false ? "bg-destructive" : "bg-muted-foreground/40",
      )}
    />
  );
}

function ObjectsTable({
  kind,
  items,
  now,
  selected,
  onSelect,
}: {
  kind: KubeKind;
  items: KubeItem[];
  now: number;
  selected: KubeRef | null;
  onSelect: (ref: KubeRef) => void;
}) {
  if (!items.length)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No {KIND_LABEL[kind]} here. Apply a manifest (open it, then Apply), or use kubectl in a terminal.
      </p>
    );
  const namespaced = !CLUSTER_WIDE.has(kind);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table aria-label={KIND_LABEL[kind]} className="w-full text-xs">
        <thead className="sticky top-0 bg-panel text-left text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-1.5 font-medium">Name</th>
            {namespaced && <th className="px-3 py-1.5 font-medium">Namespace</th>}
            <th className="px-3 py-1.5 font-medium">Status</th>
            <th className="px-3 py-1.5 font-medium">Details</th>
            <th className="px-3 py-1.5 text-right font-medium">Age</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const active =
              selected?.kind === item.kind &&
              selected.name === item.name &&
              selected.namespace === item.namespace;
            return (
              <tr
                key={`${item.namespace}/${item.name}`}
                aria-selected={active}
                onClick={() => onSelect({ kind: item.kind, namespace: item.namespace, name: item.name })}
                className={cn("cursor-pointer border-b hover:bg-accent", active && "bg-accent")}
              >
                <td className="px-3 py-1.5 font-mono">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => onSelect({ kind: item.kind, namespace: item.namespace, name: item.name })}
                  >
                    {item.name}
                  </button>
                </td>
                {namespaced && <td className="px-3 py-1.5 text-muted-foreground">{item.namespace}</td>}
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <Health healthy={item.healthy} />
                    {item.status}
                  </span>
                </td>
                <td className="max-w-64 truncate px-3 py-1.5 text-muted-foreground" title={item.detail}>
                  {item.detail}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{ageOf(item.createdAt, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EventsTable({ events, now }: { events: KubeEvent[]; now: number }) {
  if (!events.length) return <p className="p-4 text-sm text-muted-foreground">No events.</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table aria-label="Events" className="w-full text-xs">
        <thead className="sticky top-0 bg-panel text-left text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-1.5 font-medium">Type</th>
            <th className="px-3 py-1.5 font-medium">Reason</th>
            <th className="px-3 py-1.5 font-medium">Object</th>
            <th className="px-3 py-1.5 font-medium">Message</th>
            <th className="px-3 py-1.5 text-right font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={index} className="border-b align-top">
              <td className={cn("px-3 py-1.5", event.type === "Warning" && "text-destructive")}>
                {event.type}
              </td>
              <td className="px-3 py-1.5">{event.reason}</td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground">{event.object}</td>
              <td className="px-3 py-1.5">
                {event.message}
                {event.count > 1 && <span className="text-muted-foreground"> (×{event.count})</span>}
              </td>
              <td className="px-3 py-1.5 text-right whitespace-nowrap text-muted-foreground">
                {ageOf(event.lastSeen, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One object: its YAML or description from kubectl, and Delete (asked twice). */
function ObjectDetail({
  target,
  onClose,
  onDeleted,
}: {
  target: KubeRef;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { room } = useRoom();
  const [view, setView] = useState<"yaml" | "describe">("yaml");
  const [confirming, setConfirming] = useState(false);
  const object = useQuery({
    queryKey: ["kube-object", room.id, target, view],
    queryFn: () =>
      api<{ output: string }>(`/api/rooms/${room.id}/kube`, {
        method: "POST",
        json: { op: "object", ref: target, view },
      }),
  });
  const remove = useMutation({
    mutationFn: () =>
      api<{ output: string }>(`/api/rooms/${room.id}/kube`, {
        method: "POST",
        json: { op: "delete", ref: target },
      }),
    onSuccess: ({ output }) => {
      toast.success(output || "Deleted");
      onDeleted();
    },
    onError: (error) => toast.error(failure(error)),
  });
  const label = `${target.kind} ${target.namespace ? `${target.namespace}/` : ""}${target.name}`;
  return (
    <section aria-label={`Details of ${label}`} className="flex h-1/2 min-h-40 shrink-0 flex-col border-t">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="min-w-0 truncate font-mono">{label}</span>
        <div role="tablist" aria-label="View" className="ml-3 flex">
          {(["yaml", "describe"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "h-6 rounded-sm px-2 text-muted-foreground",
                view === v && "bg-accent text-foreground",
              )}
            >
              {v === "yaml" ? "YAML" : "Describe"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {confirming ? (
            <>
              <Button
                size="xs"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Delete {target.name}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Delete ${label}`}
              onClick={() => setConfirming(true)}
            >
              <Trash2 />
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" aria-label="Close the details" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-panel">
        {object.isPending ? (
          <Skeleton className="m-3 h-20" />
        ) : object.isError ? (
          <p role="alert" className="p-3 text-xs text-destructive">
            {failure(object.error)}
          </p>
        ) : (
          <pre
            aria-label={view === "yaml" ? "YAML" : "Description"}
            className="p-3 font-mono text-xs leading-relaxed whitespace-pre"
          >
            {object.data.output}
          </pre>
        )}
      </div>
    </section>
  );
}

/** A manifest's check: a line for each object, with where each error is. */
function CheckResults({ result, file, onClose }: { result: KubeCheck; file: string; onClose: () => void }) {
  const bad = result.objects.filter((o) => o.status === "invalid" || o.status === "error").length;
  return (
    <section
      aria-label="Check results"
      className="max-h-[40%] shrink-0 overflow-y-auto border-b bg-panel px-3 py-2 text-xs"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium">
          {result.objects.length === 0
            ? `${file}: no Kubernetes objects in it.`
            : bad === 0
              ? `${file}: ${result.objects.length === 1 ? "it matches" : `all ${result.objects.length} match`} the schemas.`
              : `${file}: ${bad} of ${result.objects.length} ${result.objects.length === 1 ? "object has" : "objects have"} problems.`}
        </span>
        <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Close the check" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ul className="grid gap-1">
        {result.objects.map((object, i) => (
          <li key={i}>
            <div className="flex items-center gap-1.5">
              {object.status === "valid" ? (
                <CircleCheck className="size-3.5 text-success" />
              ) : object.status === "skipped" ? (
                <CircleCheck className="size-3.5 text-muted-foreground" />
              ) : (
                <CircleAlert className="size-3.5 text-destructive" />
              )}
              <span className="font-mono">
                {object.kind || "?"}
                {object.name ? `/${object.name}` : ""}
              </span>
              {object.status === "skipped" && (
                <span className="text-muted-foreground">no schema (a custom resource?), not checked</span>
              )}
              {object.message && <span className="text-destructive">{object.message}</span>}
            </div>
            {object.errors.length > 0 && (
              <ul className="mt-0.5 grid gap-0.5 pl-5">
                {object.errors.map((error, j) => (
                  <li key={j}>
                    <span className="font-mono text-muted-foreground">{error.path}</span>{" "}
                    <span className="text-destructive">{error.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
