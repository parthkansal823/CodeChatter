# ADR 0001 — Editor stack: monaco-languageclient + y-monaco (spike S1)

- **Status:** Accepted (2026-09-24)
- **Spike:** `spikes/s1-editor` (throwaway)

## Question

Can one Monaco instance support real-time co-editing (y-monaco), TypeScript IntelliSense across workspace files, AI ghost text, and later LSP servers, on Vite 8 and React 19?

## Result: go (9 of 9 checks pass in headless Edge)

| Check | Result |
|---|---|
| monaco-vscode-api starts in `classic` mode | pass |
| `MonacoBinding` constructs against the editor-api override | pass |
| Initial Yjs sync reaches a second client | pass |
| Local edit → remote client, remote edit → local model | pass |
| TS worker resolves `import … from "./util"` across models | pass |
| TS reports a type error that depends on another file | pass |
| TS completions include a symbol from another file | pass |
| `registerInlineCompletionsProvider` is invoked (for AI ghost text) | pass |

## Decisions

- **Versions:**

  | Package | Version |
  |---|---|
  | `monaco-languageclient` | 11.0.2 |
  | `@codingame/monaco-vscode-api` | 37.1.0 |
  | `monaco-editor` | overridden to `npm:@codingame/monaco-vscode-editor-api@37.1.0` |
  | `vscode` | `npm:@codingame/monaco-vscode-extension-api@37.1.0` |
  | `y-monaco` | 0.1.6 |
  | `yjs` | 13.6.33 |
  | `vite` | 8.3.1 |

- **Vite config:** `resolve.dedupe: ["vscode"]` and `worker.format: "es"`. The v1 alias hack in `client/vite.config.js` is no longer needed, because the editor-api package exports the internal path that y-monaco imports.
- **TS/JS IntelliSense:** use `@codingame/monaco-vscode-standalone-typescript-language-features`, with one model per workspace file under `file:///workspace/…`.
- **Syntax highlighting:** use `@codingame/monaco-vscode-standalone-languages`.
- **Workers:** load them through `useWorkerFactory` with `new URL(…, import.meta.url)`.
- **Seeding rule:** a file's `Y.Text` is filled once, when its node is created, never by an editor binding.
- **TypeScript:** pin 6.0.x for the app. typescript-eslint 8.70 supports only `<6.1`, while `latest` is now 7.x, the native port.

## Follow-ups

- Register an in-memory file system provider (`RegisteredFileSystemProvider` from the files service override) for `file:///workspace`. The classic-mode file service otherwise logs "Unable to read file '\workspace\main.ts'".
- Initialise the VS Code services once, on the room route. They cannot be re-initialised within a page.
- The Monaco bundle is well over 500 kB. Lazy-load the room route and split vendor chunks.

## Addendum: S1b on Next.js 16 with Turbopack (2026-09-24), 9 of 9 pass

`spikes/s1b-next` re-ran the same checks in a Next.js 16.3.6 production build (Turbopack), with the editor loaded through `next/dynamic` and `ssr: false`. Every check passes.

**Required change: the worker wiring.** monaco-languageclient's `useWorkerFactory` hands Monaco a URL string through `getWorkerUrl`.
- Under Vite this worked by accident: Vite's plugin matched the text `new Worker(new URL(…))` at the loader call site.
- Turbopack instead emits a bare `new URL(pkg, import.meta.url)` as a static asset, unbundled.

The fix is to define `MonacoEnvironment.getWorker(_, label)`, which Monaco prefers over `getWorkerUrl`. It should return `new Worker(new URL("…", import.meta.url), { type: "module" })`, using the **global** `Worker`, so Turbopack bundles each worker entry. Pass `monacoWorkerFactory: () => {}` to the wrapper.
