/**
 * The room's connections for automations (apps/api/src/automations/connections.ts): the sign-ins its pieces use, as n8n's credentials. The Connections
 * dialog lists them for anyone who can run the room's code and lets its owners add, replace and remove them, with the fields each piece describes for its
 * own sign-in; Test tries one in the room's sandbox. A step that needs one chooses it by name ({{connections['name']}}). What's kept is sealed on the
 * server and never shown again: only a connection's name, piece and the fields that aren't secret come back.
 */
"use client";

import { connectionExpression, connectionNameOf, type AutomationConnection, type AutomationConnectionInput, type ConnectionValue, type PieceField, type PieceInfo } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";

const OPEN_EVENT = "cc:automation-connections";
const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const KIND_NAMES: Record<string, string> = { SECRET_TEXT: "A secret", BASIC_AUTH: "A user and password", CUSTOM_AUTH: "Its own fields", OAUTH2: "Signing in with OAuth" };

/** Opens the Connections dialog from anywhere in the tool, for a piece when given. */
export function openConnections(piece?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { piece } }));
}

export function useConnections(enabled = true) {
  const { room } = useRoom();
  return useQuery({ queryKey: ["automations", room.id, "connections"], queryFn: () => api<AutomationConnection[]>(`/api/rooms/${room.id}/automations/connections`), enabled, retry: false });
}

/** A name for a new connection: the piece's, in lower case, with dashes. */
const nameFor = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "connection";

/** What's typed, as Activepieces keeps a connection's value. */
function valueOf(auth: NonNullable<PieceInfo["auth"]>, typed: Record<string, unknown>): ConnectionValue {
  if (auth.type === "SECRET_TEXT") return { type: "SECRET_TEXT", secret_text: String(typed.secret_text ?? "") };
  if (auth.type === "BASIC_AUTH") return { type: "BASIC_AUTH", username: String(typed.username ?? ""), password: String(typed.password ?? "") };
  const props: Record<string, string | number | boolean | null> = {};
  for (const [name, spec] of Object.entries(auth.fields)) {
    const value = typed[name] ?? spec.default;
    if (value === undefined || value === "") continue;
    props[name] = spec.type === "NUMBER" ? Number(value) : spec.type === "CHECKBOX" ? value === true : (value as string);
  }
  return { type: "CUSTOM_AUTH", props };
}

function AuthField({ name, spec, value, onChange }: { name: string; spec: PieceField; value: unknown; onChange: (value: unknown) => void }) {
  const id = useId();
  const label = `${spec.label || name}${spec.required ? "" : " (optional)"}`;
  const help = spec.description ? <span className="text-muted-foreground">{spec.description.slice(0, 300)}</span> : null;
  if (spec.type === "CHECKBOX")
    return (
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={value === undefined ? spec.default === true : value === true} onChange={(event) => onChange(event.target.checked)} />
        <span className="grid">
          {label}
          {help}
        </span>
      </label>
    );
  if (spec.type === "STATIC_DROPDOWN" && spec.options?.length)
    return (
      <label className="grid gap-1">
        {label}
        <select className={field} value={String(value ?? spec.default ?? "")} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose…</option>
          {spec.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
        {help}
      </label>
    );
  if (spec.type === "LONG_TEXT")
    return (
      <label className="grid gap-1">
        {label}
        <Textarea className="min-h-14 font-mono text-[11px] md:text-[11px]" spellCheck={false} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
        {help}
      </label>
    );
  return (
    <label className="grid gap-1" htmlFor={id}>
      {label}
      <Input
        id={id}
        className="h-7 text-xs"
        type={spec.type === "SECRET_TEXT" ? "password" : spec.type === "NUMBER" ? "number" : "text"}
        autoComplete={spec.type === "SECRET_TEXT" ? "new-password" : "off"}
        spellCheck={false}
        value={String(value ?? (spec.default !== undefined && spec.type !== "SECRET_TEXT" ? spec.default : ""))}
        onChange={(event) => onChange(event.target.value)}
      />
      {help}
    </label>
  );
}

/** The fields a piece's sign-in asks for. */
function fieldsOf(auth: NonNullable<PieceInfo["auth"]>): Record<string, PieceField> {
  if (auth.type === "SECRET_TEXT") return { secret_text: { type: "SECRET_TEXT", label: auth.label || "Secret", description: auth.description, required: true } };
  if (auth.type === "BASIC_AUTH")
    return { username: { type: "SHORT_TEXT", label: "User name", description: "", required: true }, password: { type: "SECRET_TEXT", label: "Password", description: auth.description, required: true } };
  return auth.fields;
}

function ConnectionForm({ pieces, start, replacing, onDone }: { pieces: Record<string, PieceInfo>; start?: string; replacing?: AutomationConnection; onDone: () => void }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const choices = Object.entries(pieces)
    .filter(([, piece]) => piece.auth)
    .sort(([, a], [, b]) => a.label.localeCompare(b.label));
  const [pieceName, setPieceName] = useState(replacing?.piece ?? (start && pieces[start]?.auth ? start : (choices.find(([, piece]) => piece.auth?.type !== "OAUTH2")?.[0] ?? "")));
  const piece = pieces[pieceName];
  const [name, setName] = useState(replacing?.name ?? (piece ? nameFor(piece.label) : ""));
  const [typed, setTyped] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const auth = piece?.auth ?? null;
  const fields = auth && auth.type !== "OAUTH2" ? fieldsOf(auth) : {};
  const missing = Object.entries(fields).some(([key, spec]) => spec.required && spec.type !== "CHECKBOX" && (typed[key] === undefined || typed[key] === "") && spec.default === undefined);

  const save = async () => {
    if (!auth || auth.type === "OAUTH2") return;
    setBusy(true);
    setProblem(null);
    try {
      // Which fields aren't secret, so they can be shown again; the server hides passwords and keys whatever this says.
      const shown = Object.entries(fields)
        .filter(([, spec]) => spec.type !== "SECRET_TEXT")
        .map(([key]) => key);
      const input: AutomationConnectionInput = { name, piece: pieceName, value: valueOf(auth, typed), shown };
      const saved = await api<AutomationConnection>(`/api/rooms/${room.id}/automations/connections?test=1`, { method: "PUT", json: input });
      await queryClient.invalidateQueries({ queryKey: ["automations", room.id, "connections"] });
      if (saved.lastTest && !saved.lastTest.valid) setProblem(`Saved, but it didn't work: ${saved.lastTest.error ?? "these details were refused."}`);
      else onDone();
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={replacing ? `Replace ${replacing.name}` : "Add a connection"}
      className="grid gap-2 rounded-md border p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h4 className="font-medium">{replacing ? `New details for ${replacing.name}` : "Add a connection"}</h4>
      {!replacing && (
        <label className="grid gap-1">
          For
          <select
            className={field}
            value={pieceName}
            onChange={(event) => {
              setPieceName(event.target.value);
              setTyped({});
              const next = pieces[event.target.value];
              if (next) setName(nameFor(next.label));
            }}
          >
            {choices.map(([key, each]) => (
              <option key={key} value={key} disabled={each.auth?.type === "OAUTH2"}>
                {each.label}
                {each.auth?.type === "OAUTH2" ? " (signing in with OAuth comes later)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {!replacing && (
        <label className="grid gap-1">
          Name
          <Input className="h-7 font-mono text-xs" spellCheck={false} value={name} onChange={(event) => setName(event.target.value)} />
          <span className="text-muted-foreground">Steps use it as {connectionExpression(name || "name")}. Letters, digits, dashes and underscores.</span>
        </label>
      )}
      {auth && <p className="text-muted-foreground">{KIND_NAMES[auth.type] ?? auth.type}{auth.description ? `: ${auth.description.slice(0, 400)}` : "."}</p>}
      {Object.entries(fields).map(([key, spec]) => (
        <AuthField key={key} name={key} spec={spec} value={typed[key]} onChange={(value) => setTyped((all) => ({ ...all, [key]: value }))} />
      ))}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-1">
        <Button size="xs" type="submit" disabled={busy || !name || missing || !auth || auth.type === "OAUTH2"}>
          {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Save and test
        </Button>
        <Button size="xs" type="button" variant="ghost" onClick={onDone}>
          {problem?.startsWith("Saved") ? "Done" : "Cancel"}
        </Button>
      </div>
    </form>
  );
}

function ConnectionRow({ connection, pieces, owner, onReplace }: { connection: AutomationConnection; pieces: Record<string, PieceInfo>; owner: boolean; onReplace: () => void }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"test" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = ["automations", room.id, "connections"];
  const act = async (kind: "test" | "remove") => {
    setBusy(kind);
    setProblem(null);
    try {
      if (kind === "test") await api(`/api/rooms/${room.id}/automations/connections/${encodeURIComponent(connection.name)}/test`, { method: "POST" });
      else await api(`/api/rooms/${room.id}/automations/connections/${encodeURIComponent(connection.name)}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  };
  const shown = Object.entries(connection.shown);
  return (
    <li aria-label={`Connection ${connection.name}`} className="grid gap-1 rounded-md border p-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono font-medium">{connection.name}</span>
        <span className="text-muted-foreground">{pieces[connection.piece]?.label ?? connection.piece}</span>
        <span className={connection.lastTest ? (connection.lastTest.valid ? "ml-auto text-success" : "ml-auto text-destructive") : "ml-auto text-muted-foreground"}>
          {connection.lastTest ? (connection.lastTest.valid ? "Works" : "Didn't work") : "Not tried"}
        </span>
      </div>
      {shown.length > 0 && <p className="truncate font-mono text-[11px] text-muted-foreground">{shown.map(([name, value]) => `${name}: ${String(value)}`).join(" · ")}</p>}
      {connection.lastTest && !connection.lastTest.valid && connection.lastTest.error && <p className="text-destructive">{connection.lastTest.error}</p>}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="outline" disabled={busy !== null} onClick={() => void act("test")}>
          {busy === "test" ? <Loader2 className="animate-spin" /> : <RotateCw />} Test
        </Button>
        {owner && (
          <>
            <Button size="xs" variant="ghost" disabled={busy !== null} onClick={onReplace}>
              <KeyRound /> New details
            </Button>
            <Button size="xs" variant="ghost" disabled={busy !== null} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}>
              <Trash2 /> Remove
            </Button>
          </>
        )}
      </div>
      {confirming && (
        <div role="group" aria-label="Are you sure?" className="flex flex-wrap items-center gap-1 rounded-md bg-chrome p-2">
          <span className="flex-1">Steps using {connection.name} stop working until another has its name.</span>
          <Button size="xs" variant="destructive" disabled={busy !== null} onClick={() => void act("remove")}>
            Remove it
          </Button>
        </div>
      )}
    </li>
  );
}

/** The Connections dialog: opened from the tool's header, or from a step needing one. */
export function ConnectionsDialog({ pieces }: { pieces: Record<string, PieceInfo> }) {
  const { can } = useRoom();
  const owner = can("room.manage");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<{ piece?: string } | null>(null);
  const [replacing, setReplacing] = useState<AutomationConnection | null>(null);
  const connections = useConnections(open);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const piece = (event as CustomEvent<{ piece?: string }>).detail?.piece;
      setOpen(true);
      setReplacing(null);
      setAdding(piece && owner ? { piece } : null);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [owner]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto text-xs sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription>
            The room&apos;s sign-ins for its automations&apos; services. They&apos;re kept sealed on the server and never shown again; anyone who can run the room&apos;s code can use them in a flow, so give it only what they may use.
          </DialogDescription>
        </DialogHeader>
        {connections.isPending ? (
          <p className="text-muted-foreground">Reading the room&apos;s connections…</p>
        ) : connections.isError ? (
          <p role="alert" className="text-destructive">
            {failure(connections.error)}
          </p>
        ) : (
          <ul aria-label="The room's connections" className="grid gap-2">
            {connections.data.length === 0 && <li className="text-muted-foreground">No connections yet.</li>}
            {connections.data.map((connection) => (
              <ConnectionRow
                key={connection.name}
                connection={connection}
                pieces={pieces}
                owner={owner}
                onReplace={() => {
                  setAdding(null);
                  setReplacing(connection);
                }}
              />
            ))}
          </ul>
        )}
        {replacing ? (
          <ConnectionForm key={`replace-${replacing.name}`} pieces={pieces} replacing={replacing} onDone={() => setReplacing(null)} />
        ) : adding ? (
          <ConnectionForm key={`add-${adding.piece ?? ""}`} pieces={pieces} start={adding.piece} onDone={() => setAdding(null)} />
        ) : owner ? (
          <div>
            <Button size="xs" onClick={() => setAdding({})}>
              <Plus /> Add a connection
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">Only the room&apos;s owners can add, change or remove its connections.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A step's connection: one of the room's for its piece, by name. */
export function ConnectionField({ pieceName, piece, auth, canEdit, onChange }: { pieceName: string; piece: PieceInfo; auth: unknown; canEdit: boolean; onChange: (auth: string | undefined) => void }) {
  const connections = useConnections();
  const chosen = connectionNameOf(auth);
  const mine = (connections.data ?? []).filter((connection) => connection.piece === pieceName);
  const missing = chosen && connections.data && !connections.data.some((connection) => connection.name === chosen);
  const oauth = piece.auth?.type === "OAUTH2";
  return (
    <section aria-label="Its connection" className="grid gap-1 rounded-md border p-2">
      <label className="grid gap-1">
        Connection
        <select className={field} disabled={!canEdit} value={chosen ?? ""} onChange={(event) => onChange(event.target.value ? connectionExpression(event.target.value) : undefined)}>
          <option value="">{mine.length ? "Choose one…" : "None yet"}</option>
          {chosen && missing && <option value={chosen}>{chosen} (not in the room)</option>}
          {mine.map((connection) => (
            <option key={connection.name} value={connection.name}>
              {connection.name}
              {connection.lastTest && !connection.lastTest.valid ? " (didn't work)" : ""}
            </option>
          ))}
        </select>
      </label>
      {missing && <p className="text-destructive">There&apos;s no connection called {chosen} in this room: add one with that name, or choose another.</p>}
      {oauth ? (
        <p className="text-muted-foreground">{piece.label} signs in with OAuth, which comes later.</p>
      ) : (
        <div>
          <Button size="xs" variant="outline" onClick={() => openConnections(pieceName)}>
            <KeyRound /> Connections…
          </Button>
        </div>
      )}
      <p className="text-muted-foreground">A room reaches its own databases and services; the internet outside it comes later, so services like {piece.label} out there can&apos;t be reached yet.</p>
    </section>
  );
}
