/**
 * The Variables dialog of the Automations tool: a room's variables (n8n's $vars), names and text a flow reads as {{variables.NAME}}: a base address, an
 * environment's name, a channel. Not secrets (those are connections): anyone who can run the room's code sees them; its owners add, change and remove
 * them, each change on its own, in the audit log.
 */
"use client";

import { MOST_VARIABLES, VARIABLE_NAME, variableExpression, type AutomationVariable } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

const OPEN_EVENT = "cc:automation-variables";
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");

export function openVariables() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/** The room's variables, for the dialog and for offering {{variables.NAME}} as a field is typed. */
export function useVariables(enabled = true) {
  const { room } = useRoom();
  return useQuery({ queryKey: ["automations", room.id, "variables"], queryFn: () => api<AutomationVariable[]>(`/api/rooms/${room.id}/automations/variables`), enabled, retry: false, staleTime: 30_000 });
}

function VariableRow({ variable, owner, onSaved, onRemoved }: { variable: AutomationVariable; owner: boolean; onSaved: (saved: AutomationVariable) => void; onRemoved: (name: string) => void }) {
  const { room } = useRoom();
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = typed ?? variable.value;
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li aria-label={`Variable ${variable.name}`} className="grid gap-1 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono font-medium">{variable.name}</span>
        <Button
          size="xs"
          variant="ghost"
          title={`Copy ${variableExpression(variable.name)}`}
          onClick={() => void copyText(variableExpression(variable.name)).then((copied) => (copied ? toast.success(`Copied ${variableExpression(variable.name)}`) : toast.message(variableExpression(variable.name))))}
        >
          <Copy /> Copy
        </Button>
        {owner && (
          <Button size="xs" variant="ghost" disabled={busy} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Input aria-label={`Value of ${variable.name}`} className="h-7 font-mono text-xs md:text-xs" readOnly={!owner} spellCheck={false} value={value} onChange={(event) => setTyped(event.target.value)} />
        {owner && typed !== null && typed !== variable.value && (
          <Button
            size="xs"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                onSaved(await api<AutomationVariable>(`/api/rooms/${room.id}/automations/variables/${variable.name}`, { method: "PUT", json: { value: typed } }));
                setTyped(null);
              })
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        )}
      </div>
      <span className="text-muted-foreground">
        {variable.by ? `Set by ${variable.by}` : "Set"}
        {variable.at ? `, ${new Date(variable.at).toLocaleString()}` : ""}.
      </span>
      {confirming && (
        <div role="group" aria-label="Are you sure?" className="grid gap-1 rounded-md bg-chrome p-2">
          <p>Flows that read {variableExpression(variable.name)} then fail at that step, saying so.</p>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(`/api/rooms/${room.id}/automations/variables/${variable.name}`, { method: "DELETE" });
                  onRemoved(variable.name);
                })
              }
            >
              Remove it
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </li>
  );
}

export function VariablesDialog() {
  const { room, can } = useRoom();
  const owner = can("room.manage");
  const queryClient = useQueryClient();
  const key = ["automations", room.id, "variables"];
  const [open, setOpen] = useState(false);
  const current = useVariables(open);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setProblem(null);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  const list = current.data ?? [];
  const nameProblem = name && !VARIABLE_NAME.test(name) ? "Letters, numbers and _, not starting with a number." : name && list.some((each) => each.name === name) ? "There's one called that: change its value above." : null;
  const saved = (variable: AutomationVariable) => queryClient.setQueryData<AutomationVariable[]>(key, (before = []) => [...before.filter((each) => each.name !== variable.name), variable].sort((a, b) => a.name.localeCompare(b.name)));
  const removed = (gone: string) => queryClient.setQueryData<AutomationVariable[]>(key, (before = []) => before.filter((each) => each.name !== gone));

  const add = async () => {
    setBusy(true);
    setProblem(null);
    try {
      saved(await api<AutomationVariable>(`/api/rooms/${room.id}/automations/variables/${name}`, { method: "PUT", json: { value } }));
      setName("");
      setValue("");
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto text-xs sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Variables</DialogTitle>
          <DialogDescription>
            Text a flow reads as {"{{variables.NAME}}"}: a base address, an environment&apos;s name, a channel. Everyone who can run the room&apos;s code sees them, so keep secrets in Connections.
          </DialogDescription>
        </DialogHeader>
        {current.isPending ? (
          <p className="text-muted-foreground">Reading the room&apos;s variables…</p>
        ) : current.isError ? (
          <p role="alert" className="text-destructive">
            {failure(current.error)}
          </p>
        ) : (
          <div className="grid gap-3">
            {list.length ? (
              <ul aria-label="The room's variables" className="grid gap-1">
                {list.map((variable) => (
                  <VariableRow key={`${variable.name}:${variable.at ?? 0}`} variable={variable} owner={owner} onSaved={saved} onRemoved={removed} />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">None yet.</p>
            )}
            {owner ? (
              list.length < MOST_VARIABLES && (
                <form
                  aria-label="Add a variable"
                  className="grid gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (name && !nameProblem) void add();
                  }}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-end gap-1">
                    <label className="grid gap-1">
                      Name
                      <Input className="h-7 font-mono text-xs md:text-xs" spellCheck={false} placeholder="BASE_URL" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(nameProblem)} />
                    </label>
                    <label className="grid gap-1">
                      Value
                      <Input className="h-7 font-mono text-xs md:text-xs" spellCheck={false} placeholder="https://staging.example.com" value={value} onChange={(event) => setValue(event.target.value)} />
                    </label>
                    <Button size="xs" type="submit" disabled={busy || !name || Boolean(nameProblem)}>
                      {busy ? <Loader2 className="animate-spin" /> : <Plus />} Add
                    </Button>
                  </div>
                  {nameProblem && <p className="text-destructive">{nameProblem}</p>}
                </form>
              )
            ) : (
              <p className="text-muted-foreground">Only the room&apos;s owners add and change them.</p>
            )}
            {problem && (
              <p role="alert" className="text-destructive">
                {problem}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
