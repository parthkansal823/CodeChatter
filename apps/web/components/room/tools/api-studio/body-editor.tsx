"use client";

import { substituteVariables, type BodyMode } from "@codechatter/contracts";
import { setText } from "@codechatter/workspace-model";
import { Braces } from "lucide-react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { Button } from "@/components/ui/button";

import { KeyValueTable } from "./key-value-table";
import { nodeMap, setBodyMode, yText, type RequestData } from "./model";
import { Segmented } from "./segmented";
import { useStudio } from "./studio-context";
import { YTextArea } from "./ytext-area";

const MODES: Array<{ id: BodyMode; label: string }> = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "text", label: "Text" },
  { id: "form", label: "Form" },
  { id: "graphql", label: "GraphQL" },
];

/** Whether JSON text is valid once the variables that have values are filled in. */
export function jsonProblem(text: string, lookup: (name: string) => string | undefined): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(substituteVariables(text, lookup).text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Not valid JSON.";
  }
}

export function BodyEditor({ request }: { request: RequestData }) {
  const { doc, canEdit, lookup } = useStudio();
  const body = nodeMap(doc, request.id)?.get("body") as Y.Map<unknown> | undefined;
  const mode = request.body.mode;

  const format = () => {
    const text = body && (body.get("text") as Y.Text | undefined);
    if (!text) return;
    try {
      setText(text, JSON.stringify(JSON.parse(text.toString()), null, 2));
    } catch (error) {
      toast.error(`Can't format this: ${error instanceof Error ? error.message : "it isn't valid JSON"}. Fill in or quote any {{variables}} first.`);
    }
  };

  const problem = mode === "json" ? jsonProblem(request.body.text, lookup) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <Segmented label="Body type" options={MODES} value={mode} onChange={(next) => setBodyMode(doc, request.id, next)} disabled={!canEdit} />
        {mode === "json" && canEdit && (
          <Button size="xs" variant="ghost" onClick={format}>
            <Braces /> Format
          </Button>
        )}
        {mode !== "none" && <span className="ml-auto truncate text-xs text-muted-foreground">Content-Type is set for you unless you add one in Headers.</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "none" && <p className="p-3 text-sm text-muted-foreground">This request has no body. Pick JSON, Text, Form or GraphQL to add one.</p>}
        {(mode === "json" || mode === "text") && (
          <YTextArea
            text={body && yText(body, "text")}
            label={mode === "json" ? "JSON body" : "Text body"}
            placeholder={mode === "json" ? '{\n  "name": "{{name}}"\n}' : "Plain text"}
            readOnly={!canEdit}
          />
        )}
        {mode === "form" && <KeyValueTable ownerId={request.id} list="form" rows={request.body.form} keyLabel="Field" addLabel="Add field" warnSecrets />}
        {mode === "graphql" && (
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-h-0 border-b">
              <YTextArea text={body && yText(body, "query")} label="GraphQL query" placeholder={"query {\n  hello\n}"} readOnly={!canEdit} />
            </div>
            <div className="flex min-h-0 flex-col">
              <span className="px-3 pt-2 text-xs text-muted-foreground">Variables (JSON)</span>
              <div className="min-h-0 flex-1">
                <YTextArea text={body && yText(body, "variables")} label="GraphQL variables" placeholder='{ "id": 1 }' readOnly={!canEdit} className="pt-1" />
              </div>
            </div>
          </div>
        )}
      </div>
      {problem && (
        <p role="status" className="shrink-0 border-t px-3 py-1.5 text-xs text-warning">
          Invalid JSON: {problem}
        </p>
      )}
    </div>
  );
}
