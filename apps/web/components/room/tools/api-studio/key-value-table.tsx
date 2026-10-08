"use client";

import { Plus, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import { addRow, removeRow, updateRow, type Row, type RowList } from "./model";
import { useStudio } from "./studio-context";

const HEADER_NAMES = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Content-Type", "Cookie", "If-Match", "If-None-Match",
  "Origin", "Referer", "User-Agent", "X-API-Key", "X-Request-Id", "X-Requested-With",
];

/** Header and field names that usually carry a credential. */
const SECRET_NAME = /authorization|api[-_]?key|token|secret|password|cookie/i;

/**
 * Editable rows (query parameters, headers, form fields) kept in the shared
 * document. A row is its own Y.Map, so two people editing different rows
 * never overwrite each other.
 */
export function KeyValueTable({
  ownerId,
  list,
  rows,
  keyLabel = "Name",
  valueLabel = "Value",
  addLabel = "Add row",
  suggestHeaders = false,
  warnSecrets = false,
  emptyHint,
}: {
  ownerId: string;
  list: RowList;
  rows: Row[];
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  suggestHeaders?: boolean;
  /** Warn when a credential is typed in as a literal instead of a {{variable}}. */
  warnSecrets?: boolean;
  emptyHint?: string;
}) {
  const { doc, canEdit } = useStudio();
  const uid = useId();
  const focusAfterAdd = useRef<string | null>(null);

  // A row added with the button gets the cursor in its name field.
  useEffect(() => {
    if (!focusAfterAdd.current) return;
    document.getElementById(`${uid}-${focusAfterAdd.current}`)?.focus();
    focusAfterAdd.current = null;
  });

  return (
    <div className="grid gap-1 p-3">
      {suggestHeaders && (
        <datalist id={`${uid}-names`}>
          {HEADER_NAMES.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      {rows.length > 0 && (
        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.4fr)_1.5rem] items-center gap-x-1.5 gap-y-1">
          <span />
          <span className="px-1 text-xs text-muted-foreground">{keyLabel}</span>
          <span className="px-1 text-xs text-muted-foreground">{valueLabel}</span>
          <span />
          {rows.map((row) => {
            const literalSecret = warnSecrets && row.enabled && SECRET_NAME.test(row.key) && row.value.trim() !== "" && !row.value.includes("{{");
            return (
              <div key={row.id} className="contents">
                <Checkbox
                  checked={row.enabled}
                  disabled={!canEdit}
                  aria-label={`Send ${row.key || "this row"}`}
                  onCheckedChange={(checked) => updateRow(doc, ownerId, list, row.id, { enabled: checked === true })}
                />
                <Input
                  id={`${uid}-${row.id}`}
                  value={row.key}
                  readOnly={!canEdit}
                  list={suggestHeaders ? `${uid}-names` : undefined}
                  placeholder={keyLabel}
                  aria-label={`${keyLabel} of row`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => updateRow(doc, ownerId, list, row.id, { key: event.target.value })}
                  className="h-7 font-mono text-sm md:text-sm"
                />
                <Input
                  value={row.value}
                  readOnly={!canEdit}
                  placeholder={valueLabel}
                  aria-label={`${valueLabel} of ${row.key || "row"}`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => updateRow(doc, ownerId, list, row.id, { value: event.target.value })}
                  className="h-7 font-mono text-sm md:text-sm"
                />
                {canEdit ? (
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${row.key || "row"}`} onClick={() => removeRow(doc, ownerId, list, row.id)}>
                    <X />
                  </Button>
                ) : (
                  <span />
                )}
                {literalSecret && (
                  <p className="col-span-4 flex items-start gap-1.5 pb-1 pl-6 text-xs text-warning">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span>This value is saved in the shared collection and visible to everyone in the room. Use a {"{{variable}}"} and mark it secret in Environments.</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {rows.length === 0 && emptyHint && <p className="py-1 text-sm text-muted-foreground">{emptyHint}</p>}
      {canEdit && (
        <div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              focusAfterAdd.current = addRow(doc, ownerId, list, { key: "", value: "", enabled: true });
            }}
          >
            <Plus /> {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
