# Task for ChatGPT: Mermaid flowcharts with a live preview in CodeChatter

You are helping build **CodeChatter v2**, a real-time collaborative IDE. People in a "room" edit the same files live (Monaco editor, synced with Yjs), run code in a Docker sandbox, and chat. Another AI is working on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**.

Your job: **Mermaid diagrams as room files with a live preview.** A file named `*.mmd` or `*.mermaid` is Mermaid source. In the editor it gets syntax colouring, and it has a preview: beside the code (Ctrl+K V) or on its own (Ctrl+Shift+V). The preview redraws as anyone in the room types. Because the source is an ordinary room file, editing together, history and sync to the sandbox all work already. This completes the roadmap item "Flowchart: Mermaid source edited together, with a live render."

## Stack and house rules

- **Stack:**
  - Next.js 16 (Turbopack) and React 19 with the **React Compiler on**: don't memoise by hand without reason.
  - TypeScript strict, Tailwind 4, shadcn/ui components in `apps/web/components/ui` (`Button` sizes: `xs`, `sm`, `icon-xs`, `icon-sm`), icons from `lucide-react`.
- **Design:**
  - Pure black and white with one orange accent (CSS variable `--brand`).
  - **No hex or rgb colour literals in TSX** (a pre-commit hook rejects them); use Tailwind token classes (`bg-background`, `text-muted-foreground`, `border`, `bg-chrome`, `text-destructive`…).
  - When a library needs real colour strings, resolve tokens at run time with `cssVar("--foreground")` from `@/lib/css-color`, which returns `#rrggbb`.
  - Dense UI: 13px text, `text-xs` in panels, `h-8` toolbars.
- **Copy:** plain English, short sentences, no jargon ("Not a diagram Mermaid can draw yet: line 3, …").
- **Comments:** every new module starts with a doc comment saying what it is and why, in plain English. Comment the non-obvious, not the obvious.
- **Accessibility:** buttons have names (`aria-label` when icon-only); the preview has `role="img"` and a label.
- **Security:** render with Mermaid's `securityLevel: "strict"`, and show the SVG as an `<img src="data:image/svg+xml;…">` (as the existing SVG preview does), so no script in a diagram can ever run. HTML labels use `foreignObject`, which an `<img>` doesn't draw reliably, so set `htmlLabels: false` for flowcharts (and for the global config if Mermaid has one).
- **New package:** this task needs `mermaid` (latest stable 11.x). The owner adds it: say the exact command, `pnpm --filter @codechatter/web add mermaid@<version>`. **Import it dynamically** (`await import("mermaid")`) inside the preview, so the room's first load doesn't carry it.

## The code you build on

`apps/web/components/room/editor/preview-kind.ts` (whole file):

```ts
/** Files with a preview (Ctrl+K V beside the code, Ctrl+Shift+V on its own): Markdown rendered, CSV as a table, SVG as an image. */
export type PreviewKind = "markdown" | "table" | "image";

export function previewKindOf(name: string): PreviewKind | null {
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.(csv|tsv)$/i.test(name)) return "table";
  if (/\.svg$/i.test(name)) return "image";
  return null;
}

/** What the tab bar's button and the palette call each preview. */
export const PREVIEW_LABEL: Record<PreviewKind, string> = {
  markdown: "Markdown preview",
  table: "Table view",
  image: "Image preview",
};
```

The rest of the IDE already works from `previewKindOf`: the tab bar's preview button, the palette's "Open … to the side" command, and the Ctrl+K V and Ctrl+Shift+V keys. Adding a kind is enough for all of those to appear.

`apps/web/components/room/editor/file-preview.tsx` (whole file):

```tsx
"use client";

import { Columns2, Maximize2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { CsvTable } from "./csv-table";
import { MarkdownBody, useFileText } from "./markdown-preview";
import type { PreviewKind } from "./preview-kind";
import { revealInFile } from "./reveal";
import { SvgImage } from "./svg-image";
import type { FilePreviewMode } from "./ui-store";

type Props = {
  file: { id: string; name: string };
  kind: PreviewKind;
  mode: Exclude<FilePreviewMode, "off">;
  onMode: (mode: FilePreviewMode) => void;
};

/**
 * The open file's preview, live as people type: Markdown rendered, a CSV or TSV file as
 * a table, an SVG as an image. Beside the code (Ctrl+K V) or on its own (Ctrl+Shift+V).
 */
export function FilePreview({ file, kind, mode, onMode }: Props) {
  const text = useFileText(file.id);
  // A table row double-clicked: the code beside the table, at that row's line.
  const showLine = (line: number) => {
    onMode("side");
    revealInFile(file, { startLine: line, startColumn: 1, endLine: line, endColumn: 1 });
  };
  return (
    <section aria-label={`Preview of ${file.name}`} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center border-b bg-chrome pr-1 pl-3 text-xs text-muted-foreground">
        <span className="truncate">Preview: {file.name}</span>
        {mode === "side" ? (
          <Button variant="ghost" size="xs" className="ml-auto" title="Ctrl+Shift+V" onClick={() => onMode("full")}>
            <Maximize2 /> Preview only
          </Button>
        ) : (
          <Button variant="ghost" size="xs" className="ml-auto" title="Ctrl+K V" onClick={() => onMode("side")}>
            <Columns2 /> Show the code
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Close the preview" onClick={() => onMode("off")}>
          <X />
        </Button>
      </div>
      {kind === "markdown" ? (
        <MarkdownBody text={text} />
      ) : kind === "table" ? (
        <CsvTable text={text} name={file.name} onShowLine={showLine} />
      ) : (
        <SvgImage text={text} name={file.name} />
      )}
    </section>
  );
}
```

`useFileText(fileId)` returns the file's live text (it re-renders as anyone types). `revealInFile(file, range)` moves the code editor to a line.

`apps/web/components/room/editor/svg-image.tsx`, the start of the existing SVG preview (follow its toolbar and look):

```tsx
export function SvgImage({ text, name }: { text: string; name: string }) {
  const deferred = useDeferredValue(text);
  const [fit, setFit] = useState(true);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(deferred)}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <div role="group" aria-label="Zoom" className="flex">
          <Button size="xs" variant={fit ? "secondary" : "ghost"} aria-pressed={fit} onClick={() => setFit(true)}>Fit</Button>
          <Button size="xs" variant={!fit ? "secondary" : "ghost"} aria-pressed={!fit} onClick={() => setFit(false)}>Actual size</Button>
        </div>
        <span role="status" className="ml-auto tabular-nums">{broken ? "Not a picture the browser can draw" : size ? `${size.width} × ${size.height}` : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-size-[16px_16px] p-4">
        {/* the <img> */}
      </div>
    </div>
  );
}
```

`packages/workspace-model/src/languages.ts` maps file extensions to Monaco language ids, in a `BY_EXTENSION` record (for example `md: "markdown"`), through `languageFor(fileName)`. Unknown extensions get `"plaintext"`.

`apps/web/lib/css-color.ts` exports `cssVar(name: string, within?: Element): string`, a CSS variable resolved to `#rrggbb`. The tokens include `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--card`, `--brand` and `--brand-foreground`. Dark mode puts `.dark` on `<html>`; get the current theme with `useTheme().resolvedTheme` from `next-themes`.

Monaco setup is in `apps/web/components/room/monaco-setup.ts`. In its one-time setup, after the line `registerSnippets();`, other modules register their extras by calling a function. Register Mermaid's language the same way, with one added line.

## What to build

1. **The preview kind.** In `preview-kind.ts`, add `"diagram"` for `.mmd` and `.mermaid`, with the label `"Diagram preview"`.
2. **`apps/web/components/room/editor/mermaid-preview.tsx`**: `export function MermaidPreview({ text, name, onShowLine }: { text: string; name: string; onShowLine: (line: number) => void })`.
   - **Rendering:** load Mermaid on first use, then render about 250 ms after the text stops changing (debounced). Use a unique id per render, and ignore a result that finished after a newer render started.
   - **Config:** `startOnLoad: false`, `securityLevel: "strict"`, `theme: "base"`, `flowchart: { htmlLabels: false }`, and `themeVariables` built from the tokens with `cssVar`: background, node fill and border, text, lines, and the brand colour for highlights. Render again when the light or dark theme changes.
   - **Display:** the SVG as an `<img>` (data URI) with the same Fit / Actual size toolbar as `SvgImage`. The status says the diagram's type ("Flowchart", "Sequence diagram"…) when Mermaid tells you.
   - **Mistakes:** when the source has one, keep the last good drawing, dimmed, and show above it the problem in plain English with its line: "Line 3: Mermaid expected an arrow here". Give it a button **Show in the code** that calls `onShowLine(line)`. An empty file shows "Write a diagram, for example: `graph TD; A-->B`".
   - **Toolbar actions:** **Download SVG** saves `<name>.svg`, and **Copy SVG** copies it, with a toast via `toast` from `sonner`.
3. **`file-preview.tsx`**: render `MermaidPreview` for `kind === "diagram"`, passing the same `showLine` the CSV table gets.
4. **Syntax colouring.** In `apps/web/components/room/editor/mermaid-language.ts`, `export function registerMermaid()` registers the language id `"mermaid"` with a small Monarch tokenizer:
   - diagram keywords (`graph`, `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `erDiagram`, `gantt`, `pie`, `journey`, `mindmap`, `timeline`), directions (`TD`, `TB`, `LR`, `RL`, `BT`), `subgraph`, `end`, `style`, `classDef`, `click`;
   - arrows (`-->`, `---`, `-.->`, `==>`, `->>`, `-->>`), comments (`%% …`), and strings and node text in `[]`, `()`, `{}`;
   - comment toggling with `%%` (`setLanguageConfiguration`) and matching brackets.

   Call it from `monaco-setup.ts` after `registerSnippets();`. In `languages.ts`, add `mmd: "mermaid"` and `mermaid: "mermaid"`.
5. **Tests:**
   - **Unit:** `apps/web/components/room/editor/preview-kind.test.ts`, a `node:test` file:

     ```ts
     // node:test, run with tsx (see CLAUDE.md "Unit tests").
     import assert from "node:assert/strict";
     import { describe, it } from "node:test";
     ```

     Cover `.mmd`, `.mermaid` and case (`FLOW.MMD`), and that the existing kinds are unchanged. If you put the error-to-line logic in a pure function (a good idea: `mermaidErrorLine(message): number | null`), test it too.
   - **Browser:** `apps/web/test/mermaid.e2e.mjs`, modelled on the existing browser tests (Playwright-core and Microsoft Edge against the running dev stack). The helpers are in `apps/web/test/browser.mjs`: `launch()` returns `{ browser, errors, signIn }`; `signIn(email)` returns `{ context, page }` already in the test room; `check(name, ok, detail)` and `finish()` report. A test file looks like this:

     ```js
     import { check, finish, launch } from "./browser.mjs";
     const stamp = Date.now().toString(36);
     const { browser, errors, signIn } = await launch();
     const { context, page: a } = await signIn("test1@codechatter.local");
     await context.grantPermissions(["clipboard-read", "clipboard-write"]);
     // new file: the Files view's "New file" button, then the name box (placeholder "name.ext") and Enter
     await a.getByRole("button", { name: "New file" }).click();
     await a.getByPlaceholder("name.ext").fill(`flow_${stamp}.mmd`);
     await a.getByPlaceholder("name.ext").press("Enter");
     // the editor: a.locator(".monaco-editor .view-lines:visible").first(); paste text with the clipboard and Control+v
     // cleanup: const row = a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^flow_/ }); await row.focus(); await row.press("Delete");
     check("noPageErrors", errors.length === 0, errors.join(" | "));
     finish();
     ```

     Two people (test1@codechatter.local and test2@codechatter.local, password `codechatter123`) check:
     - test1 makes `flow_<stamp>.mmd` with `graph TD\n  A[Start] --> B[Done]`, presses Ctrl+K then V, and the region "Preview of flow_<stamp>.mmd" shows an image;
     - test2 opens the same file and its preview too;
     - test1 adds `B --> C[Again]`, and test2's preview changes;
     - a mistake shows the message with its line, and **Show in the code** works;
     - the test's file is deleted at the end;
     - no page errors.

## Files you may touch

- `apps/web/components/room/editor/preview-kind.ts` (edit)
- `apps/web/components/room/editor/file-preview.tsx` (edit)
- `apps/web/components/room/editor/mermaid-preview.tsx` (new)
- `apps/web/components/room/editor/mermaid-language.ts` (new)
- `apps/web/components/room/monaco-setup.ts` (one added import and one added call, nothing else)
- `packages/workspace-model/src/languages.ts` (two added entries)
- `apps/web/components/room/editor/preview-kind.test.ts` (new)
- `apps/web/test/mermaid.e2e.mjs` (new)

## How to answer

1. The exact command for the owner to add `mermaid`.
2. Each new file in full, in its own code block headed by its path.
3. Each edit to an existing file as a unified diff (`--- a/…` / `+++ b/…` with enough context to apply), or the whole new file when that's clearer.
4. How to check it, with the owner's commands:
   - `pnpm --filter @codechatter/web exec eslint <files>`
   - `pnpm --filter @codechatter/web typecheck`
   - from `apps/runner`: `pnpm exec tsx --test <absolute path of preview-kind.test.ts>`
   - from `apps/web`, with the dev stack running: `node test/mermaid.e2e.mjs`
5. Anything you weren't sure of in Mermaid 11's API (option names, the error format), so the owner knows where to look if a check fails.
