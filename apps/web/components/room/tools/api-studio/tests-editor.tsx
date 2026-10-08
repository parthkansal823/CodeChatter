"use client";

import {
  ASSERTION_KINDS,
  EXTRACT_SOURCES,
  OPS_FOR_KIND,
  type Assertion,
  type AssertionKind,
  type AssertionOp,
  type ExtractSource,
  type Extraction,
} from "@codechatter/contracts";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { CompactSelect } from "./compact-select";
import { addRow, removeRow, updateRow, type RequestData } from "./model";
import { useStudio } from "./studio-context";

const KIND_LABELS: Record<AssertionKind, string> = { status: "Status", json: "JSON path", header: "Header", time: "Response time", body: "Body" };
const OP_LABELS: Record<AssertionOp, string> = {
  equals: "equals",
  notEquals: "isn't",
  contains: "contains",
  exists: "exists",
  notExists: "doesn't exist",
  below: "is below",
  above: "is above",
  matches: "matches",
};
const SOURCE_LABELS: Record<ExtractSource, string> = { json: "JSON path", header: "Header", status: "Status", body: "Whole body" };

const PRESETS: Array<{ label: string; fields: Omit<Assertion, "id"> }> = [
  { label: "Status is 200", fields: { enabled: true, kind: "status", target: "", op: "equals", expected: "200" } },
  { label: "Response time is below 500 ms", fields: { enabled: true, kind: "time", target: "", op: "below", expected: "500" } },
  { label: "JSON value exists", fields: { enabled: true, kind: "json", target: "$.id", op: "exists", expected: "" } },
  { label: "JSON value equals", fields: { enabled: true, kind: "json", target: "$.name", op: "equals", expected: "" } },
  { label: "Header exists", fields: { enabled: true, kind: "header", target: "content-type", op: "exists", expected: "" } },
  { label: "Body contains", fields: { enabled: true, kind: "body", target: "", op: "contains", expected: "" } },
];

const COLUMNS = "grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)_7.5rem_minmax(0,1fr)_1.5rem] items-center gap-1.5";

export function TestsEditor({ request }: { request: RequestData }) {
  const { doc, canEdit, env } = useStudio();

  const patchAssertion = (a: Assertion, patch: Partial<Assertion>) => updateRow(doc, request.id, "assertions", a.id, patch);
  const changeKind = (a: Assertion, kind: AssertionKind) => {
    const ops = OPS_FOR_KIND[kind];
    patchAssertion(a, { kind, target: kind === "json" ? "$." : "", op: ops.includes(a.op) ? a.op : ops[0]! });
  };

  return (
    <div className="grid gap-5 p-3">
      <section aria-label="Tests" className="grid gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Tests</h3>
          <span className="text-xs text-muted-foreground">Checked against every response.</span>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="ghost" className="ml-auto">
                  <Plus /> Add test
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {PRESETS.map((preset) => (
                  <DropdownMenuItem key={preset.label} onSelect={() => addRow(doc, request.id, "assertions", preset.fields)}>
                    {preset.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {request.assertions.length === 0 && <p className="text-sm text-muted-foreground">No tests yet. Add one to see a pass or fail next to every response.</p>}
        {request.assertions.map((a) => (
          <div key={a.id} className={COLUMNS}>
            <Checkbox checked={a.enabled} disabled={!canEdit} aria-label="Run this test" onCheckedChange={(checked) => patchAssertion(a, { enabled: checked === true })} />
            <CompactSelect
              label="What to check"
              value={a.kind}
              onChange={(kind) => changeKind(a, kind)}
              options={ASSERTION_KINDS.map((id) => ({ id, label: KIND_LABELS[id] }))}
              disabled={!canEdit}
            />
            {a.kind === "json" || a.kind === "header" ? (
              <Input
                value={a.target}
                readOnly={!canEdit}
                aria-label={a.kind === "json" ? "JSON path" : "Header name"}
                placeholder={a.kind === "json" ? "$.data.items[0].id" : "content-type"}
                spellCheck={false}
                onChange={(event) => patchAssertion(a, { target: event.target.value })}
                className="h-7 font-mono text-sm md:text-sm"
              />
            ) : (
              <span />
            )}
            <CompactSelect
              label="Comparison"
              value={a.op}
              onChange={(op) => patchAssertion(a, { op })}
              options={OPS_FOR_KIND[a.kind].map((id) => ({ id, label: OP_LABELS[id] }))}
              disabled={!canEdit}
            />
            {a.op === "exists" || a.op === "notExists" ? (
              <span />
            ) : (
              <Input
                value={a.expected}
                readOnly={!canEdit}
                aria-label="Expected value"
                placeholder={a.kind === "time" ? "milliseconds" : "expected"}
                spellCheck={false}
                onChange={(event) => patchAssertion(a, { expected: event.target.value })}
                className="h-7 font-mono text-sm md:text-sm"
              />
            )}
            {canEdit ? (
              <Button size="icon-xs" variant="ghost" aria-label="Remove test" onClick={() => removeRow(doc, request.id, "assertions", a.id)}>
                <X />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </section>

      <section aria-label="Set variables from the response" className="grid gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Set variables from the response</h3>
          {canEdit && (
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => addRow(doc, request.id, "extracts", { enabled: true, variable: "", source: "json", path: "$." })}
            >
              <Plus /> Add variable
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Copy a value, like a token, into a variable for the next request. It stays on your device{env ? ` for ${env.name}` : ""}; use it as {"{{name}}"}.
        </p>
        {request.extracts.map((e: Extraction) => (
          <div key={e.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_7.5rem_minmax(0,1.4fr)_1.5rem] items-center gap-1.5">
            <Checkbox checked={e.enabled} disabled={!canEdit} aria-label="Use this rule" onCheckedChange={(checked) => updateRow(doc, request.id, "extracts", e.id, { enabled: checked === true })} />
            <Input
              value={e.variable}
              readOnly={!canEdit}
              aria-label="Variable name"
              placeholder="token"
              spellCheck={false}
              onChange={(event) => updateRow(doc, request.id, "extracts", e.id, { variable: event.target.value.replace(/[\s{}]/g, "") })}
              className="h-7 font-mono text-sm md:text-sm"
            />
            <CompactSelect
              label="Where the value comes from"
              value={e.source}
              onChange={(source) => updateRow(doc, request.id, "extracts", e.id, { source, path: source === "json" ? "$." : "" })}
              options={EXTRACT_SOURCES.map((id) => ({ id, label: SOURCE_LABELS[id] }))}
              disabled={!canEdit}
            />
            {e.source === "json" || e.source === "header" ? (
              <Input
                value={e.path}
                readOnly={!canEdit}
                aria-label={e.source === "json" ? "JSON path" : "Header name"}
                placeholder={e.source === "json" ? "$.token" : "x-request-id"}
                spellCheck={false}
                onChange={(event) => updateRow(doc, request.id, "extracts", e.id, { path: event.target.value })}
                className="h-7 font-mono text-sm md:text-sm"
              />
            ) : (
              <span />
            )}
            {canEdit ? (
              <Button size="icon-xs" variant="ghost" aria-label="Remove rule" onClick={() => removeRow(doc, request.id, "extracts", e.id)}>
                <X />
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
