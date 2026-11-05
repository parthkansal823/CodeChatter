# Task for ChatGPT: dependency alerts (OSV) for a room's code in CodeChatter

You are helping build **CodeChatter v2**, a real-time collaborative IDE. People in a room edit the same files live (Yjs), run code in a sandbox, and use plug-in "room tools" (a side panel beside Chat and AI). Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself.

Your job is the roadmap item "**Dependency alerts (OSV)**". Add a **Dependencies** room tool that lists the packages a room's code depends on and the known vulnerabilities in them, from Google's OSV database (https://osv.dev). Each alert gets its severity, a summary, the fixed version, and a link. You can jump to the manifest line.

## Stack and house rules

- **API:**
  - NestJS 12 (`apps/api`, ESM: imports end in `.js`), zod 4 through the project's `ZodPipe`, and `@CurrentSession()` (from `../auth/current-session.decorator.js`).
  - Room permissions: `RoomsService.require(roomId, userId, "room.view")` from `../rooms/rooms.service.js`. It throws 403 or 404 itself.
  - Errors are Nest exceptions with plain-English messages.
- **Web:**
  - Next.js 16 and React 19 (React Compiler on), Tailwind 4 tokens (**no hex or rgb colours in TSX**), shadcn/ui in `apps/web/components/ui` (`Button` sizes `xs`, `sm`, `icon-xs`), `lucide-react`.
  - `@tanstack/react-query`, and `api<T>(path, { method, json })` from `@/lib/api`. Dense UI: `text-xs`.
  - Plain English copy, and a doc comment at the top of every new module.

## How a room tool plugs in

`apps/web/components/room/tools/registry.ts`:

```ts
export type RoomToolProps = { activeFile: TreeNode | null; openFile: (fileId: string) => void; close: () => void };
export const ROOM_TOOLS: RoomTool[] = [
  { id: "ai", label: "AI", icon: Sparkles, placement: "side", load: () => import("./ai/ai-panel") },
  { id: "notes", label: "Notes", icon: NotebookPen, placement: "side", load: () => import("./notes/notes-tool") },
  // …
];
```

A tool is a folder `apps/web/components/room/tools/<id>/` with a default-exported component taking `RoomToolProps`, and one entry in `ROOM_TOOLS`. Use `placement: "side"` and the `ShieldAlert` icon.

Inside a room, `useRoom()` (from `@/components/room/room-context`) gives `{ room: { id }, doc }`, where `doc` is the room's files Yjs document. Read the files with:

```ts
import { roomTexts } from "@/components/room/source-control/room-files";
const files: Map<string, string> = roomTexts(doc);   // path → text, every file in the room
```

To open a file at a line, use `openRoomFile(path, { startLine, startColumn: 1, endLine: startLine, endColumn: 1 })` from `@/components/room/editor/editor-opener`.

## What to build

1. **The manifests** (a pure module, `packages/contracts/src/dependencies.ts`, re-exported from `packages/contracts/src/index.ts`, so both web and API can use it, with vitest tests in `packages/contracts/src/dependencies.test.ts`). `parseManifests(files: Array<{ path: string; content: string }>)` returns `Array<{ ecosystem: "npm" | "PyPI" | "Go" | "crates.io" | "Packagist" | "Maven"; name: string; version: string | null; path: string; line: number }>`. Read:
   - **npm:**
     - `package-lock.json` (v2 and v3 `packages` entries: exact versions, best);
     - else `pnpm-lock.yaml` (the `packages:` keys `/name@version` and `name@version`);
     - else `package.json` (`dependencies` and `devDependencies`: a range, so `version` is the range's lowest version when it's a plain `^x.y.z` or `~x.y.z` or exact, else null).
   - **PyPI:** `requirements*.txt` (`name==version`; other specifiers give null), and `poetry.lock` (`[[package]] name / version`).
   - **Go:** `go.mod` `require` lines (with `// indirect` too).
   - **crates.io:** `Cargo.lock`.
   - **Packagist:** `composer.lock`.
   - **Maven:** `pom.xml` `<dependency>` with a literal `<version>`.

   Skip anything under `node_modules/`, `vendor/`, `.venv/` or `target/`. Keep `line` (1-based) for jumping to it. When a lock file exists in a folder, prefer it over that folder's manifest, and don't list a package twice.
2. **API** (`apps/api/src/dependencies/dependencies.controller.ts` and a service; register both in `apps/api/src/app.module.ts`'s `controllers` and `providers`):
   - **`POST /api/rooms/:roomId/dependencies/check`**, body `{ packages: [{ ecosystem, name, version }] }` (zod: at most 5,000 packages; the browser parses, the API only checks).
     - Require `room.view`.
     - Query **OSV's batch API**, `POST https://api.osv.dev/v1/querybatch` with `{ queries: [{ package: { name, ecosystem }, version }] }`, chunked to 1,000 per request. Then fetch each vulnerability's details from `GET https://api.osv.dev/v1/vulns/<id>`, at most 8 at a time.
     - Cache answers in memory for 6 hours, keyed by ecosystem, name and version for the batch, and by id for the details, so a room checked twice doesn't ask OSV twice.
     - Return `{ results: [{ ecosystem, name, version, vulns: [{ id, aliases, summary, severity: "critical" | "high" | "moderate" | "low" | "unknown", fixed: string | null, url }] }] }`.
     - **Severity:** use `database_specific.severity` when present (GitHub's advisories have it); otherwise compute it from the CVSS vector in `severity[]`, or say "unknown". Implement a small CVSS v3.1 base-score calculator yourself, in a pure file with tests; don't add a package.
     - **`fixed`:** the lowest `fixed` event in the affected ranges for that package.
     - Packages without a version are skipped (they can't be checked), and the answer lists them as `unchecked`.
   - Use Node's `fetch` with a 15-second timeout per request (`AbortSignal.timeout`). If OSV can't be reached, answer 502 with "Couldn't reach the vulnerability database (osv.dev). Try again in a minute."
3. **Web**: the `dependencies` tool, `apps/web/components/room/tools/dependencies/dependencies-tool.tsx`.
   - **Check:** parses `roomTexts(doc)` with `parseManifests`, then calls the API from a **Check** button. Also check once when the tool opens, and again after manifests change, debounced by 10 seconds.
   - **Top line:** a summary: "12 packages, 3 with known vulnerabilities (1 critical, 2 high)", or "No known vulnerabilities in 40 packages."
   - **The list:** grouped by severity, critical first. Each row shows the package and version, the file and line (click to open it), and per vulnerability its id (a link to `https://osv.dev/vulnerability/<id>`), summary and "Fixed in x.y.z". Severity is a small label: critical and high in `text-destructive`, moderate and low muted.
   - **What wasn't checked:** packages without a version, under "Not checked (no exact version)", folded.
   - **Copy as Markdown:** a button that copies the list, for an issue or a PR.
   - **Empty state:** "No dependency files found (package.json, requirements.txt, go.mod, Cargo.lock, composer.lock, pom.xml)."
4. **Tests:**
   - vitest for `parseManifests` (each format, with line numbers and lock-file preference) and for the CVSS calculator (known vectors: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` is 9.8 critical; `CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N` is 3.1 low).
   - A browser test, `apps/web/test/dependencies.e2e.mjs`, modelled on the existing ones (helpers in `apps/web/test/browser.mjs`: `launch()` gives `{ browser, errors, signIn }`, `signIn(email)` gives `{ context, page }` in the test room E2ETST, and there are `check(name, ok, detail)` and `finish()`).
     - Sign in as test1@codechatter.local (password `codechatter123`).
     - Make `deps_<stamp>/package-lock.json` with a lock entry for `lodash` `4.17.20`, which has known advisories: make the file with the Files view's **New file** button (placeholder `name.ext`), then paste its text from the clipboard into the editor (`.monaco-editor .view-lines:visible`).
     - Open the Dependencies tool from the title bar's side buttons (its button is named "Dependencies").
     - Expect at least one vulnerability for lodash, and that clicking the row opens the file.
     - Delete the folder at the end: focus its tree item, then the Delete key.
     - This needs the internet (OSV), and the test says so in its header comment.

## Files you may touch

- `packages/contracts/src/dependencies.ts`, `packages/contracts/src/dependencies.test.ts` (new), `packages/contracts/src/index.ts` (one line)
- `apps/api/src/dependencies/*` (new, including `cvss.ts` and `cvss.test.ts`), `apps/api/src/app.module.ts` (register)
- `apps/web/components/room/tools/dependencies/*` (new), `apps/web/components/room/tools/registry.ts` (one entry, one icon import)
- `apps/web/test/dependencies.e2e.mjs` (new)

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context.
2. The owner's commands to check it:
   - `pnpm --filter @codechatter/contracts build` and `pnpm --filter @codechatter/contracts test`
   - `pnpm --filter @codechatter/api typecheck` and `pnpm --filter @codechatter/api test`
   - `pnpm --filter @codechatter/web exec eslint <files>` and `pnpm --filter @codechatter/web typecheck`
   - from `apps/web`: `node test/dependencies.e2e.mjs`
3. Anything you weren't sure of in OSV's response shapes, so the owner knows where to look.

## Check your work before you answer

Review your own answer before sending it, and put this review at the end, under **Self-check**. The owner's other AI checks every answer against the repository before it's used. Problems you find and fix yourself save a round trip; a "Done" that isn't true costs one.

1. **The brief, point by point.** A table with one row for each requirement in "What to build":

   | Requirement | Done, Partly or Not done | Where (file and function) | How you know |
   |---|---|---|---|

   Only write Done when the code in your answer does it. If something is Partly or Not done, say what's missing and why.
2. **The rules.** Confirm each one, or say where you broke it and why:
   - you changed only the files under "Files you may touch";
   - no new packages, apart from any this brief allows (and then you gave the exact command);
   - in `apps/api`, `apps/collab`, `apps/runner` and `packages/*`, relative imports end in `.js`;
   - in web files, no hex, `rgb()` or `hsl()` colours, only token classes; copy is plain English;
   - every new file starts with a doc comment saying what it is and why;
   - nothing logs, prints or returns a secret.
3. **What you assumed about existing code.** List every name you used but didn't see in this brief or in the files you read: a function, column, route, prop, environment variable or test helper. For each, say whether you read it in the repository or guessed it. Guesses are the first thing the owner checks.
4. **Walk through the tests.** For each test or check you wrote, say which part of your code makes it pass. Then write down at least one way the feature could break that no test covers.
5. **Edge cases.** The failure cases you handled (bad input, no permission, a network error, two people at once, a retry, a restart) and the ones you didn't.
6. **Scope for improvement.** What you'd do next, and anything in the existing code you read that looks wrong or could be better. Keep it separate from this task: list it, don't build it.
