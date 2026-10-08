"use client";

import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { patchValues, useLocalValues } from "./local-store";
import { addRow, createEnvironment, deleteEnvironment, removeRow, renameEnvironment, setVariableSecret, updateRow, type Environment, type Variable } from "./model";
import { useStudio } from "./studio-context";

const COLUMNS = "grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem_1.5rem] items-center gap-x-2 gap-y-1";

export function EnvironmentsDialog() {
  const { dialog, openDialog, environments, envId } = useStudio();
  const [chosen, setChosen] = useState<string | null>(null);
  const current = environments.find((e) => e.id === chosen) ?? environments.find((e) => e.id === envId) ?? environments[0] ?? null;

  return (
    <Dialog open={dialog?.kind === "environments"} onOpenChange={(open) => !open && openDialog(null)}>
      <DialogContent className="grid h-[min(85vh,640px)] grid-rows-[auto_minmax(0,1fr)] gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Environments</DialogTitle>
          <DialogDescription>
            Variables to use as {"{{name}}"} in URLs, headers and bodies. A secret&apos;s value stays on this device and is never saved in the room, so each person adds their own. Mark a variable
            secret before you type its value.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[11rem_minmax(0,1fr)] gap-4">
          <EnvironmentList environments={environments} current={current} onChoose={setChosen} />
          {current ? <EnvironmentEditor key={current.id} env={current} onGone={() => setChosen(null)} /> : <NoEnvironments onCreated={setChosen} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnvironmentList({ environments, current, onChoose }: { environments: Environment[]; current: Environment | null; onChoose: (id: string) => void }) {
  const { doc, canEdit, envId, setEnvId } = useStudio();
  return (
    <nav aria-label="Environments" className="flex min-h-0 flex-col gap-1 border-r pr-3">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {environments.map((env) => (
          <button
            key={env.id}
            type="button"
            aria-current={env.id === current?.id}
            onClick={() => onChoose(env.id)}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent", env.id === current?.id && "bg-accent")}
          >
            <span className="min-w-0 flex-1 truncate">{env.name}</span>
            {env.id === envId && <span role="img" aria-label="In use" className="size-1.5 shrink-0 rounded-full bg-brand" />}
          </button>
        ))}
        {environments.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">None yet.</p>}
      </div>
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const id = createEnvironment(doc, "New environment", [{ key: "baseUrl", value: "", secret: false, enabled: true }]);
            onChoose(id);
          }}
        >
          <Plus /> New environment
        </Button>
      )}
      {current && current.id !== envId && (
        <Button size="sm" variant="ghost" onClick={() => setEnvId(current.id)}>
          Use {current.name}
        </Button>
      )}
    </nav>
  );
}

function NoEnvironments({ onCreated }: { onCreated: (id: string) => void }) {
  const { doc, canEdit } = useStudio();
  return (
    <div className="flex flex-col items-start justify-center gap-2 p-4">
      <p className="font-medium">No environments yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">An environment holds values like a base URL or a token, so one request can run against local, staging and production.</p>
      {canEdit ? (
        <Button size="sm" onClick={() => onCreated(createEnvironment(doc, "Local", [{ key: "baseUrl", value: "http://localhost:3000", secret: false, enabled: true }]))}>
          <Plus /> Create one
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Ask someone with edit access to create one.</p>
      )}
    </div>
  );
}

function EnvironmentEditor({ env, onGone }: { env: Environment; onGone: () => void }) {
  const { doc, canEdit, roomId, user } = useStudio();
  const [localValues] = useLocalValues(roomId, user.id);
  const mine = localValues[env.id] ?? {};
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const uid = useId();

  const setMineFor = (name: string, value: string) => patchValues(roomId, user.id, env.id, { [name]: value === "" ? null : value });

  const toggleSecret = (variable: Variable, secret: boolean) => {
    // Keep the value the person already typed, on their device, before it leaves the shared document.
    if (secret && variable.value && variable.key && mine[variable.key] === undefined) setMineFor(variable.key, variable.value);
    setVariableSecret(doc, env.id, variable.id, secret);
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          key={`${env.id}-${env.name}`}
          defaultValue={env.name}
          readOnly={!canEdit}
          aria-label="Environment name"
          maxLength={80}
          onBlur={(event) => event.target.value.trim() && event.target.value !== env.name && renameEnvironment(doc, env.id, event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className="h-7 max-w-64 text-sm font-medium md:text-sm"
        />
        {canEdit && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => {
              deleteEnvironment(doc, env.id);
              onGone();
            }}
          >
            <Trash2 /> Delete environment
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={COLUMNS}>
          <span />
          <span className="px-1 text-xs text-muted-foreground">Variable</span>
          <span className="px-1 text-xs text-muted-foreground">Shared value</span>
          <span className="px-1 text-xs text-muted-foreground">Your value</span>
          <span className="text-center text-xs text-muted-foreground">Secret</span>
          <span />
          {env.variables.map((variable) => {
            const reveal = shown.has(variable.id);
            return (
              <div key={variable.id} className="contents">
                <Checkbox checked={variable.enabled} disabled={!canEdit} aria-label={`Use ${variable.key || "this variable"}`} onCheckedChange={(checked) => updateRow(doc, env.id, "variables", variable.id, { enabled: checked === true })} />
                <Input
                  value={variable.key}
                  readOnly={!canEdit}
                  aria-label="Variable name"
                  placeholder="name"
                  spellCheck={false}
                  onChange={(event) => updateRow(doc, env.id, "variables", variable.id, { key: event.target.value.replace(/[\s{}]/g, "") })}
                  className="h-7 font-mono text-sm md:text-sm"
                />
                <Input
                  value={variable.secret ? "" : variable.value}
                  readOnly={!canEdit}
                  disabled={variable.secret}
                  aria-label={`Shared value of ${variable.key || "variable"}`}
                  placeholder={variable.secret ? "Not shared" : "Everyone sees this"}
                  spellCheck={false}
                  onChange={(event) => updateRow(doc, env.id, "variables", variable.id, { value: event.target.value })}
                  className="h-7 font-mono text-sm md:text-sm"
                />
                <div className="relative">
                  <Input
                    id={`${uid}-${variable.id}`}
                    type={variable.secret && !reveal ? "password" : "text"}
                    value={mine[variable.key] ?? ""}
                    aria-label={`Your value of ${variable.key || "variable"}`}
                    placeholder={variable.secret ? "Only on this device" : variable.value || "Same as shared"}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!variable.key}
                    onChange={(event) => setMineFor(variable.key, event.target.value)}
                    className={cn("h-7 font-mono text-sm md:text-sm", variable.secret && "pr-7")}
                  />
                  {variable.secret && (
                    <button
                      type="button"
                      aria-label={reveal ? `Hide ${variable.key}` : `Show ${variable.key}`}
                      onClick={() =>
                        setShown((current) => {
                          const next = new Set(current);
                          if (!next.delete(variable.id)) next.add(variable.id);
                          return next;
                        })
                      }
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </button>
                  )}
                </div>
                <div className="flex justify-center">
                  <Switch size="sm" checked={variable.secret} disabled={!canEdit} aria-label={`${variable.key || "Variable"} is secret`} onCheckedChange={(checked) => toggleSecret(variable, checked)} />
                </div>
                {canEdit ? (
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${variable.key || "variable"}`} onClick={() => removeRow(doc, env.id, "variables", variable.id)}>
                    <X />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <Button size="xs" variant="ghost" className="mt-2" onClick={() => addRow(doc, env.id, "variables", { key: "", value: "", secret: false, enabled: true })}>
            <Plus /> Add variable
          </Button>
        )}
        {env.variables.length === 0 && <p className="py-2 text-sm text-muted-foreground">No variables yet.</p>}
        <p className="mt-3 max-w-xl text-xs text-muted-foreground">
          Your value wins over the shared one, and only you see it. Values set from responses land here too. Everyone else sees the names of secret variables, never their values.
        </p>
      </div>
    </div>
  );
}
