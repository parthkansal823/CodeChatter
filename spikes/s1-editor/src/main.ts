// S1 spike: monaco-languageclient 11 (classic mode) + editor-api override +
// y-monaco + standalone TS worker + inline completions, on Vite 8.
// Results are published on window.__S1__ for scripts/check.mjs to read.
import * as monaco from "monaco-editor";
import "@codingame/monaco-vscode-standalone-languages";
import {
  getTypeScriptWorker,
  typescriptDefaults,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";
import { MonacoVscodeApiWrapper } from "monaco-languageclient/vscodeApiWrapper";
import { useWorkerFactory, Worker } from "monaco-languageclient/workerFactory";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";

type Result = { ok: boolean; detail: string };
const results: Record<string, Result> = {};
(window as any).__S1__ = { results, done: false };
const record = (name: string, ok: boolean, detail = "") => {
  results[name] = { ok, detail };
};

async function main() {
  const wrapper = new MonacoVscodeApiWrapper({
    $type: "classic",
    viewsConfig: { $type: "EditorService" },
    monacoWorkerFactory: () =>
      useWorkerFactory({
        workerLoaders: {
          editorWorkerService: () =>
            new Worker(
              new URL("@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js", import.meta.url),
              { type: "module" },
            ),
          typescript: () =>
            new Worker(
              new URL("@codingame/monaco-vscode-standalone-typescript-language-features/worker", import.meta.url),
              { type: "module" },
            ),
        },
      }),
  });
  await wrapper.start();
  record("vscodeApiStart", true);

  typescriptDefaults.setCompilerOptions({
    target: 99, module: 99, moduleResolution: 2, strict: true, allowNonTsExtensions: true,
  });

  // Two workspace files; main.ts imports util.ts. Cross-file resolution is
  // what the "one model per workspace file" design depends on.
  const utilUri = monaco.Uri.parse("file:///workspace/util.ts");
  const mainUri = monaco.Uri.parse("file:///workspace/main.ts");
  monaco.editor.createModel("export function add(a: number, b: number): number { return a + b; }\n", "typescript", utilUri);

  // Two simulated clients: separate Y.Docs wired together in memory.
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  docA.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "net") Y.applyUpdate(docB, u, "net"); });
  docB.on("update", (u: Uint8Array, origin: unknown) => { if (origin !== "net") Y.applyUpdate(docA, u, "net"); });
  const textA = docA.getText("main.ts");
  // Content is inserted once, by one client, before any binding exists —
  // the rule that removes v1's double-seeding race.
  textA.insert(0, 'import { add } from "./util";\nconst n: number = add(1, 2);\nconst bad: string = add(1, 2);\n');

  const modelA = monaco.editor.createModel("", "typescript", mainUri);
  const modelB = monaco.editor.createModel("", "typescript", monaco.Uri.parse("inmemory://b/main.ts"));
  const edA = monaco.editor.create(document.getElementById("a")!, { model: modelA, automaticLayout: true });
  const edB = monaco.editor.create(document.getElementById("b")!, { model: modelB, automaticLayout: true });
  new MonacoBinding(textA, modelA, new Set([edA]));
  new MonacoBinding(docB.getText("main.ts"), modelB, new Set([edB]));
  record("yMonacoBindingConstructs", true);

  record("initialSyncToB", modelB.getValue() === modelA.getValue() && modelB.getValue().includes("add(1, 2)"),
    JSON.stringify(modelB.getValue().slice(0, 40)));

  // Edit through editor A's model (as a keystroke would) → must reach B.
  edA.executeEdits("spike", [{ range: new monaco.Range(1, 1, 1, 1), text: "// hello from A\n" }]);
  record("editAPropagatesToB", modelB.getValue().startsWith("// hello from A"), JSON.stringify(modelB.getValue().slice(0, 20)));

  // Remote edit arriving at B → must show up in A's editor model.
  docB.getText("main.ts").insert(0, "// hello from B\n");
  record("remoteEditReachesA", modelA.getValue().startsWith("// hello from B"));

  // Cross-file semantic diagnostics from the TS worker.
  const getWorker = await getTypeScriptWorker();
  const worker = await getWorker(mainUri);
  const diags = await worker.getSemanticDiagnostics(mainUri.toString());
  const msgs = diags.map((d) => (typeof d.messageText === "string" ? d.messageText : d.messageText.messageText));
  record("tsCrossFileImportResolves", !msgs.some((m) => m.includes("Cannot find module")), msgs.join(" | "));
  record("tsReportsTypeErrorAcrossFiles", msgs.some((m) => m.includes("not assignable to type 'string'")), msgs.join(" | "));

  // Completions for an imported symbol come from the other model.
  const completions = await worker.getCompletionsAtPosition(mainUri.toString(), modelA.getValue().indexOf("add(1") + 1);
  record("tsCompletionsWork", Boolean(completions?.entries?.some((e: any) => e.name === "add")));

  // Inline (ghost-text) completions provider — what AI completions will use.
  let providerCalls = 0;
  monaco.languages.registerInlineCompletionsProvider("typescript", {
    provideInlineCompletions: () => {
      providerCalls += 1;
      return { items: [{ insertText: "/* ai */" }] };
    },
    disposeInlineCompletions: () => {},
  } as any);
  edA.focus();
  edA.setPosition({ lineNumber: 3, column: 1 });
  edA.trigger("spike", "editor.action.inlineSuggest.trigger", {});
  await new Promise((r) => setTimeout(r, 1500));
  record("inlineCompletionsProviderInvoked", providerCalls > 0, `calls=${providerCalls}`);

  (window as any).__S1__.done = true;
}

main().catch((error) => {
  record("fatal", false, String(error?.stack ?? error));
  (window as any).__S1__.done = true;
});
