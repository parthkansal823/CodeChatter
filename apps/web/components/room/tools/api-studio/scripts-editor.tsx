/**
 * The Scripts tab: Postman's pre-request and test scripts, written together in the shared document. One runs before the request is sent, the other after
 * its response (execute.ts, in a sandbox with no network: script-sandbox.ts). Snippets for what people write most.
 */
"use client";

import { Plus } from "lucide-react";
import { useEffect } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { nodeMap, yText, type RequestData } from "./model";
import { useStudio } from "./studio-context";
import { YTextArea } from "./ytext-area";

const BEFORE: Array<{ label: string; code: string }> = [
  { label: "Set a variable", code: 'pm.environment.set("token", "value");' },
  { label: "Add a header", code: 'pm.request.headers.upsert({ key: "X-Request-Id", value: crypto.randomUUID() });' },
  { label: "A timestamp to send", code: 'pm.environment.set("now", new Date().toISOString());' },
  { label: "Log what's sent", code: "console.log(pm.request.method, pm.request.url);" },
];
const AFTER: Array<{ label: string; code: string }> = [
  { label: "Status is 200", code: 'pm.test("Status is 200", () => {\n  pm.response.to.have.status(200);\n});' },
  { label: "Answers in under 500 ms", code: 'pm.test("Answers in under 500 ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});' },
  { label: "A JSON value", code: 'pm.test("Has an id", () => {\n  const body = pm.response.json();\n  pm.expect(body).to.have.property("id");\n});' },
  { label: "A header", code: 'pm.test("Says its content type", () => {\n  pm.response.to.have.header("Content-Type");\n});' },
  { label: "Save a value for the next request", code: 'const body = pm.response.json();\npm.environment.set("id", String(body.id));' },
];

function ScriptField({ request, field, label, help, snippets, placeholder }: { request: RequestData; field: "preScript" | "testScript"; label: string; help: string; snippets: Array<{ label: string; code: string }>; placeholder: string }) {
  const { doc, canEdit } = useStudio();
  const node = nodeMap(doc, request.id);
  // A request made before scripts were kept has nowhere to write one yet.
  useEffect(() => {
    if (canEdit && node && !(node.get(field) instanceof Y.Text)) node.set(field, new Y.Text());
  }, [canEdit, node, field]);
  const text = node ? yText(node, field) : undefined;
  const add = (code: string) => {
    if (!text) return;
    const current = text.toString();
    text.insert(text.length, `${current && !current.endsWith("\n") ? "\n" : ""}${current ? "\n" : ""}${code}\n`);
  };
  return (
    <section aria-label={label} className="flex min-h-0 flex-col rounded-md border">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <h4 className="flex-1 text-xs font-medium">{label}</h4>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="ghost">
                <Plus /> Snippet
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {snippets.map((snippet) => (
                <DropdownMenuItem key={snippet.label} onSelect={() => add(snippet.code)}>
                  {snippet.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="shrink-0 px-2 pt-1.5 text-xs text-muted-foreground">{help}</p>
      <div className="min-h-32 flex-1">
        <YTextArea text={text} label={label} placeholder={placeholder} readOnly={!canEdit} className="text-xs" />
      </div>
    </section>
  );
}

export function ScriptsEditor({ request }: { request: RequestData }) {
  return (
    <div className="grid gap-3 p-3">
      <p className="text-xs text-muted-foreground">
        JavaScript with Postman&apos;s <code className="font-mono">pm</code>: pm.environment, pm.request, pm.response, pm.test and pm.expect. Scripts run in your browser, in a sandbox with no network, for up to 5
        seconds. Variables they set are yours, like ones set from a response.
      </p>
      <ScriptField
        request={request}
        field="preScript"
        label="Before sending"
        help="Set variables, or change this send's address and headers. The request itself stays as written."
        snippets={BEFORE}
        placeholder={'pm.environment.set("now", new Date().toISOString());'}
      />
      <ScriptField
        request={request}
        field="testScript"
        label="After the response"
        help="pm.test results show with the Tests tab's checks. Save values for the next request with pm.environment.set."
        snippets={AFTER}
        placeholder={'pm.test("Status is 200", () => {\n  pm.response.to.have.status(200);\n});'}
      />
    </div>
  );
}
