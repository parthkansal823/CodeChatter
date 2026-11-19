# CodeChatter v2: how each piece was built

The detailed record behind the pathway: what each piece does, the code it lives in, the decisions, and the tests it passed, by section (§1 to §14).

- **The pathway** (the stages in order, with status): [roadmap.md](roadmap.md)
- **What's left**, in the order it'll be done: [pending.md](pending.md)

Statuses here match the pathway. When a piece is finished, its write-up is added here, its line in the pathway turns ✅, and it leaves pending.md.

**Legend:**
- ✅ done and tested
- 🟡 in progress
- ⬜ planned

## Build order and why

| # | Phase | Why this position |
|---|---|---|
| 1 | Foundations and live editor | ✅ Everything else builds on it |
| 2 | Run and terminal in a sandbox | ✅ The core promise of a coding room |
| 3 | Recruiter kit | Makes the project easy to show: one-click demo, README, video |
| 4 | AI copilot and AI agent | 🟡 The most impressive feature in a demo |
| 5 | Collaboration tools | Whiteboard, notes, video: what makes it a *room*, not just an editor |
| 6 | Pro editing | What professional users expect: LSP, history, comments, git |
| 7 | Interview mode | A complete product use case (hiring) |
| 8 | Teams and admin | Organisations, roles, audit: "industry use" |
| 9 | Automations and platform | n8n-style workflows, webhooks, API, CLI, MCP |
| 10 | Hardening and launch | Security, performance, observability, CI |
| 11 | Advanced features | Features most IDEs don't have. The headline ones are pulled forward (below) |
| 12 | Workspace suite (section 13) | Notion, Obsidian, Postman, Figma and Slack features built in. Runs after phase 4 (AI), in the order given in section 13 |
| 13 | Full IDE (section 14) | VS Code-level editor, every language, room network, one-click databases, frameworks, GitHub. Next after the agents' tools are checked |

**Your picks** from the idea list (section 12) are scheduled into these phases; the table at the end of section 12 shows where each one goes.

**Pulled forward** because they make the strongest demo:
- the **multiplayer debugger** comes right after Phase 2, since it needs the sandbox
- **live authorship** and **suggestion mode** come with Phase 6
- **codebase Q&A** and the **AI team** come with Phase 4

## 1. Foundations and live editor ✅

**Platform:**
- ✅ Monorepo (pnpm, Turborepo), TypeScript end to end.
- ✅ Local infrastructure with one command: Postgres 18, Valkey 9, Mailpit, S3 storage, Caddy.
- ✅ Database schema and migrations (Drizzle).

**Accounts:**
- ✅ Better Auth: email and password with verification, password reset, two-factor authentication, organisations, and admin.
- ✅ Google and GitHub sign-in (enabled by keys).
- ✅ Real email through Gmail SMTP.

**Server:**
- ✅ NestJS API covering rooms, members, invite links and audit events.
- ✅ Problem+JSON errors.
- ✅ Health and readiness checks.

**Live editing:**
- ✅ Hocuspocus servers with Postgres persistence and Valkey scale-out.
- ✅ Room file tree in Yjs: create, rename, move, trash and restore files, and templates.

**Web app:**
- ✅ Next.js 16 app with a black, white and orange design system and light and dark themes.
- ✅ Landing page with a live typing demo and a working Run demo.
- ✅ Sign in, sign up, verify, reset and two-factor pages.

**Rooms:**
- ✅ Dashboard: rooms table, new room from a template, and join by code or invite link.
  - fixed: a long invite link stretched the "room is ready" dialog, pushing the copy button and Open room outside it. Dialogs can no longer be widened by their content, and the link now wraps whole (one click selects it). Browser test `apps/web/test/new-room.e2e.mjs` (4/4, desktop and phone widths)
- ✅ Room IDE:
  - explorer, tabs, and Monaco with live cursors and presence
  - status bar and people panel
- ✅ **A calmer room layout:**
  - the activity bar has your Files, then the room's apps as their own group (Docs, API, Design, Whiteboard, Diagrams), with terminals at the foot
  - Chat (with its unread count) and AI open from small toggles in the title bar, and clicking the people there opens People
  - that side panel starts closed, so the code gets the room, and each room remembers whether you opened it
- ✅ **A tidier room** (2026-11-17, the owner: "pura UI cluttered hai"), for a laptop or desktop screen:
  - **The activity bar** keeps the code's own views (Files, Search, Outline, Source control, History, Comments, Run and debug), then the apps you pinned and the one open now, then **Apps**: a list of every app, grouped (Write and plan, Data, Build and run, Check and improve), each saying in a line what it's for, with a search, and the panels beside the code (AI, Notes, Activity, Dependencies). An app is pinned to the bar from there; pins follow you to any browser with the editor's settings (`pinnedApps`). The Research layout keeps its own apps in the bar. It was 21 icons with no names.
  - **The title bar** has who's here, Chat and AI, Run, Call, Share, **More** (Present, Fork, the theme) and the bell, rather than fourteen things; Notes, Activity and Dependencies are tabs in the side panel once it's open, and under Apps. Presenting shows "Presenting" there, to stop in one click.
  - **Share** no longer runs off its edge: a long invite link ends in "…", with its Copy button beside it.
  - **Where:** `components/room/apps-launcher.tsx` (new), `room-workspace.tsx`, `title-bar.tsx`, `fork-dialog.tsx` (`ForkDialog`, for the menu), `share-menu.tsx`, `tools/registry.ts` (each app's `description` and `group`), `editor/settings.ts` (`pinnedApps`).
  - **Tests:** the browser tests open apps with `openApp` and the More menu with `fromMore` (`test/browser.mjs`); `a11y.e2e.mjs` adds the Apps list and More, open, in both themes. Run after the change: a11y (158 checks), automations (93), analysis (24), prompts (38), task-board (21), public-rooms (15), present (14), notes (11), notifications (11).
  - read-only mode for viewers
- ✅ Room chat: history, offline outbox, code snippets, unread badge.
  - **Unread tracking and room search (ChatGPT 22, verified 2026-11-19):** each person's read position is stored in Postgres and advances monotonically across devices. Room and dashboard badges count other people's retained messages, cap at 99+, and exclude own, deleted, system, GitHub and automation posts. Dashboard counts are fetched in one request.
  - **Reading:** opening chat starts at the first unread message. Only visible messages in the focused conversation advance the cursor; unseen overflow and gaps in loaded history remain unread. A paused read is rescheduled when the reader returns. Delayed pages cannot restore deleted content or mark a live gap read.
  - **Search:** literal, case-insensitive AND terms, including `%` and `_`, with highlights, author/time, 50-result pages and a jump into surrounding history. Submitting the same search refreshes newly matching messages. Integration posts remain searchable.
  - **Where:** `packages/contracts/src/chat-unread.ts`, API `messages/`, web `chat-panel.tsx` and the room/dashboard unread integration. Migrations `0017` and `0018` persist read cursors and index eligible messages; both are already present locally. No new migration was needed for the final automation exclusion.
  - **Verification:** API chat unit tests 28/28; browser `apps/web/test/chat-unread.e2e.mjs` 21/21 with two devices, delayed responses and fixture cleanup; PostgreSQL `apps/api/test/chat-unread.e2e.mjs` 6/6 with all fixtures rolled back. Contracts build, API/web typechecks and scoped web lint passed. Both end-to-end suites are registered in `scripts/e2e-ci.mjs`.
  - **Checked by Claude (2026-11-19):** the diff read against the brief; its checks run again; and the button, dashboard, the "New messages" line and search looked at in a browser, light, dark and phone width. Fixed:
    - **Where counting starts:** someone with no read position counted the room's whole history, so a new member (and every member, when this shipped) opened every room to 99+. A member now counts from when they joined (`room_members.created_at`), and a visitor from their first look (`registerChatReaderQuery`), until they've read something.
    - **The dashboard loaded the chat panel** to show a count: the hook is now `components/room/chat-unread.ts`.
    - **A search's marked words** were barely visible in dark: now stronger, and bold, not colour alone.
  - **After the fixes:** API unit tests 30/30, PostgreSQL 8/8 (adding a member who joined late, and a visitor's first look), browser 21/21, accessibility 164/164, API and web typechecks clean.

**Running and deploying:**
- ✅ Works from a phone or laptop on the same Wi-Fi.
- ✅ Production Docker images and compose file, with automatic HTTPS (docs/deploy.md).
- ✅ `pnpm dev:stop`: frees ports held by an old dev session.

**Tests:** auth flow 11/11, collab 10/10, workspace model 10/10, permissions and contracts 10/10, production smoke test 10/10.

## 2. Run and terminal in a sandbox ✅

One private Docker container per room (ADR 0003). It has no network, no secrets, a read-only system, and limits on CPU, memory and process count.

**Sandbox:**
- ✅ Sandbox image: Python 3 (with pytest), Node 24, TypeScript, C, C++, Java, Bash, git, tmux.
- ✅ File-sync agent inside the sandbox:
  - room files are written in live, and files programs or the terminal create sync back
  - dependency folders are ignored
- ✅ **Runner service:**
  - a container per room, idle stop and garbage collection
  - namespaced, so several deployments can share one Docker host
  - a sandbox that runs out of processes (fork bomb) is reset automatically before the next run
- ✅ Service tokens between the API, runner and collab.

**Run:**
- ✅ **Run button** (Ctrl+Enter) for Python, JavaScript, TypeScript, C, C++, Java and Bash. HTML files get **Preview** instead.
- ✅ Output shared with everyone in the room; typed input goes to the program (only from whoever started it).
- ✅ Stop, a 30-minute time limit and a 2 MB output limit.
- ✅ Runs always use the latest edits (Yjs state-vector barrier).

**Terminal and preview:**
- ✅ **Terminals:** tmux sessions that survive a closed tab or a reconnect, up to 4 per person, editors only.
- ✅ **Terminals, Run and the judge stay inside the workspace:**
  - `cc-jail` confines them with Landlock, a Linux kernel feature: listing `/` or reading `/opt`, `/var` and the rest gives "Permission denied", even from Python
  - `cd ..` at the workspace root explains instead of leaving
  - the prompt shows `workspace/<folder>`
- ✅ **Static web preview:** HTML/CSS/JS rebuilt live as anyone types, in a sandboxed iframe that can't reach the app or your cookies. Console output shown underneath.
- ✅ **Ports and resources tab:** live CPU, memory and processes; the ports servers listen on; Restart sandbox.
- ✅ **Dev-server preview:**
  - each port opens on its own origin (`p3000-room.preview…`) through a one-time ticket, with host-only cookies
  - traffic goes through a TCP tunnel over the agent, so the sandbox still has no network
  - hot-reload WebSockets pass through
  - the server in the sandbox never sees the app's cookies (browser test 7/7)
- ✅ **The room's browser** (2026-11-18, the owner: "in built browser… ek button… jis bhi component prr click krre toh woh uske code prr chla jaye", then "SEO lighthouse network sabh", "not only on html, do on react and every other supported"):
  - **Browser**, beside Preview above the editor (or the palette), opens a dev server's page in a pane beside the code: back, forward, reload, which server (any port listening), an address bar, Open in a new tab, and a width (Fit, phone 390, tablet 768, laptop 1280, desktop 1440).
  - **How it sees the page:** the preview proxy adds a small script, the bridge, to HTML loaded in a frame (`apps/api/src/preview/preview-bridge.ts`, served at `/__cc/bridge.js`, never to a page opened in a tab of its own). It talks only to the app's origin, and the pane listens only to the frame's own origin. To let the frame in, the proxy takes off `X-Frame-Options`, sets `frame-ancestors` to the app, and gives the frame a partitioned cookie (a one-time ticket with `frame=1`); compressed pages are unpacked to add it. The app's `frame-src` allows the preview host.
  - **DevTools**, below the page, in tabs:
    - **Console:** what the page logged and its errors, counted, kept across pages if you like; a line to run JavaScript in the page, with history
    - **Network:** every request (fetch, XHR and what the browser loaded) by kind, with its status, size and time, and each one's details
    - **Elements:** the page as a tree; hovering marks the element in the page, and picking one says what it is and where its code is
    - **Performance:** the Web Vitals as the browser measures them (TTFB, FCP, LCP, CLS, INP, long tasks), each rated
    - **SEO:** the title, description, headings, links, images without alt text, Open Graph, canonical and language, with what's missing (`browser/seo.ts`)
    - **Application:** local and session storage and cookies; delete one or clear them
    - **Lighthouse:** Google's own, run in the room's sandbox with the image's Chromium against the page shown, as a phone (throttled) or a desktop, for the categories ticked: each score, the Core Web Vitals, what failed with Lighthouse's advice, and its whole report in a dialog (the HTML preview's sandboxed frame, `/frames/document`, never the app's origin)
  - **Click to code:** turn it on, click anything in the page, and its file opens at its line. It reads what each framework leaves on elements in development: React's fiber (`_debugSource`, or React 19's `_debugStack`), Vue's component file, Svelte's `__svelte_meta`, or `data-source`-style attributes; for plain HTML it finds the element's markup in the room's files (`browser/source-map.ts`). The click picks rather than presses, and it turns itself off after one.
  - **Lighthouse in the sandbox:** Lighthouse 13.6 (`sandbox/image/lighthouse/`, a locked install) and Debian's Chromium are in both images; `sandbox/image/lighthouse.py` runs it headless inside the jail and returns a summary and the report. The runner's `/rooms/:id/lighthouse` (`apps/runner/src/lighthouse.ts`, three minutes at most) is behind the API's `POST /api/rooms/:id/lighthouse` (Run rights; not in interviews). Its input is `LighthouseInput` in `packages/contracts/src/lighthouse.ts`.
  - **Tests:** `apps/runner/test/lighthouse.e2e.mjs` 14/14 (a page with problems on purpose: every score, the missing description, language, alt text and link text, the Web Vitals, the whole report, a desktop with one category, a port with nothing on it); browser `apps/web/test/room-browser.e2e.mjs` 37/37 (the console, the network and its filters, running JavaScript, storage, the elements tree, SEO, Web Vitals, Lighthouse and its report, links, back, a tablet's width, a tab of its own, and click to code for HTML, React and Vue); unit `source-map.test.ts` 4/4 and `seo.test.ts` 4/4.
- ✅ **Competitive-programming helper** (Tests tab):
  - shared test cases per file, Run tests (compile once, time limit), and verdicts: Passed, Wrong answer, Runtime error, Time limit, Compile error
  - custom input
  - import samples from AtCoder and CSES links; Codeforces refuses automated requests, so paste those
  - judge end-to-end 9/9, browser 4/4
- ✅ Network switch (owner only, audited, turns itself off after 1 hour, allow-listed package registries): built as **package installs** (section 14, the room network; `egress.e2e.mjs` 24/24 on both drivers).
- ✅ **Python notebooks** (.ipynb), 2026-10-20:
  - a `.ipynb` file opens cell by cell, and everyone edits cells at once (each cell is its own Y.Text, `packages/workspace-model/src/notebook.ts`); a coloured line shows who is in which cell
  - cells run in an IPython kernel in the room's sandbox, inside the jail (`sandbox/image/kernel.py`, driven by `apps/runner/src/notebooks.ts`): one kernel per notebook, variables shared by everyone's cells
  - outputs arrive for everyone as they come: printed text, returned values, matplotlib plots, pandas tables (in a frame that runs no scripts), Markdown, and coloured tracebacks; they're saved with the notebook
  - Shift+Enter runs and moves on, Ctrl+Enter runs in place, Alt+Enter adds a cell below; the title bar's Run is Run all; an error stops the cells after it; Interrupt, Restart and Shut down
  - text (Markdown) cells, add, move, delete and switch cell types
  - the `.ipynb` text follows the cells (the runner is its only writer), so the sandbox, search and downloads see a real notebook
  - fixed before release: a cell went blank and stopped taking typing when a notebook was the page's first editor (VS Code's services took over its anonymous model and disposed of it); cells now have registered addresses like files
  - tests: `apps/runner/test/notebooks.e2e.mjs` 14/14, browser `apps/web/test/notebook.e2e.mjs` 24/24 (two people), `components/room/notebook/ansi.test.ts` 6/6

**Production and tests:**
- ✅ Runner and sandbox image in production compose; the production smoke test runs code end to end (11/11).
- ✅ Runner end-to-end test (22/22):
  - six languages, typed input, file sync both ways, and terminals that survive a reconnect and stay inside the workspace
  - Stop, fork-bomb recovery, no secrets in the sandbox, no network, and a non-root user with a read-only system
- ✅ Browser tests: two people share Run output (6/6); static preview (7/7).
- ✅ **Browser tests live in `apps/web/test/`:**
  - `room-people.e2e.mjs`: each person counted once even with two tabs, and no stray scrollbars (4/4)
  - `docs.e2e.mjs` (8/8)
- ✅ Tests use their own seeded room, **E2ETST "Automated tests"**, so they never leave files in rooms people use (TEAM22 was cleaned).
- ✅ **Fixed:**
  - your own other tabs no longer show as extra people ("T T T", "3 people")
  - the panel tab strips no longer draw a ▲▼ scrollbar from a 1px overflow
  - the terminal follows the theme: it used to read the colours a switch too early, so it showed the old theme (white in dark mode, black in light)
  - code suggestions are readable in the light theme (they showed white text on light grey); a test now measures their contrast
- ✅ **Tools plug-in point** in the room (`components/room/tools/registry.ts`): side tools next to Chat, main tools in the editor area.
- ✅ **Room documents:** files, pages, api, designs and boards, plus per-item page, design and board documents, all authorised and persisted by collab.
- ✅ **A test that rooms can't read each other's files** (`apps/runner/test/isolation.e2e.mjs`, 2026-10-10), 6/6 on Docker and Kubernetes:
  - another room is made through the API, with a file only it has, which its own sandbox reads
  - this room's sandbox looks everywhere it can read for that file and finds nothing; the jail leaves it `/workspace` and `/tmp` only
  - its sandbox mounts only its own storage: its two volumes (Docker), or its own namespace's claims (Kubernetes)

## 3. Recruiter kit ⬜

- ✅ **"Try the demo" button** (landing page and sign-in):
  - one click makes a guest account and opens a guided-tour room with runnable examples and pre-filled tests; no sign-up, no email
  - limited to 5 a hour per network; guests are deleted after a day; `DEMO_ENABLED` turns it on in production
  - browser test 4/4
- 🟡 **README** (2026-10-10):
  - ✅ **Written for v2** (it described v1):
    - the features, and three screenshots from the Kubernetes demo (`docs/images/`)
    - the security model, an architecture diagram (Mermaid, checked to render) and the stack
    - running it locally or on Kubernetes, and the test suites with their counts
  - ⬜ A GIF and a 2-minute video link.
- ✅ **Showcase mode** (2026-10-10):
  - **What it is:** the landing page on its own, for Vercel's free plan (`NEXT_PUBLIC_SHOWCASE=1`, `apps/web/lib/showcase.ts`; steps in `docs/deploy.md`).
  - **What changes:**
    - the buttons open the demo video, the code and how to run it, instead of signing in
    - the app's pages, sign-in included, lead back home
    - the Docker web image takes the same build arguments
  - **Tested** as a production build in a container; Vercel itself not tried yet.
  - **The landing page now claims only what's built.**
    - It advertised automations, organisations, an audit log, time travel, revocable sessions and an AI typeface, none of which exist yet.
    - Those sections are now one-click databases and dev servers, and a truthful "Safe to share a room".
    - The agent's diffs say Accept and Reject, as the panel does.
- ✅ Demo video script ([docs/demo-script.md](demo-script.md)), 2026-10-10:
  - setup, a shot list with times and what to say, and what to do with the video afterwards
  - each shot shows something that works today
  - the recording is the owner's

## 4. AI copilot and AI agent 🟡

The **AI** tab sits next to Chat. This PC runs it on **local Ollama** (`AI_PROVIDER=ollama`, `AI_MODEL=gemma4:e4b`, in Docker): free, private, no key. Other options are in `.env.example`.

Tests:
- API unit tests: 310/310
- browser:
  - `apps/web/test/ai.e2e.mjs` (11/11), against the mock AI in `apps/api/test/mock-ai.mjs`, so no paid key is needed
  - `ai-ollama.e2e.mjs` (4/4), against a real local model

**Copilot:**
- 🟡 **Provider router:**
  - ✅ **Ollama**, local and free:
    - `AI_PROVIDER=ollama` plus a model; no key or URL needed
    - with AI off, the setup panel lists the models Ollama already has
    - errors say what to do ("ollama pull …", "start Ollama")
    - a smaller context by default, so small models don't silently lose their instructions
  - ✅ Claude, or any OpenAI-compatible server: OpenAI, Gemini, Groq, OpenRouter
  - ⬜ per-organisation keys, encrypted at rest
- ✅ **AI panel:**
  - streamed answers, with context chips for the file, the selection, the last Run output and the file list
  - pasted images, kept per room
  - modes:
    - Assistant
    - Explain error
    - Tutor (hints, not answers)
    - Mock interviewer
    - Complexity (Big-O)
    - Screenshot to code
    - Edit
    - Agent
    - Room summary
- ✅ **Inline completions:** ghost text as you type (350 ms pause; typing on cancels the request; Tab accepts, Esc dismisses; on/off in the status bar, settings and palette, kept per browser), from `POST rooms/:id/ai/complete` (needs AI chat and file edit rights; fill-in-the-middle on Ollama models that can, else a prompt with a cursor marker; answers cleaned of fences and repeats; own limit, `AI_COMPLETE_RATE_LIMIT` a minute; usage counted). Tests: 36 Vitest, 8 node:test, API e2e 13/13 and browser e2e 14/14 on local Ollama.
- ✅ **AI edit:**
  - describe a change, review it side by side, accept it
  - it lands as one change everyone sees live
  - Undo reverses only the AI's change, even after others have edited
- ✅ **Explain this error:**
  - a failed Run shows **Explain error** and **Fix**
  - either one opens the AI with the question already asked
- ⬜ **AI diagram:** a Mermaid flowchart generated from code or a description.

**AI coding agent:**
- ✅ It plans, then proposes steps: read, edit or create files, Run a file, run its tests. Each step waits for **approve** or **skip**, and edits show a review first.
- ⬜ Auto-approve for safe steps; a loop that reads errors and tries again on its own.
- ⬜ Agent-written code is shown in its own typeface (Monaspace Krypton).

**Also:**
- 🟡 Room summary, as an AI mode. Posting it to chat ⬜.
- 🟡 Usage:
  - ✅ token counts and a per-person limit (`AI_RATE_LIMIT` per 10 minutes, shared through Valkey)
  - ⬜ quotas per organisation

## 5. Collaboration tools ⬜

- ✅ **Whiteboard:** the **Whiteboard** tool. It is built on the same canvas engine as Design, not Excalidraw, so there is no licence and it shares one codebase.
  - sticky notes, pen, shapes, arrows, text and images, live for everyone
  - several whiteboards per room
  - **eraser** (E): drag across shapes and strokes; they fade, then go when you let go, and one undo brings them back
  - double-click empty space to type text
  - **export dialog**, like draw.io:
    - file name, format (PNG, JPEG, SVG, PDF), selection or everything
    - size, border, background (transparent, canvas or white), the grid
    - for PDF: fit to the drawing, or A4 or Letter in portrait or landscape
  - browser test 12/12, with Design
- ✅ **Flowchart:** Mermaid source edited together, with a live render. Written by ChatGPT:
  - A room file named `*.mmd` or `*.mermaid` gets Mermaid colouring and a preview, beside the code (Ctrl+K V) or on its own (Ctrl+Shift+V). The preview redraws as anyone types.
  - A mistake names its line ("Show in the code" jumps there), and the last good drawing stays up until it's fixed.
  - It uses `mermaid` 11.17.2 in the web package.
  - Files: `editor/mermaid-preview.tsx`, `mermaid-language.ts` and `preview-kind.ts`, and the `mmd` and `mermaid` languages in workspace-model.
  - Tests:
    - unit `preview-kind.test.ts` 6/6;
    - browser `mermaid.e2e.mjs` 12/12 (two people, a live update, a mistake, the full preview).
  - **Diagrams inside Markdown** (ChatGPT 25, checked 2026-11-19): a ` ```mermaid ` block in any Markdown the app shows (a README's preview, interview questions) is drawn in place, in quotes and lists too; other code stays code.
    - **Mistakes:** a block that doesn't parse shows its code with the line marked and the mistake in words ("Line 2: Mermaid expected a closing bracket…"), counted in the block as it reads; while someone types, the last good drawing stays, faded.
    - **Many at once:** each block has its own id and draws when it comes near the screen, so a long README opens quickly; the same diagram twice draws twice. Drawings follow light and dark, a wide one scrolls inside its own box, and each has Copy code and Download SVG (not in an interview question's compact view).
    - **Safety:** a README can come from a stranger's repository. Mermaid runs at its strict level with no HTML labels, its own directives can't turn those back on (`secure`), anything that looks like HTML is refused before Mermaid sees it, and the drawing is shown as an image, where no script can run. Tried with `click A call alert(1)` and an `<img onerror>` label, raw and encoded.
    - **One renderer:** the `.mmd` preview and Markdown share it (`mermaid-renderer.ts`, `use-mermaid-drawing.ts`, `mermaid-problem.ts`). Drawings are made one at a time, as Mermaid's settings are shared: a very slow diagram still holds up the next.
    - **Where:** `editor/markdown-preview.tsx` (`MarkdownPre`), `markdown-mermaid.tsx`, `markdown-mermaid-utils.ts` (the remark plugin marking the blocks), and the shared files above; `mermaid-preview.tsx` now uses them.
    - **Tests:** unit `markdown-mermaid-utils.test.ts`, `mermaid-problem.test.ts` and `preview-kind.test.ts` (26/26), browser `markdown-mermaid.e2e.mjs` (29/29: diagrams, mistakes, the theme, drawing near the screen, the script attempts, a block too big) and `mermaid.e2e.mjs` (13/13).
    - **Checked by Claude:** the diff read against the brief, its tests run again, the web typecheck (clean for its files), accessibility (166/166), and a README with two diagrams, a broken one and JavaScript looked at in a browser, light and dark: nothing to fix.
- ✅ **Notes:** shared notes, private notes, and a shared focus timer, in a Notes side panel (`tools/notes`) beside Chat and AI. The Docs tool keeps the pages that last; this is the scratchpad.
  - Room notes are rich text edited together, with carets. They live in `room:ID:notes`, which anyone who can chat may write, viewers included.
  - My notes are in `room:ID:mine:<your id>`, which collab opens for no one else. The AI's room activity leaves them out.
  - The focus timer (`focus-timer.ts`) is shared: a focus stretch (15, 25, 45 or 50 minutes), then a break (5, 10 or 15), and around again. Anyone who can chat can start, pause, skip or reset it, and everyone sees who started it. When a stretch ends, the first browser to notice moves it on, only once, and everyone gets a message.

  Tests: timer 5/5, collab `notes-access.e2e.mjs` 4/4 (someone else's private notes are refused), browser `notes.e2e.mjs` 10/10 (two people).
- 🟡 **Video and voice:** LiveKit (SFU with TURN), a dock and picture-in-picture, screen share.
  - ✅ **Calls in development** (`components/room/call/`, `apps/api/src/calls/`).
    - **Server:** the dev stack runs LiveKit 1.13.11 (`infra/livekit/livekit.dev.yaml`). Signalling goes through Caddy at `/livekit`; media goes straight to one muxed UDP port (7882), with TCP 7881 as a fallback.
    - **Tokens:** `POST /api/rooms/:id/call` signs a 6-hour LiveKit token for anyone who can chat in the room. It's an HS256 JWT made with Node's crypto, no LiveKit server package; LiveKit validates it and rejects a forged one. In development it falls back to the dev key; production needs `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
    - **In the room:** the title bar's Call button says how many are in the call ("Join call (2)", from presence). The dock shows a tile per person (their camera, or their initial, with a ring while they speak) and a shared screen large. It has microphone, camera, screen and Leave, and any video can go picture-in-picture. Leaving the room leaves the call.

    Tests: unit 3/3 (the token), browser `call.e2e.mjs` 10/10 (two people with the browser's fake camera and microphone; video really flows).
  - ✅ **Production** (written by ChatGPT). LiveKit 1.13.11 runs in production Compose and in the Helm chart, with its built-in TURN on UDP 3478.
    - **Compose:**
      - `infra/livekit/livekit.yaml` holds no keys; `LIVEKIT_KEYS` comes from `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`, which Compose now requires.
      - Caddy routes `/livekit` to LiveKit, and the host publishes TCP 7881 and UDP 7882 and 3478.
    - **Helm:**
      - `templates/livekit.yaml` makes a ConfigMap, a Deployment, a private Service for signalling, and a media Service (`LoadBalancer` or `NodePort`; ports that don't match stop the install with a message).
      - The keys are made once and kept across upgrades, and the edge routes `/livekit` only when calls are on.
    - **Docs:** `docs/deploy.md` "Calls (video and voice)" covers the ports to open and the check (`/livekit/` answers `OK`). The chart README covers the media Service, and how to rotate keys.
    - **Checked here:**
      - `docker compose config` renders;
      - `caddy validate` passes;
      - `helm lint` passes, and `helm template` renders 28 resources;
      - every chart guard fails as it should;
      - LiveKit starts with the production config (TURN up on 3478, `/` answers `OK`).
    - **Not checked here:** a real call through a server or the Kubernetes demo (the demo isn't installed now).
  - ✅ **TURN over TLS** on port 443, for networks that only allow HTTPS (UDP TURN and TCP 7881 don't get through those). Built by ChatGPT, checked here.
    - **How:** Caddy, with the pinned layer-4 module (`infra/docker/caddy.Dockerfile`), routes by the name asked for on 443. `turn.<DOMAIN>` is decrypted and passed to LiveKit's TURN with PROXY protocol, and everything else goes to the site as before. LiveKit trusts PROXY headers only from Caddy's fixed address on a private network. On Kubernetes it's a separate LoadBalancer on 443, and Helm refuses settings that couldn't work.
    - **Development:** TURN over UDP on `127.0.0.1:3478`, and `?callRelay=1` on a room's address forces relaying, which production builds ignore.
    - **Checked in a throwaway copy of production's edge** (the real Caddy image, Caddyfile and LiveKit config, with a stand-in site): TURN and the website answer on one TLS port; TURN sees the client's address, not Caddy's; LiveKit offers `turns:<domain>:443?transport=tcp` beside its UDP TURN; those credentials get a relay allocated over TLS; another name doesn't reach TURN.
    - **Tests:** `apps/web/test/call-relay.e2e.mjs` (8: media flows with only relay candidates selected, and without TURN it can't connect), `call-screen-share.e2e.mjs` (7), `call.e2e.mjs` (11). `docker compose config` and `helm lint` pass, and Helm's guards refuse bad settings.
    - **Not tried:** a public certificate, from a network that only allows HTTPS. That needs a real server (in `docs/pending.md`).
- ✅ **GitHub:** import a repository, commit, push and open pull requests (done in section 14 E, through the GitHub API).
- ✅ **Files:** uploads (images and binaries in S3), zip import and export.
  - ✅ **Text files in and out** (`components/room/files-transfer.ts`, `lib/zip.ts`), from the Files view's menu (…).
    - **Upload files, Upload a folder (keeping its paths), and Import a zip.** Dropping files or a zip from your computer works too, onto the list or onto a folder.
    - **The zip reader needs no package:** it inflates with the browser's `DecompressionStream`, refuses paths that leave the folder, and stops at 5,000 entries or 100 MB unpacked whatever the headers claim.
    - **What an import takes:** a zip whose files sit in one top folder (as GitHub's do) loses it. Binaries, files over 1 MB, and `.git` and `node_modules` are skipped, and the message says which and why.
    - **Undo:** a History checkpoint of the files as they were comes first (kind `import`, "Before importing …"), so an import can be undone.
    - **Download as zip** gives anyone who can see the room its code.

    Tests: unit 10/10 (`lib/zip.test.ts`, `files-transfer.test.ts`), browser `files.e2e.mjs` 8/8.
  - ✅ **Binary files** (images, PDFs, fonts, audio, video, data files), kept in the S3-compatible object store (SeaweedFS in dev). See ADR 0009.
    - **In the file tree:** a binary file is an ordinary file with a `blob` (SHA-256, size, type) and no text. Rename, move, delete and History work as for any file.
    - **Storage:** the bytes are at `rooms/<room>/<sha256>`, so reading one needs only permission to see that room. Fork copies them on the server.
    - **Coming in:**
      - Upload files, Upload a folder, Import a zip and drops take them, up to 20 MB each.
      - Text over 1 MB and anything not UTF-8 become binary files.
      - So do known binary types (PNG, PDF, fonts, zips, office files…) whatever their bytes; SVG stays editable text.
    - **In the editor:**
      - an image fits or shows at actual size, with its pixel size;
      - a PDF opens in the browser's viewer;
      - a font shows a sample you can type, at five sizes;
      - audio and video play, and can seek, since the API serves byte ranges;
      - anything else gets a hex view of its first 512 bytes.
      - Download is always there, and Replace for editors; a replace is live for everyone.
    - **Download as zip** includes binary files.
    - **API** (`apps/api/src/blobs`):
      - Routes: `POST /rooms/:id/blobs` (raw bytes, hashed as they arrive), `GET /rooms/:id/blobs/:sha256` and `POST /rooms/:id/blobs/copy`.
      - Downloads are never served as a page: only types the editor shows keep their type, with `nosniff` and a sandbox CSP. They're cached for good, and serve 304s and ranges.
    - **Sandbox:**
      - the runner writes binary files into the sandbox;
      - a binary a program makes, up to 5 MB, comes back as a binary file, with its bytes stored;
      - text written over a binary turns it back into text;
      - bigger binaries stay in the sandbox.
      - The agent is in both sandbox images, so `pnpm sandbox:build` and `sandbox:build:full`.
    - **The S3 client** is `@codechatter/auth/s3`: Signature V4 with Node's crypto, no SDK. It's checked against AWS's published examples and against SeaweedFS, which refuses a wrong signature.
    - **Production:** the `S3_*` settings for the API and the runner, in Compose; `docs/deploy.md` "Binary files". Without them binary files are off, and uploads say so.
    - **Tests:**
      - unit: S3 signing 5/5, workspace-model 34/34, contracts blobs 4/4, API headers and ranges 5/5, web `room-files` and `files-transfer` 11/11;
      - API `blobs.e2e.mjs` 23/23: headers, 304, ranges, 413, no access from other rooms or outsiders, copy;
      - runner `blobs.e2e.mjs` 7/7: bytes in byte for byte, replaced bytes, a program's binary back with its bytes stored, text over a binary, 6 MB staying in the sandbox;
      - browser `binary-files.e2e.mjs` 11/11 (two people);
      - `files` 8/8, `history` 14/14, `public-rooms` 10/10 and `editor` 16/16 still pass.
    - ✅ (2026-11-05) **Deleting a room deletes its stored files** (`rooms/<code>/`), and the API's janitor removes those of rooms that are gone every six hours (re-checking the database first, so a room made meanwhile keeps its files). The S3 client lists and deletes by prefix. API test 24/24 checks it.
    - ✅ (2026-11-05) **The Helm chart's `objectStore` settings** (endpoint, region, bucket; keys in the Secret) reach the API and the runner; a missing key stops the install with a message.
    - ⬜ **Next:**
      - collect objects no file or checkpoint uses any more, inside a live room;
      - binary files in GitHub import and commits;
      - a streaming download instead of buffering up to 20 MB.
- ✅ **Notifications:** inbox with unread counts and an email digest, plus an activity feed per room (`apps/api/src/notifications`).
  - **What notifies you:** being @mentioned by name in a room's chat ("@Ana", any case, names with spaces too). A reply on a code comment thread you're in, or a new comment that mentions you, with the file and line; your browser names who to tell, and the API only tells people in the room, with a rate limit. Someone joining a room you own, or asking to.
  - **Delivery:** notifications go live to your own Socket.IO channel, wherever you're signed in, with a short message. The bell (room title bar and the app sidebar) counts the unread ones, lists them, and marks them read when opened or all at once.
  - **Email digest:** whatever stays unread for an hour is emailed, at most once a day, and each notification only once. It can be turned off from the bell. Addresses that can't exist (test accounts) only go to a local mail catcher. The timings can be changed in env (`NOTIFICATION_DIGEST_*`, for tests). Migration `0006` adds `notifications.emailed_at` and `user_settings.email_digest`.
  - **Activity** (a side tool) shows the last week: who edited what, by the hour (never anyone's private notes), commits, pull requests and publishing, saved and named checkpoints, who joined, and the repository's activity.
  - A new route, `GET /rooms/:id/members`, lists the room's people (used for @mentions in comments).

  Tests: unit 3/3 (mentions and wording), API `notifications.e2e.mjs` 13/13 (its own API on :4012, digest checked in Mailpit), browser `notifications.e2e.mjs` 10/10 (two people).
- ✅ **Public rooms:** explore page, open read-only, fork into your own room.
  - **Visibility:** people who manage a room switch it between private and public from the lock or globe beside its code in the title bar (`PATCH /api/rooms/:id`, which can also change the name, description and join policy; audited as `room.update`).
  - **Explore** (`/explore`, `GET /api/rooms/explore?q=`) lists public rooms, most recently active first, searchable by name or description, with owner, members, and what each was forked from. Anyone signed in opens one read-only.
  - **Fork** (title bar, for anyone who can see the room) makes a new private room of yours (`POST /api/rooms/:id/fork`). Your browser copies the code in as the files are now; docs, designs and chat stay in the original. The fork shows "forked from …" with a link.

  Tests: browser `public-rooms.e2e.mjs` 10/10 (two people).

## 6. Pro editing 🟡

- ✅ **Language servers in the sandbox:** Python (Pyright), Go, C/C++ (clangd), Rust. TypeScript runs in the browser. (Section 14 A.)
- ✅ **Time travel:** checkpoints of the room's files in the `checkpoints` table, taken by collab from the live document (`apps/collab/src/extensions/checkpoints.ts`). They are made:
  - automatically every 10 minutes while the files change, and when a room first loads;
  - when someone saves one (by name or not);
  - before a restore, and before every AI edit (agent steps, Replace file, and applying a proposed change).

  A browser asks for one over its own connection (a Hocuspocus stateless message), so the checkpoint includes that browser's latest edits. Only people who can edit may ask, and everyone in the room hears when the list changes. Nothing is stored twice: an unchanged state returns the newest checkpoint. Old unnamed automatic ones are let go after 100 (50 for before-restore and before-AI ones); saved and named ones are kept.

  The History view (activity bar, or the palette) has a slider from the oldest checkpoint to now and the files that differ from now. Each file opens as a diff (a shared `TextDiffView`, which source control now uses too). You can restore one file or all of them; a "Before restoring" checkpoint is saved first. You can also name or delete a checkpoint. The API (`/api/rooms/:id/checkpoints`) lists them, serves one's Yjs state for the browser to read, and handles naming and deleting.

  Tests: unit 5/5 (`checkpoint-rules.test.ts`), collab `checkpoints.e2e.mjs` 10/10, browser `history.e2e.mjs` 14/14 (two people), and `source-control.e2e.mjs` still 19/19.
- ✅ **Inline comment threads** on code, anchored so they survive edits. The threads are in a document of their own, `room:ID:comments`; collab lets anyone who can chat in the room write it, so viewers and runners can comment as well. The model is `packages/workspace-model/src/comments.ts`.

  Each thread anchors to its code with Yjs relative positions into the files document. It moves with its code as people edit around it, says when that code has changed since the comment, and falls back to its line when the code is gone.

  In the editor:
  - Select code, then press Ctrl+Alt+M (a key in the shortcuts registry), right-click and choose Add a comment, or use the palette.
  - The code is tinted, with a mark beside the line numbers that folds and unfolds the line's threads.
  - Each open thread shows under its line. A view zone makes room, and the card sits over the editor, so typing in it never reaches the code. Ctrl+Enter sends a reply instead of running the file.
  - You can reply, resolve and reopen; a reply reopens a resolved thread. You can edit and delete only your own messages, and deleting the last one takes the thread with it.

  The Comments view (activity bar, with a count of open threads) lists every thread by file, open or resolved, and opens a thread at its code. Threads on deleted files are listed under Deleted files, where they can be removed.

  Tests: model 7/7 (27/27 in the package), browser `code-comments.e2e.mjs` 19/19 (two people).
- ✅ **Search and replace** across the workspace. (Section 14 A.)
- ✅ **Split and diff editors**, up to a grid of four. (Section 14 A.)
- ✅ **Follow and Present mode:** see what a teammate sees (`editor/present.ts`).
  - Following someone now keeps their scroll as well as their file. Each person's active editor publishes its first visible line as a Yjs relative position, so it holds while others edit above.
  - Present (title bar or palette) puts a start time in your presence, and everyone else in the room follows you at once.
  - The presenter's banner says who follows. A follower's banner offers Stop following; the same presentation then doesn't pull them back, and Follow rejoins.
  - When the presentation ends, followers stop following. If two people present, the newest presentation wins.

  Tests: browser `present.e2e.mjs` 13/13 (two people); `editor` 16/16 and `room-people` 7/7 still pass.
- ✅ **Command palette and shortcuts:** one key registry (`editor/keybindings.ts`: every command's VS Code default and where it works) and one listener (`editor/shortcuts.ts`) for the editor's, the room's and the debugger's keys, which were three handlers before. Any command in the palette can be given keys, and so can Monaco's own editing commands. The shortcuts sheet (Ctrl+K Ctrl+S, the palette, or Settings) is searchable by name or key. You can add a key or a two-key chord, take one away, or reset one command or all. A key that another command had moves to the new one, with a note. Plain keys are refused, since they're for typing. Your keys are editor settings, so they follow your account. The palette and the title bar show your keys. Chords are registered in every code editor and notebook cell as well, because Monaco owns chords in there. Tests: unit 12/12, browser `shortcuts.e2e.mjs` 15/15; `editor`, `search`, `problems` and `debugger` still pass.
- ✅ **Source Control panel:** branch, diff, commit and push through the GitHub API (section 14 E), and (2026-11-05) **real git in the sandbox**.
  - **What it is:** the Source Control view's **Git in the sandbox** section. It's open in a room that isn't on GitHub, and folded below GitHub's section in one that is.
    - It works on a real repository at the room's top folder, kept in the sandbox's volume (`.git` never syncs into the room).
    - Things git changes in the files, such as switching branch or discarding, reach everyone through the sandbox's file sync. Git used in a terminal shows up in the panel too.
  - **What you can do:**
    - Initialise a repository (`main`); its `.git/info/exclude` leaves out what the sync keeps in the sandbox (`node_modules`, `.venv`, build output).
    - See Staged and Changes, with each file's letter. Stage, unstage and discard (a dialog first), one file or all.
    - Commit, as the signed-in person: the API adds the author, and the browser can't. With nothing staged, it's **Commit all**.
    - Open any file against the last commit, in the editor area. Switch branch, or make one from here. See the History (the last 15 commits).
  - **Safety:**
    - Only these operations exist (`packages/contracts/src/git.ts`), each a fixed argument list.
    - They run inside the jail like a Run, with no shell, hooks and fsmonitor off, literal pathspecs, and paths checked to stay in the room.
    - Every operation needs Run rights (a repository's config can run filters), and changes need edit rights too.
  - **Code:**
    - runner `git.ts` (porcelain v2 parsing), route `POST /rooms/:id/git`;
    - API `sandbox/git.controller.ts`;
    - web `source-control/sandbox-git-section.tsx`, `sandbox-git.ts`, `git-diff-view.tsx`.
  - **Status stays fresh:** it reloads whenever the section opens, at most 1.5 s after any change to the room's files, and every 20 s while shown.
  - **Fixed on the way:**
    - the panel didn't reload status when reopened within 2 s of the last answer, so a new file took 20 s to appear; it now asks on every open (88 ms in the test);
    - the branch picker was too wide and pushed the section sideways.
  - **Tests:**
    - unit: runner `git.test.ts` 4/4, contracts `git.test.ts` 3/3;
    - runner `test/git.e2e.mjs` 20/20, in a disposable room: rights, init, stage, commit author, show, log, branches, a branch switch and a discard changing the room's files, and the errors;
    - browser `sandbox-git.e2e.mjs` 10/10;
    - `source-control` 19/19 and `history` 14/14 still pass.
  - ⬜ **Next:**
    - push and pull to a remote (the sandbox has no network to GitHub; it could go through the API, as today's GitHub commits do);
    - merges and conflicts in the panel;
    - repositories in subfolders.
- ✅ **Secret scanning** before a push (`apps/api/src/github/secret-scan.ts`). A commit, a publish or a gist with a key or password in it is refused with each finding: the file and line, what kind (AWS, GitHub, GitLab, Slack, Stripe, Google, OpenAI, Anthropic, npm and SendGrid keys, private keys, a password in a database URL, a secret in an `.env` file, a hard-coded secret). The preview shows only the key's ends. Source control and the gist dialog list the findings, and each one opens its file at that line. "Commit anyway" (or Publish, or Make it) sends it, and the audit log records where and what kind, never the secret. Placeholders, names, words, documentation values (`EXAMPLE`, `abcdefg…`), local database URLs and a line marked `gitleaks:allow` are let through; the repository's 692 files and every template scan clean. Tests: unit 11/11, the API's source-control e2e 55/55 (refused commit and publish, a gist sent anyway), browser `secret-scan.e2e.mjs` 8/8.

## 7. Interview mode ✅

How it works and what it guarantees: `docs/interviews.md`.

- ✅ **Question bank:** starter files, visible and hidden tests, a rubric and a length, per organisation (`interview_questions`, `/interviews`, `components/interviews/question-form.tsx`). Removing one archives it; interviews keep their own snapshot.
- ✅ **Scheduling:** a private room with `kind: "interview"` and the creator as `interviewer`, seeded from the snapshot by collab (`persistence.ts`). The candidate's link is single-use, stored as a hash, can be replaced until used, and can be emailed (`interviewInvitationEmail`).
- ✅ **Joining:** with an account, or as a guest under the candidate's name (`DemoService.createGuestAccount`). They have no room membership until it starts, and wait on `/interview/<token>`, which shows nothing of the question.
- ✅ **Server-side timer and phases:** scheduled, live, finished or cancelled. `InterviewsService` closes interviews that run out, with conditional updates so several API instances are safe. Browsers count down from the server's `now`.
- ✅ **Rights really go:** the candidate becomes a viewer, collab closes the room's sockets (`extensions/revocation.ts`, over Valkey), and the sandbox restarts.
- ✅ **Tests panel:** the room's Interview panel (`tools/interview/`). Hidden tests run in a throwaway container with no network (`apps/runner/src/judge-box.ts`). Candidates see counts, and interviewers see every case (`interviews/views.ts`).
- ✅ **Private rubric and scorecard** (`scorecard-form.tsx`), behind `interview.rubric`.
- ✅ **Replay:** code, runs and chat on one line, rebuilt in the browser from `doc_updates` (`replay.ts`, `replay-view.tsx`).
- ✅ **Report:** Markdown to copy or download (`report.ts`).
- ✅ **No AI for candidates:** refused by the API and hidden in the room. No forking interview rooms.
- ✅ **A reminder before an assessment closes** (ChatGPT 23, checked 2026-11-18): candidates who haven't started get one email, at the later of 24 hours before it closes and halfway through its window (from when it was made, if it has no opening time), never in its last 15 minutes. It has the assessment's title, how long is left and the time in UTC, and its length, and points to the invitation they already have, which still works (and so does a device they've already claimed): no new link or token is sent.
  - **Once:** the existing interview timer (`ASSESSMENT_REMINDER_SWEEP_MS`, 10 seconds) looks; each reminder is claimed in Valkey (`SET NX`) and a lasting receipt is kept, so several API servers, restarts and a later closing time send no second one; Valkey losing its data allows at most one more. Eligibility is checked again just before sending, and the database read again, so someone who has just started gets none. A mail that fails isn't tried again: the interviewer sees it as not confirmed.
  - **The interviewer sees** for each candidate whether the reminder was sent, when, or why not (`interview-detail.tsx`).
  - **Where:** `apps/api/src/interviews/assessment-reminders.ts` and `interviews.service.ts`, `apps/api/src/mail/mail.service.ts` (`sendAssessmentReminder`), `packages/emails/src/index.tsx` (`assessmentReminderEmail`), `packages/contracts/src/interviews.ts`, web `components/interviews/interview-detail.tsx`.
  - **Tests:** `assessment-reminders.test.ts` (29: the timing, its edges and exclusions, the claim, restarts, Valkey forgetting, a changed window, failures), `apps/api/test/assessment-reminders.e2e.mjs` (23: two APIs of its own with real sign-in and Mailpit; who gets one and who doesn't, the email's content, the original invitation still working, no duplicates from overlapping timers, restarts or a later deadline, cleanup). Run here: the API's 548 unit tests, the e2e 23/23, typechecks and lint; the code read through; the interviewer's line looked at in a browser in every state, light and dark. **Changed when checking it:** that line's wording, made short and plain ("Reminder mail failed 18 Nov 2026, 14:30 UTC" rather than "Reminder could not be confirmed sent; attempted…", which also pushed Delete onto a line of its own), with "yet" while the assessment is still to come.

Tests: `apps/api/src/interviews/views.test.ts` (6), `apps/web/components/interviews/{replay,report}.test.ts` (11), `apps/collab/src/extensions/revocation.test.ts` (2), `apps/runner/test/judge-isolated.e2e.mjs` (9), `apps/collab/test/interviews.e2e.mjs` (78, including the timer taking rights from an open editor), `apps/web/test/interviews.e2e.mjs` (32, the whole flow with a guest). All three end-to-end suites are in `scripts/e2e-ci.mjs`.

- ✅ **Interviews and assessments, as two modes** (2026-11-06, `docs/interviews.md`):
  - **An interview is live, on video.** It can start with no questions. The interviewer asks from the bank, at random, or writes one on the spot, and the candidate sees it at once (`InterviewsService.askQuestion`). Questions prepared beforehand stay hidden until asked, and so do their files. The AI is their call, with a switch in the panel (`setAi`), on the record along with each use. Answers appear live, and marks and the scorecard are in the panel.
  - **An assessment has nobody watching.** Many candidates pasted in (`parseCandidates`), a paper drawn for each from rules like "5 hard multiple choice tagged sql" (`paper.ts`), a window to start in, self-start (`startAssessment`), handing in, and **Missed** for anyone who didn't start in time.
  - **Question kinds:** coding, multiple choice marked by the server (`markChoices`), short answers, and system design in the room's Diagrams and Board, which a person marks. Bank questions have a difficulty, tags and marks, and can be imported in bulk from a pasted spreadsheet or JSON (`parseQuestionImport`), all or none.
  - **The paper** is a snapshot on the sitting (`interviews.paper`), so edits to the bank don't change it. One coding question scheduled the old way still works as it did: its 111 checks kept passing throughout.
  - **The record** (`interview_events`): the candidate's page reports leaving the tab or full screen and pasting (`integrity-guard.tsx`). The server notices what the page can't hide: two tabs or devices taking turns, a different network (a hash, not the address), the page going quiet, and big edits from the edit log. `integrityLevel` sums it up for a person to weigh. Candidates are told all this first.
  - **Protection you can turn on:** ask for full screen; block pasting from outside and copying the questions. Both are in the browser, and said to be.
  - **Results:** a table per batch with scores by kind, the record and verdicts, a CSV safe from formula injection, and **Compare their code** (`similarity.ts`, MOSS-style fingerprints of the code's shape, in the browser from the edit logs), which finds copies with every name changed and ignores starter code.
  - **Recording assessments** (`interview-recordings.service.ts`, `recorder.ts`, `recording-gate.tsx`, `recordings-view.tsx`, migration `0013`): webcam and whole screen, no sound, turned on per assessment. The candidate has to agree before it can start, and checks their camera before the clock runs. Half-minute clips that each play alone, stored under the room in the object store. Only interviewers and admins can watch, each time audited, and they're deleted after `INTERVIEW_RECORDING_RETENTION_DAYS`. Stopping the share holds the test back; clips not arriving is noticed by the server.
  - **The AI's review** (`ai-review.ts`, `interview-ai-review.service.ts`, `ai-review-card.tsx`, `contact-sheet.ts`, migration `0014`): asked for by a person, in the room or afterwards. It reads the record, how the code came about, runs, answers and files, and suggests what to check and questions only the author could answer. With the candidate told beforehand, it also looks at contact sheets of stills for another person, a phone or other apps. It's kept apart from marks and the record, never sees a name or email, can't be steered by what the candidate wrote, and isn't asked to detect AI-written code or judge faces, because neither can be done fairly.
  - **Fixed on the way:** the selected button in the scorecard went unreadable while the pointer was on it.
  - **Tests:** `apps/api/src/interviews/paper.test.ts`, `views.test.ts`, `packages/contracts/src/interviews.test.ts`, `components/interviews/similarity.test.ts`, `report.test.ts`; `apps/collab/test/interview-papers.e2e.mjs` (112), `apps/web/test/interview-modes.e2e.mjs` (63), `apps/collab/test/interview-recording.e2e.mjs` (48), `apps/web/test/interview-recording.e2e.mjs` (44) and `apps/api/test/interview-ai-review.e2e.mjs` (39), all in CI.

Found by those tests and fixed:

- Hocuspocus's `closeConnections` detaches the document but leaves the socket open, so a candidate's editor would have gone silently stale. Revocation closes the socket.
- A scorecard stayed on "Save" after saving, because `jsonb` returns keys in its own order. The form compares values.

- ✅ **A scorecard for each interviewer** (ChatGPT's prompt 18, checked 2026-11-17). Each interviewer has their own, kept as a draft until they submit it; the last save no longer wins over someone else's.
  - **Blind until you've decided:** an interviewer sees their own always, and the others' (who, and when they submitted) only once they've submitted theirs; before that, only how many have. Organisation owners and admins who aren't interviewers on it see every submitted one and can't write one. The candidate never sees any (`views.ts`, `scorecardView`).
  - **Storage:** `interview_scorecards`, one row per interview and interviewer (unique on the pair, gone with the interview). Migration `0016` moved each old non-empty scorecard to a submitted row for the interview's creator, or its interviewer when there was no creator, and dropped the old column in the same migration.
  - **Pages:** the form says Draft or Submitted, saves drafts as before, and asks before submitting (`scorecard-form.tsx`); the others' appear read-only under yours (`scorecards-review.tsx`, `scorecards-panel.tsx`), on the interview's page and in the room's interview tool. The report and the batch results show each submitted scorecard, each criterion's average, the spread of recommendations, and who hasn't submitted (`report.ts`).
  - **Tests:** `views.test.ts` (who sees what, the candidate included) and `report.test.ts` (15: several scorecards, one, none); `apps/collab/test/interview-scorecards.e2e.mjs` (34 checks against the API: two drafts at the same moment both kept, blind before submitting, both seen after, an admin reading and refused writing, a candidate getting nothing, the old data's migration on throwaway rows); `apps/web/test/interview-scorecards.e2e.mjs` (20 checks: two people, a draft, submitting, the other's appearing, and the report). Checked: typecheck and lint clean, contracts' 243 tests and the API's 463 pass, and the interview tests from before still pass (78 and 112 in collab, 33 in the browser).

What's left is in `docs/pending.md` under step 11.

## 8. Teams and admin ⬜

- ✅ **Managing a room's people** (`apps/api/src/rooms/room-people.service.ts`, `room-people.controller.ts`; web `components/room/people/`, `share-menu.tsx`):
  - **Approving:** a room set to ask first used to strand people, as nothing could approve them. The owner sees who's waiting on the title bar's avatars and in People, with their email (names can be anything), chooses a role, and approves or declines. The waiting page opens the room by itself.
  - **Roles and removing:** the owner can change a member's role or remove them, and members can leave. The owner can't be changed, and interview rooms stay out of it.
  - **Removed stays removed:** a new `removed` status (migration `0010`) means the link they were given doesn't let them back. So does declining. The owner can let them back, which makes them a stranger again.
  - **The invite link:** Share used to copy only the room code, so the link was lost once the new-room dialog closed. The token is now made from the server's secret (`RoomsService.inviteTokenOf`), so anyone who may invite can copy it again, and the database still holds only its hash. **Make a new link** kills the old one, and the owner can also choose who can join there.
  - **Rights changing reaches what's open:** `RoomsService.accessChanged(roomId, userId)` closes that person's editor sockets only (collab), rechecks their chat listening, closes their terminals, language servers, debugger and hot reload (`realtime/live-sockets.ts`), and takes them out of the call on the server (`calls/calls.service.ts`, LiveKit's API). Their shells are killed too (`terminals/close` on the runner). Browsers read their role again on reconnecting, so the page changes without a reload.
  - **Calls:** join tokens now last 10 minutes rather than 6 hours. LiveKit checks them only on connecting and refreshes them for people connected, so a removed person can't come back with an old one for long.
  - **Fixed on the way:** an invite link to a public room never made you a member; someone watching a debug session kept watching after a room went private.
  - **Left as it is:** a program someone started to outlive its terminal (`nohup`, a daemon) keeps going until the sandbox restarts, as everyone in a sandbox is the same user. The confirmation says so. Secrets they could read aren't changed, and in a public room someone removed can still look, like anyone.
  - **Tests:** `apps/collab/test/room-people.e2e.mjs` (62), `apps/web/test/room-members.e2e.mjs` (32, including the server ending the call while the page ignores losing access), `apps/api/src/realtime/live-sockets.test.ts` (5), `apps/collab/src/extensions/revocation.test.ts` (3). Both end-to-end suites are in CI.
- ✅ **What GitHub's first end-to-end run found** (2026-11-06), all fixed, and the runs after it were green:
  - **A cut-off copy of a large file:** if a program was still writing a binary file when the watcher looked, the room kept a piece under the limit, and no later version could replace it once the file passed 5 MB. Now the copy leaves the room (`sandbox/agent/src/workspace.ts`, `tooLarge`, with `workspace.test.ts`).
  - **CI's unit tests:** a test still expected candidates to get AI help. Also, this Vitest no longer skips `dist/`, so the API's tests ran twice locally (`apps/api/vitest.config.ts`).
  - **The PDF viewer's frame:** already fixed when the run started.

- ✅ **Organisations** (ChatGPT's prompt 9, checked 2026-11-06): making a team (`/orgs/new`), the members page (`/settings/members`: roles, removing, leaving, inviting up to 20 at once, pending invitations with Copy link) and the invitation page (`/invite/<id>`, under `(auth)` so signed-out visitors can reach it). In `apps/web/components/settings/members/`, with the server's rules in `packages/auth/src/index.ts`: organisation hooks, and an adapter that locks the organisation's row so two owners can't demote each other at once.
  - Checking it found one bug, fixed: someone removed from a team, or whose team was deleted, kept it as their session's active organisation, so New room and Interviews refused them. `/api/me`, `RoomsService.create` and `InterviewsService.orgOf` now fall back to their personal workspace.
  - Tests: `apps/web/test/org-members.e2e.mjs` (51, the pages) and `org-rules.e2e.mjs` (74, the same rules tried directly against the API, on its own API with mail going to Mailpit), both in CI. An owner invitation accepted after its inviter was demoted is refused by `beforeAcceptInvitation`, read but not run: it needs a third account.
  - roles: owner, admin, member, guest
  - invitations, and auto-join by email domain
  - organisation templates and policies
- ✅ **Room roles:** owner, editor, runner, viewer, interviewer, candidate. One permission matrix drives all of them, and interview mode (§7) gives the last two their use.
- ✅ **Accessibility** (2026-11-07): `apps/web/test/a11y.e2e.mjs` runs axe's WCAG 2.2 AA rules on 93 screens: every kind of page, each room panel, tool and tab, in light and dark, and the main ones on a phone. It's in CI. Monaco, xterm and draw.io are other people's, so what's inside them is left out. No violations (97 of 97 checks, with three by keyboard).
  - **Open files:** only the active tab could take focus, and nothing moved it, so a keyboard couldn't reach the others. Arrow keys, Home and End now move between them, and Delete closes one. The tab's close control is for the mouse alone, because a tab can't hold another control. So are terminals' tabs.
  - **The bottom panel:** closed, it has no height but stays running, and keyboards and screen readers could land on what couldn't be seen. It's hidden while closed.
  - **Targets:** file tree rows and the like went from 22px to 24px (`--row-h`), and small buttons to 24px.
  - **Orange text:** `--brand` is 3:1 on white, too pale for small text. `text-brand-text` is the same orange, darker in the light theme. Icons keep the bright one.
  - **Smaller:** "No files yet" and the like moved outside the tree, the New terminal button outside the tab list, and text-only scrolling areas take focus.
- ✅ **Lighthouse on the marketing page** (2026-11-07), on the production image without a CDN. Performance, accessibility, best practices and SEO:
  - phone, really throttled (`--throttling-method=devtools`): 92, 100, 100, 100; desktop, simulated: 98, 100, 100, 100. Lighthouse's simulated phone run says 86 for performance: it charges all the page's JavaScript to the largest text, though that text is painted first.
  - How: the headline was typed by a script, so the largest text wasn't painted until it finished (5.3 s). On a phone, CSS now shows it from the first paint, with no typing; a desktop still types it. Only Mona Sans is preloaded, and its italic file is gone (100 KB, for the browser's slant). A heading level that was skipped is back.
- ✅ **Nightly backups** (ChatGPT's prompt 11, checked 2026-11-07): `infra/backup/`, a `backup` service in `infra/compose.yaml`, a CronJob in the Helm chart, and `docs/deploy.md`, "Backups". A checked `pg_dump` every night at 03:00 in `BACKUP_TZ`, with a checksum, optionally to S3 and verified there; 7 daily, 4 weekly and 6 monthly kept; `restore` into a new database by default; `last-success` and `last-failure` for alerts.
  - Tests: `infra/backup/test-backup.sh` (Docker only, cleans up after itself). Checked by hand on real data: a copy of the dev database (46 MB, 28 tables, 15 migrations) restored into a throwaway Postgres, every table's rows matching but for a session written during it. The scheduler runs once after 03:00, not again after a restart, and carries on when the database is down, recording why. No password in logs, arguments or the volume.
- ✅ **Settings pages** (ChatGPT's prompt 10, checked 2026-11-06): `/settings/account` has profile, password, two-factor sign-in (a secret and link to set up, on only once a code checks out, backup codes shown once) and where you're signed in, with Sign out for each device. `/two-factor` takes a backup code. In `apps/web/components/settings/account/`.
- ✅ **A two-factor code works once** (ChatGPT's prompt 19, checked 2026-11-17). Better Auth accepted the same authenticator code again for as long as it was valid (up to 90 seconds: its 30-second period, and one either side), so someone who saw it, with the password, could sign in too. Now an accepted code is refused a second time for that person, from any browser or sign-in attempt, with "That code has just been used. Wait for the next one."; another person's identical code is unaffected.
  - **How:** `packages/auth/src/totp-replay.ts`, hooked before and after Better Auth's `/two-factor/verify-totp`. Before the plugin checks the code, it's claimed in Valkey with one atomic `SET NX PX` for the whole time it could be valid (the plugin's own period, times three), so two requests with the same code at the same moment can't both get in, which checking first and writing after would allow. If the plugin then refuses it as wrong, the claim is undone, and only by the request that made it (compare and delete), so a wrong code never uses up the right one. The person is found the way the plugin finds them (the session, or the signed sign-in challenge), never from what's sent.
  - **Nothing secret kept:** the key is an HMAC of the person and the code, with the server's secret, so a six-digit code can't be guessed back from it. Valkey's errors aren't passed on, as they can hold commands or addresses.
  - **If Valkey is down,** two-factor sign-in is refused ("Try again shortly") rather than let codes be used twice; it was ChatGPT's choice and it's the safe one: Valkey down already stops sessions being kept.
  - **Tests:** `totp-replay.test.ts`, `totp-replay-identity.test.ts` and `totp-replay-plugin.test.ts` (32 in `packages/auth` with the others: once, another device refused, another person's same code accepted, a wrong code forgotten, two at once, the key holding no code, a whole validity span across a period's edge, other periods, a late refusal not deleting a newer claim, Valkey away or slow, and the real plugin with two browsers); `apps/web/test/two-factor-replay.e2e.mjs` (16 checks: a throwaway account sets two-factor up with a real code, two browsers, the second refused with the kinder message and given no session or trusted-device cookie, the next code working, and the account deleted). Checked: auth's typecheck is clean, its 32 tests pass, and the browser test passes against the dev API.
  - **Noted:** someone with a session and a half-finished sign-in to another account in the same browser is asked to sign in again when setting two-factor up, as the two can't both be trusted; rare, and safe.
- ✅ **Instance admin** (ChatGPT's prompt 20, checked 2026-11-18): `/admin`, for the server's own admins (Better Auth's admin role), linked from the user menu only for them. Everyone else, signed out included, gets a plain 404, from the page (`apps/web/proxy.ts` asks the API before the usual sign-in redirect, and refuses if it can't tell) and from every `api/admin` route (`InstanceAdminGuard` reads the role and any ban fresh from the database on each request).
  - **Users:** search, paged, with when they joined, a verified email, two-factor, their organisations and any ban. **Ban** (a reason and an optional end) and **unban**, which end their sessions at once and close what they had open; **sign out everywhere**; admin or not. Each asks first. An admin can't ban or demote themselves, and the last admin stays. No impersonation: it's a way into anyone's rooms and files that the audit log would have to make safe, so it's left out.
  - **Rooms:** every room, searchable by code or name, with its organisation, owner, kind, visibility, members, when it was last active, and its sandbox. Being an admin doesn't let anyone into a room: its page still needs membership, and the page says so.
  - **Health:** the database and Valkey, the runner's `/healthz` and driver, and what the runner's and collab's metrics say (sandboxes running, documents open, live connections): up, down, or couldn't tell, with when it was checked.
  - **Admins:** `pnpm seed` makes test1 one; on a real server, `pnpm --filter @codechatter/api admin:grant <email>` (and `admin:revoke`), each in the audit log, as is every change made on the page.
  - **Where:** `apps/api/src/admin/`, `apps/api/src/scripts/admin-grant.ts` and `admin-revoke.ts`, `packages/contracts/src/admin.ts`, web `app/(app)/admin/` and `components/admin/`, and `apps/web/proxy.ts` (approved for the 404).
  - **Checked:** the API's unit tests (10 for the admin rules) and typecheck; `apps/api/test/admin.e2e.mjs` (70 checks: an ordinary user's 404 from every route, lists and searches, a throwaway account banned, refused at sign-in, its open connections closed, unbanned, the self and last-admin rules, the audit log); `apps/web/test/admin.e2e.mjs` (27 checks: the three sections, searching, banning and unbanning, and an ordinary user seeing no link and a 404); `a11y.e2e.mjs` with `/admin`.
- ✅ **More than one owner in a room, and handing it over** (ChatGPT's prompt 17, checked 2026-11-08):
  - An owner can make an active member an owner (asking first, and saying what an owner can do), step down, leave, or remove another owner, **as long as the room keeps an active owner**. "Hand this room to…" makes someone an owner and the one handing over an editor in one transaction. Invite links and approvals still never give `owner` (`assignableRoles`); only `assignableMemberRoles`, for an active member, by an owner, does.
  - **The server enforces it:** every change to a room's people now happens inside a transaction that locks the room's row (`RoomsRepository.withPeopleLock`), and the last active owner can't be demoted, removed or leave (409), so two owners demoting each other at the same moment leave one. The old rule in `setMember` ("never an owner's row") is gone, replaced by that check. Rights changing still closes what the person had open, ends their shells and tells them; interview rooms are still refused.
  - **Checked:** the code against the brief; contracts' 243 tests and the API's 452 pass; typecheck and lint are clean. `room-people.e2e.mjs`'s three checks of the old one-owner rule were brought up to the new one.
  - **Tests:** `packages/contracts/src/permissions.test.ts`; `apps/collab/test/room-owners.e2e.mjs` (70 checks, against the API: promoting, two owners, demoting each other, the last owner refused, two demotions at the same moment, handing over and back, invite links and approvals never giving owner, the audit log, notifications, an interview room refused); `apps/web/test/room-owners.e2e.mjs` (19, in a browser); `room-people.e2e.mjs` (62) and `room-members.e2e.mjs` (32) still pass.
- ✅ **Preferences** (ChatGPT's prompt 16, checked 2026-11-08): `/settings/preferences`, linked from Settings, in `apps/web/components/settings/preferences/`.
  - **Appearance:** Light, Dark or Match my device, each with a small preview, applied at once; and the editor's own settings (theme, font size, tabs, line numbers, whitespace, cursor, key bindings and the switches), through the same store and save as the editor in a room, so a change reaches an open room.
  - **Notifications:** the email digest, saved as it's switched, and put back with a plain message if saving fails.
  - **Connected accounts:** Password, and Google and GitHub only where the server has them, each connected or not. Connect goes to the provider and back here, saying what happened, including another email being refused. Disconnect asks first, and isn't offered for the last way to sign in.
  - **The server refuses the last one too** (`packages/auth/src/index.ts`): Better Auth only checks that more than one account row is left, which counts a provider the server no longer offers and an account with no password. Removing an account now locks the person's row and counts only the ways they can really sign in, so two requests at once can't both pass. Deleting a whole user goes through `deleteMany`, which this doesn't touch.
  - **Checked:** the code against the brief and the installed Better Auth (1.7.16); `listAccounts` returns no tokens or password; lint and typecheck are clean; the auth package's 11 tests pass.
  - **Not proven:** real Connect with Google or GitHub and its return, as real OAuth can't run in a test. The test stands in for the provider's answers.
  - **Tests:** `apps/web/test/preferences.e2e.mjs` (35 checks: the theme at once and after a reload, the editor's settings through their own save, the digest, a failed save put back, a stale refresh that can't undo a save, only the providers the server has, no Disconnect on the only password, a direct request refused, Connect's returns stood in for, and everything put back), and `a11y.e2e.mjs` includes the page.
  - Tests: `apps/web/test/account-security.e2e.mjs` (32, on a throwaway account). Checked by hand against its own API, 42 checks: a password alone gives no session, and can't turn it off, make codes or change the password; guessing is cut off after about 10 codes or 3 backup codes; secret and backup codes aren't readable in the database; someone else can't see or end your sessions.
  - What checking found: a code can be reused until it expires (in `docs/pending.md`), and an open room stayed connected after its device was signed out, which is fixed:
    - Any session ending (signing out, Sign out on another device, a changed password) publishes its id on Valkey (`SESSION_ENDED_CHANNEL`, from a Better Auth `session.delete` hook in `packages/auth/src/index.ts`). Collab (`revocation.ts`), Socket.IO (`events.gateway.ts`) and terminals, language servers and the debugger (`live-sockets.ts`) close what's connected on that session, and the person's other devices aren't touched.
    - The session cookie cache is off, because a cached session kept working for up to 60 seconds after being signed out, and would have let a closed socket straight back in. Each request now reads the session from Valkey.
    - The room page stops reconnecting once it's refused.
    - Tests: `apps/web/test/sign-out-device.e2e.mjs` (12), in CI, and unit tests for both closers.
  - profile
  - security: 2FA, active sessions
  - appearance, editor, notifications, connected accounts
- ✅ **Audit log:** filters and CSV export. Written by ChatGPT:
  - **The page:** `/settings/audit` (linked from Settings) shows the organisation's events, newest first. It filters by action, person, room code and dates, and pages with Load more. Download CSV gets up to 10,000 events with the same filters.
  - **Who can see it:** only the organisation's owners and admins; anyone else gets 403.
  - **CSV safety:** a cell that starts with `= + - @` is defused, so a spreadsheet won't run it as a formula, and the file starts with a BOM so Excel reads it as UTF-8.
  - **Code:** `apps/api/src/audit/audit.controller.ts`, `audit-csv.ts`, contracts `audit.ts`, `components/settings/audit-log.tsx`.
  - **Tests:**
    - unit `audit-csv.test.ts`;
    - API e2e `audit.e2e.mjs` 38/38: access, every filter, paging, the CSV, and 13 invalid queries;
    - the page checked in a browser, light and dark and at phone width, where the table scrolls inside its frame.
- ⬜ **Usage dashboard:** runs, AI tokens, sandbox minutes, with quotas.
- ⬜ **Instance admin:** users, rooms, health.

## 9. Automations and platform ⬜

- ⬜ **Workflow builder** (n8n-style canvas):
  - triggers: file saved, run finished, chat message, schedule, webhook, GitHub push
  - actions: run tests, AI agent, post to chat, email, Slack/Discord, HTTP request, checkpoint, GitHub PR
  - logic: conditions and delays
  - run history and retries
- ✅ **Outgoing webhooks:** signed with HMAC, with retries and a delivery log. Written by ChatGPT:
  - **Where they're managed:** `/settings/webhooks`, by an organisation's owners and admins.
    - Add a receiver URL, choose events (or Everything), and its secret is shown once.
    - Each webhook can send a test ping, rotate its secret, pause, or be deleted.
    - Its delivery log shows each attempt with the status, response and next try, plus Redeliver.
  - **What goes out:** every audit event of the organisation is queued after its audit row is written. A worker sends it every 5 seconds as a signed POST:
    - `X-CodeChatter-Signature` is `sha256=` followed by the HMAC of `timestamp.body`;
    - the other headers are `X-CodeChatter-Event`, `-Delivery` and `-Timestamp`.
  - **Retries:** after 1 minute, 5, 30, then 2 and 6 hours; after six attempts it's marked failed. Instances lock rows with `skip locked`, so two API copies never send the same delivery.
  - **Safety:**
    - URLs are checked against private addresses when saved and before every delivery, and the connection goes to the address that was checked; production requires https.
    - Secrets are stored encrypted (token-box).
    - `WEBHOOKS_ALLOW_PRIVATE=1` (development only) lets a test API send to 127.0.0.1, and only that process ever delivers those test webhooks.
  - **Database:** migration `0007` adds `webhooks` and `webhook_deliveries`.
  - **Docs:** `docs/webhooks.md`, for people writing a receiver, with how to verify the signature.
  - **Fixed here:** a webhook that couldn't be queued was logged as "audit write failed"; it now has its own message, and the audit row stays recorded.
  - **Follow-ups, written by ChatGPT and checked 2026-11-06:**
    - **A lease:** the worker claims up to 20 deliveries in a short transaction (60 seconds, `locked_by` and `locked_until`, migration `0009`), sends them together outside any transaction (10 seconds each at most), and records each one on its own. One failed update no longer sends the whole batch again.
    - **Retention:** delivered and failed deliveries go after `WEBHOOK_DELIVERY_RETENTION_DAYS` (30), at most hourly, 1,000 at a time.
    - **Expiry:** when a webhook is resumed, deliveries left pending for over 24 hours fail with "Expired while the webhook was paused", shown in the log.
    - **Audit CSV:** streamed up to 100,000 rows. The file says so when it stops there, or fails partway.
    - **Audit filters:** the five labels line up (measured at desktop, tablet and phone widths).
    - **Load test:** `WORKERS` forks the load across processes. The default 50 rooms × 10 people passes: 500/500 connections, p95 54 ms, every update delivered. A worker killed mid-run fails the report and leaves no rooms behind.
  - **Tests:**
    - unit tests for the signature and the service;
    - `apps/api/test/webhooks-out.e2e.mjs` 48/48, with its own API on :4013 and its own receiver, and `apps/api/test/audit.e2e.mjs` 42/42;
    - the page checked in a browser.
- ⬜ **Public API** with personal access tokens, and a `cc` CLI that syncs a folder with a room.
- ⬜ **CodeChatter MCP server:** Claude Code, Claude Desktop and Cursor can open rooms, read and edit files, and run code.
- ✅ **Dependency alerts (OSV)**, written by ChatGPT: the **Dependencies** side tool.
  - **Reading:** it reads the room's manifests in the browser (`parseManifests` in contracts):
    - npm: `package-lock.json`, `pnpm-lock.yaml`, `package.json`;
    - PyPI: `requirements*.txt`, `poetry.lock`;
    - also `go.mod`, `Cargo.lock`, `composer.lock` and `pom.xml`.

    Lock files are preferred over manifests, and `node_modules`, `vendor`, `.venv` and `target` are skipped.
  - **Checking:** it asks the API (`POST /rooms/:id/dependencies/check`, room view), which queries OSV's batch API, then each advisory's details.
    - Answers are validated, and redirects refused, with a 15-second timeout.
    - Caches are bounded, for 6 hours; identical requests running at once are merged.
    - At most 2 batch and 8 detail requests go out at once, across all rooms; withdrawn advisories are dropped.
  - **Severity:** GitHub's rating when there is one, else computed from the CVSS v3 vector by a local calculator, with FIRST's rounding.
  - **The fix:** the lowest fixed version, for that ecosystem's versioning (`versions.ts`).
  - **The panel:**
    - a summary line;
    - groups by severity, critical first;
    - each package's file and line (click to open it);
    - links to osv.dev;
    - "Not checked (no exact version)";
    - Copy as Markdown.

    It checks when opened and again 10 seconds after a manifest changes.
  - **Tests:**
    - contracts 121/121 (with `parseManifests`) and API 540/540 (CVSS, versions, the service);
    - browser `dependencies.e2e.mjs` 12/12 against the real OSV (lodash 4.17.20's advisories; needs the internet).
  - **Fixed here:**
    - the side panel's tab row overflowed with six tools, cutting off Dependencies; it now scrolls sideways and keeps the chosen tab in view;
    - the manifest path broke mid-word; it now wraps after a slash.
  - **Next:**
    - nothing yet shows that the tab row scrolls (a fade at the edge);
    - no per-person rate limit on checks (the cache does most of the work).
- ⬜ **`devcontainer.json` support.**

## 10. Hardening and launch ⬜

- ✅ **Browser security** (`docs/adr/0010-content-security-policy.md`):
  - **Security policy:** every page has a nonce for that response (`lib/csp.ts`, `proxy.ts`). Injected scripts, handlers and `javascript:` links don't run, and production has no `eval`.
  - **HTML preview:** runs in `/frames/document`, with a policy of its own and an opaque origin however it's reached. Dev servers already had their own origin.
  - **Every browser suite** now fails on anything the policy refuses (`test/browser.mjs`).
  - **Access ends when it should:** when a public room goes private or a room is deleted, `RoomsService.accessChanged` closes the room's editor sockets, and the gateway rechecks who hears its chat and runs. The page says "You no longer have access" instead of showing a frozen room.
  - **Deleted rooms stay deleted:** the last connection closing used to write the document back to Postgres. Now it keeps nothing (`persistence.ts`).
  - Tests: `lib/csp.test.ts` (8), `test/csp.e2e.mjs`, `apps/collab/test/collab.e2e.mjs` (24), `test/public-rooms.e2e.mjs`.
- ⬜ **Sandbox security:** gVisor runtime.
- 🟡 **Operations:** OpenTelemetry traces, Prometheus metrics, dashboards, and nightly backups.
  - ✅ **Metrics and dashboards** (2026-11-06), written by ChatGPT. `docs/metrics.md` covers them.
    - **What's measured:**
      - API: requests and latency by route pattern, Socket.IO connections, chat messages (`apps/api/src/metrics`);
      - collab: connections, documents, updates, bytes, store time (`extensions/metrics.ts`);
      - runner: Runs by language and outcome, run time, sandboxes, terminals (`metrics.ts`);
      - Node's own numbers for all three.
    - **Private:**
      - `/metrics` is on each service's own port, outside the auth guard, with its own check.
      - Anything that came through a proxy is refused (any `X-Forwarded-*` header).
      - The token is compared in constant time. Without one, development allows loopback only, and production refuses everything.
      - Labels hold route patterns and languages, never room codes, paths or emails.
    - **To see it:** `docker compose -f infra/compose.metrics.yaml up -d` starts Prometheus (:9090) and Grafana (:3300), both on this machine only, with the dashboard and 3 alert rules (5xx rate, collab store p95, Run failure rate).
    - **Checked here:**
      - typechecks and tests (API 554, runner 61);
      - `promtool` on the rules and their unit tests;
      - all 3 targets up in Prometheus, with real data;
      - every dashboard panel has data;
      - 401 without the token, and nothing through Caddy even with it;
      - no room codes or emails in labels.
    - **Fixed here:**
      - the two ratio panels' axes ran to 10000%, so they're now fixed at 0–100%;
      - production Compose didn't pass `METRICS_TOKEN` to the services.
    - **Installing `prom-client`** made pnpm keep two copies of drizzle (it brings in `@opentelemetry/api`, drizzle's optional peer), giving 315 + 65 type errors. `@opentelemetry/api` at the workspace root fixed it.
    - ⬜ **Next:**
      - `prom-client` was deprecated in August 2026 for `@prometheus-io/client`;
      - `METRICS_TOKEN` and scraping in the Helm chart;
      - collab's store p95 reached 2.3 s during the end-to-end suites on this laptop, so it's worth watching on a real server.
  - 🟡 **Nightly backups** with a restore drill: handed to ChatGPT (`docs/handoff/chatgpt-11-backups.md`).
  - ⬜ **OpenTelemetry traces.**
- ✅ **Load test:** 50 rooms × 10 people, with 95% of updates delivered in under 150 ms. Written by ChatGPT. It's `apps/collab/test/load.mjs`, a Node script with the real Hocuspocus client, because k6 can't speak Yjs.
  - **What it does:**
    - It makes its own rooms (never E2ETST or TEAM22).
    - It connects the people gradually, then each one writes about 2 edits a second.
    - It measures how long each edit takes to reach the others, and counts any lost updates.
    - It deletes its rooms afterwards, also on failure or Ctrl+C.
  - It also measures its own event-loop lag and warns when the client, not the server, is the limit. `docs/load-testing.md` covers running it, including from several machines.
  - **Results on the dev stack (2026-11-05):**
    - In one process it fails at p95 228 ms, but that process's own lag is 70 ms, so it's measuring the client.
    - The same 500 connections split over five processes **pass**: p95 132–134 ms, all 538,227 updates delivered, no connections failed. The doc now shows how to split it.
- ⬜ **Accessibility:** an axe audit with zero violations. Lighthouse score of 90+ on marketing pages.
- 🟡 **GitHub Actions CI:** lint, types, tests, e2e, image build, vulnerability scan. Written by ChatGPT: `.github/workflows/ci.yml`, `sandbox-full.yml` (a manual build of the full sandbox image), `docs/ci.md` and `.trivyignore`. Checked here before the first push:
  - every action version it names exists;
  - `pnpm lint`, `pnpm typecheck` (15 tasks) and `pnpm test` (sandbox-agent 14, workspace-model 27, contracts 93, runner 57, auth 6, API 426) pass, as do the web's 200 and collab's 5 `node:test` tests;
  - all 7 migrations apply to an empty Postgres 18, and a second run changes nothing.

  - **Dependencies updated (2026-11-04)** so the security job passes: better-auth 1.7.16, Next 16.4.5 (two critical remote-code-execution fixes need 16.4.1 or later) and zod 4.6.7. `pnpm-workspace.yaml` overrides fix body-parser, multer, dompurify, undici, sharp and source-map-js within their majors. `pnpm audit --prod --audit-level=high` now finds no high or critical advisories (3 low and 10 moderate remain).
  - **Next 16.4** refuses the Monaco VS Code packages' `import * as css from "./x.css"`. A Turbopack rule (`next.config.ts`) sends their CSS through `scripts/monaco-css-loader.cjs`, which default-exports the text their `registerCss()` injects, with url()s (the icon font) kept as real assets. The editor test still passes 16/16.

  - **First run on GitHub (2026-11-04) failed.** It's fixed here, waiting for the next push:
    - **checks:** the committed `next.config.ts` had `turbopack:` twice, and TypeScript refuses a repeated key. The file now has one, the CSS-loader rule.
    - **security:** Trivy found old Next and DOMPurify only in `spikes/s1-editor` and `spikes/s1b-next`, the throwaway experiments with their own lockfiles. `spikes` is now skipped, as `client` and `server` are. Trivy 0.70.0 (the action's version) over the committed files then passes, with no secrets found.
    - **Node 20 warnings:** checkout, setup-node and pnpm/action-setup moved to `@v5`, which run on Node 24.
    - **images** hadn't run yet (it waits for checks). The web image builds here as CI builds it (`next build` compiles in 42 s), and that build stage also makes the api, collab and runner outputs.

  - **Green on GitHub** since `47b3e71` (2026-11-05).
  - **End-to-end tests in CI** (2026-11-06): `.github/workflows/e2e.yml`, apart from CI so a flaky run can't hold it up. `docs/ci.md` covers it.
    - It starts the dev infrastructure on one runner, builds the sandbox's base image (sharing a cache with the `images` job), migrates and seeds, starts the dev servers, compiles the pages the tests open, and runs `scripts/e2e-ci.mjs`.
    - **42 suites:** 20 for the runner, collab and the API, and 22 in the browser. They need neither the full image, nor a paid AI key, nor real GitHub. 39 of them passed together on GitHub on 2026-11-06, in 15 minutes, with `new-room` needing its one retry. The 3 for recording and the AI's review have only passed here so far.
    - **Failures** become annotations on the run, with a table on its page; logs and screenshots are kept as artifacts.
    - **Found on the way:**
      - suites run back to back trip the 10-a-minute sign-in limit, so the script clears only those counters in the dev Valkey before each suite (the limit itself stays, and `auth-flow.e2e.mjs` checks it);
      - the browser tests load Playwright from `spikes/s1-editor`, which the root install doesn't install, so the workflow installs it;
      - `isolation.e2e.mjs` flagged the read-only template cache (`cc-dev-warm`), and now allows it;
      - `apps/collab/test/collab.e2e.mjs` started in the first spike and expected files E2ETST no longer has. It now makes its own disposable rooms, and it's in the list: 15 checks, including the only ones for a foreign site's connection, a signed-out visitor, and edits surviving everyone leaving.

  Still to do:
  - the workflow's first run on GitHub.
- ⬜ **Cutover from v1:** move the data from MongoDB, then delete `client/` and `server/`.
- ⬜ **Security review:** a final pass over everything above.

## 11. Advanced features ⬜

### The lakehouse ✅

**What:** the open-source tools Databricks is built on, in the room: **Apache Spark** to process data, **Delta Lake** for tables with versions, and **MLflow** to track experiments. Databricks itself is a paid cloud service that can't run in a room. This is its way of working, not its product: there are no clusters, jobs or Unity Catalog, and Spark runs on one machine.

- **In notebooks and scripts:** `from lakehouse import session` (`sandbox/image/lakehouse.py`) gives a Spark session set up for a sandbox: its heap fits the room's memory, it listens only on this machine, and Delta Lake is on. A room under 650 MB is told what to change. Tables and MLflow runs stay in the room's home (`~/lakehouse`), so they outlive the sandbox, and big files don't sync into everyone's editor. Spark keeps its list of tables in memory, so each new session lists them again from disk.
- **The tool (`tools/lakehouse/lakehouse-tool.tsx`, `POST /api/rooms/:id/lakehouse`):**
  - **Tables:** rows, columns, size, and every version with what made it. Any version opens, which is Delta Lake's time travel, and a preview can go to Explain this data.
  - **Experiments:** MLflow's runs side by side, with whatever settings and results any of them logged.
  - **It doesn't start Spark,** which takes most of a minute on one CPU. `sandbox/image/lakehouse_info.py` reads tables with DuckDB's Delta extension, each history from the table's own commit log, and runs through MLflow's client, in about a second.
  - **"Open an example notebook"** goes from messy data to clean tables (bronze, silver, gold), changes one and reads the old version, and logs runs.
- **The image:** the full image only, as Spark needs Java: pinned by hash (`sandbox/image/lakehouse-requirements.txt`), in a folder Python looks in last so it can't change what the room's Python imports, with Delta Lake's jars checked by SHA-256 so nothing downloads at run time. It adds about 1.2 GB. A room on the base image is told to choose the full one.
- **Limits, measured:** at 768 MB and one CPU, Spark and Delta Lake peaked at 699 MB of 768 in a throwaway container, which is tight beside a notebook kernel. The default `SANDBOX_MEMORY_MB` is 768, and it's 2048 on this machine, where the example notebook takes about a minute. On one CPU Spark is slow, and it's for learning and small data, not big jobs.
- **Who may:** needs `code.run`, and isn't for interview rooms. A table's name has to be a folder directly in the warehouse.
- **Found by testing it twice in a row, and fixed:**
  - **Deleting a notebook left its kernel running,** and with Spark in it, that held 600 MB until the sandbox stopped. The next notebook's Spark was killed for lack of memory, which looked like a notebook that's stuck. Kernels now stop when their file is deleted, or a folder holding it is (`notebooks.ts`, tested in `notebooks.e2e.mjs`).
  - **A room short of memory now gets a reason:** `session()` checks what's free, says what to stop, and sizes its heap to fit.
  - **A write killed before its first commit** left a folder that stopped Spark starting in that room at all. It's now skipped, and the tool says what's wrong with it.
  - **The tool looks again each time it opens,** as a notebook changes things while it's closed.

**Not included:** a connection to a real Databricks workspace (in `docs/pending.md`), MLflow's own web page (`mlflow-skinny` doesn't have one), and tables going with a room when it's forked, as they're in its home and not its files.

**Tests:**
- `packages/contracts/src/lakehouse.test.ts`
- `apps/runner/test/lakehouse.e2e.mjs` (32 checks on the full image, inside the jail with no network: Spark, changes, an old version, a new session finding a table, MLflow; what the tool reads; names trying to leave the warehouse; nothing landing in the room's files)
- `apps/web/test/lakehouse.e2e.mjs` (24 checks in a browser, with the real example notebook and only one failure stood in for: the numbers at the old version are checked)
- `a11y.e2e.mjs` includes the tool with a table and runs

### The Flow: datasets and recipes on a chart ✅

**What:** a Flow tool that shows a room's data as Dataiku does: datasets as boxes and the recipes that make them as circles, joined by arrows, with what ran, warned and failed lit up on it. It's the owner's "Dataiku jaisa", without being a copy of Dataiku, a paid product: underneath it's a real **dbt project** in the room's files, which **dbt Core** reads and builds on **DuckDB** in the sandbox. So a project made here runs anywhere dbt does, and `dbt build` works in the room's terminal, and the tool sees what it did.

**What it does:**
- **The chart:** comes from dbt's own manifest, laid out by dagre, drawn by React Flow, in `components/flowchart/flowchart.tsx`, which Pipelines and Automations are to use too. Each thing on it is a real button, which says what it is, how it went and what it's made from to a screen reader.
- **Building:** everything, or one dataset with what it's made from, or with what's made from it. It carries on if the tool closes, shows each step as it happens to anyone who has the tool open, and can be stopped.
- **A dataset:** its rows (with Explain this data), a profile from DuckDB (empty values, distinct values, range, average, commonest values), and its checks.
- **Checks, for data quality:** dbt's own tests. Those in YAML are shown in plain words, and new ones are made from the screen, each as one SQL file in `tests/`. A file can't clash with what a project's YAML already says about a dataset, which dbt refuses, and removing it is deleting it. A check that fails holds back what's made after it, a warning doesn't, and the rows that broke it can be read.
- **Recipes:** filter, group and join, chosen from the data's real columns, or blank SQL or Python. Each is a file written as anyone would write it, and the tool opens the code of any recipe. A CSV of up to 2 MB can be added as data.
- **AutoML:** "predict a column" is a Python recipe using **FLAML**: choose the column, what to learn from and how long to try, and it tries LightGBM, XGBoost, random forests and extra trees and keeps the best. It holds back a quarter of the rows, says how it did on those in the build's log, and makes a dataset of every row with its prediction and whether it was held back. On the full image the run goes to MLflow, so it shows in the Lakehouse tool's Experiments.
- **What's out of date:** a dataset whose recipe has changed since it was built, and whatever's made from it.
- **Earlier builds:** the last 20, with what dbt said.
- **An example project** in `orders-flow/`, with one check that warns on purpose.

**Where:**
- **Sandbox:** `sandbox/image/flow.py` (read, build, stop, data), `sandbox/image/dbt` (dbt for the room: what it makes goes in `~/flow` rather than the room's files, and it has no telemetry or version check), `sandbox/image/flow-profiles.yml`, `sandbox/image/flow-requirements.txt` (pinned by hash), a `flow` stage in the Dockerfile, in both images. `sandbox/image/automl-requirements.txt` and an `automl` stage for FLAML and its neighbours, in a folder Python looks in last, so whatever a room installs comes first.
- **Runner and API:** `apps/runner/src/flow.ts`, `POST /rooms/:id/flow`, `POST /api/rooms/:id/flow`; `packages/contracts/src/flow.ts`.
- **Web:** `components/flowchart/flowchart.tsx`, `tools/flow/` (`flow-tool.tsx`, `dataset-panel.tsx`, `new-recipe.tsx`, `model.ts`, `example.ts`), and `tools/data-rows.tsx`, the rows the Lakehouse tool now shares.

**How a build runs:** `flow.py` starts a copy of itself in its own session and returns. That copy runs dbt with its log as JSON, and keeps `~/flow/live.json` up to date, which is what `status` reads, so it's cheap to ask and every viewer sees the same thing. It's asked to stop by a file, as the one asking runs in a jail of its own and can't signal it. A build whose sandbox went away is noticed by its heartbeat going quiet. The tool asks every second while something's building and every 8 seconds otherwise; asking doesn't wake a sleeping room or keep it awake, but a build going on does.

**What was checked, and decided:**
- **Licences:** dbt Core, dbt-duckdb and what they bring, 57 packages in all, are Apache-2.0, MIT, BSD or similar; React Flow and dagre are MIT. elkjs, the other layout library, is EPL or GPL, so it isn't used. FLAML, scikit-learn, LightGBM and XGBoost are MIT, BSD or Apache-2.0.
- **Size:** 180 MB on the images for dbt. `dbt-core-experimental-parser`, a 170 MB program for a parser that's off unless asked for, is left out of the list. 85 MB for AutoML, as it uses the numpy, scipy and pandas the images already have, and XGBoost's CPU build. The dev image is now 3.74 GB and the full one 10.8 GB.
- **Limits, measured:** dbt peaks at about 230 MB, inside a 768 MB sandbox and the jail with no network, and a small project builds in about 5 seconds and is read in about 4 on one CPU. AutoML peaked at about 200 MB training on 2,000 rows. The Flow and AutoML are on the default image, so rooms don't need the full one.
- **dbt v2** is what dbt now suggests for new installs. This stays on dbt Core 1.12: no DuckDB adapter for v2 could be confirmed, and Python recipes need dbt-duckdb (`docs/pending.md`).

**Who may:** needs `code.run` to look and build, as dbt runs the room's code, and `files.edit` to make recipes and checks. Not for interview rooms. A dataset's name, which goes to dbt, can't be a flag or a selector, and has to be one dbt knows before it's read, on a read-only connection.

**Found by using it, and fixed:**
- **All the boxes in one place:** dagre writes each position onto the object it's given, and they shared one.
- **Clicks that did nothing:** React Flow turns clicks off on a node that can't be selected or dragged, and each one's button is how it's selected.
- **"A build is already running" just after one finished:** a build says it's over a moment before it lets go. Building now waits for that moment.
- **A check's form with no column chosen,** when the columns came after it opened.

**Not included:** using a trained model on new rows (in `docs/pending.md`), `dbt deps`, as rooms have no internet for dbt's package hub, and more than one project on a chart: a room with several shows the one nearest the top, and says so. Not tried on the Kubernetes driver, though it uses the same sandbox calls as the rest.

**Tests:**
- `packages/contracts/src/flow.test.ts`, `apps/web/components/room/tools/flow/model.test.ts` (28)
- `apps/runner/test/flow.e2e.mjs` (84 checks on real dbt, DuckDB and FLAML, against numbers worked out in the test: the graph, a build, a Python recipe with pandas, a profile, kept rows, partial builds, what's out of date, recipes that fail, a check holding things back, a build from a terminal, stopping, a build that went away, a project dbt can't read, a recipe that learns a rule, and what a request can't do)
- `apps/web/test/flow.e2e.mjs` (81 checks in a browser with real dbt, two people watching a build, an AutoML recipe made from the form, trained, and checked on rows it never saw and in MLflow, and two failures stood in for)
- `a11y.e2e.mjs` includes the chart, a dataset's rows, profile and checks, a failed recipe, a new one and an AutoML one

### The Research layout: a paper, its PDF and its references ✅

**What:** the owner's "researchers ke liye alag layout". A **Research** layout and a **Research paper** template: the paper in the editor, its real PDF beside it, its references in the side panel, with the notebooks and data it uses a click away. It looks like Overleaf, and two people can write the same paper at once.

**What it does:**
- **The layout** is each person's own, switched in the status bar or the command palette, and remembered for the room. It shows the apps research uses (Docs, Databases, Flow, Lakehouse, Diagrams, Whiteboard) and puts debugging out of the way. Nothing is taken away: the palette still has every tool. A room from the research template starts in it. Arriving at it opens the files, the references and the paper with its PDF, once; after that the room is the person's to arrange.
- **LaTeX** is real TeX Live with `latexmk` and `biber`, in the sandbox's jail with no network, with TikZ, siunitx and journals' classes such as IEEE's and ACM's. Any `.tex` file offers its PDF, in any layout.
  - **Which file to build:** `% !TEX root = ../main.tex` says, as other editors read it; a file with a `\documentclass` is its own paper; otherwise the nearest one that has one (`paper/model.ts`).
  - **Mistakes** come back by file and line, with the line itself, the real error first and what follows from it left out. Pressing one goes there. The last good PDF stays while it's being fixed.
  - **Build as I type** builds after a pause in a person's own typing. Everyone in the room sees the same PDF, within 5 seconds of anyone building it.
  - What a build makes goes in `~/paper`, not the room's files.
- **In the editor:** colours for LaTeX and BibTeX, which Monaco doesn't have, word wrap for LaTeX, and `\cite{` completing from the room's `.bib` files, with who wrote it and when.
- **The References tool:** what's in the room's `.bib` files, as it would read in print, searchable. **Cite** puts `\cite{key}` where the cursor is, or copies it when no paper's open. **Add by DOI or arXiv id** fetches the real BibTeX, gives it a key nothing else has, and says if it's already there by its DOI, however the DOI is written. It shows in the Research layout, or in any room with a `.bib` file.
- **The template:** `paper/main.tex`, `paper/references.bib`, `analysis/analysis.ipynb` (reads the data, fits a line, saves the figure) and `data/measurements.csv`. The paper says to run the notebook until the figure exists, then uses it.

**Where:**
- **Sandbox:** `sandbox/image/latex_build.py`, TeX Live in the full image's Dockerfile, and `cc-jail.c` lets the jail read `/var/lib/texmf`, where Debian keeps TeX's prebuilt formats.
- **Runner and API:** `apps/runner/src/latex.ts`, `POST /api/rooms/:id/latex`; `apps/api/src/references/`, `POST /api/rooms/:id/references/lookup`; `packages/contracts/src/latex.ts`.
- **Web:** `components/room/room-layout.ts`, `components/room/paper/` (`paper-pane.tsx`, `model.ts`), `components/room/editor/latex-language.ts`, `components/room/tools/references/` (`references-tool.tsx`, `bibtex.ts`), and the template in `packages/workspace-model/src/templates.ts`.

**What was checked, and decided:**
- **Only in the full image:** TeX Live adds about a gigabyte, and the default image is under 4 GB. A room from the research template asks for the full image where a server offers both, and a `.tex` file in a room on the base image says where LaTeX is.
- **Limits, measured:** a paper with a bibliography builds in about 5 seconds the first time and under 1 after, peaking at 107 MB, in a 768 MB sandbox on one CPU. A build stops after 100 seconds.
- **The BibTeX reader is our own and small.** LaTeX and biber do the real work; this only shows entries, and can't throw or hang on a half-typed file. A library would have been a new package for little.
- **Who may:** building needs `code.run`, as it runs the room's files. Reading the result needs only `room.view`, and doesn't wake a sleeping room. A lookup needs `files.edit`, is limited to 30 a minute, and only a checked DOI or arXiv id reaches a request, sent only to known hosts, however it's redirected. Not for interview rooms. Shell escape stays off: `\write18` does nothing.
- **Tried for real:** Crossref through doi.org and arXiv, old and new ids, and ones that don't exist.

**Found by using it, and fixed:**
- **Chapters in folders failed:** `\include{chapters/one}` writes `chapters/one.aux` beside what's made, and TeX won't make that folder. Each build mirrors the paper's folders first.
- **A build could miss what was just typed,** as it only waited for the runner to have it, not the sandbox. It now waits for both.
- **A missing package's real error came last,** after "Emergency stop". It now comes first, with those left out.

**Not included:** going from a place in the PDF to its line, other engines such as XeLaTeX, and choosing a citation style from a list (it's a line in the paper): in `docs/pending.md`.

**Tests:**
- `packages/contracts/src/latex.test.ts`, `apps/api/src/references/references.service.test.ts` (7), `apps/web/components/room/paper/model.test.ts` and `tools/references/bibtex.test.ts` (24)
- `apps/runner/test/latex.e2e.mjs` (41 checks with `SLOW=1`, on real TeX Live: a paper with chapters, biber, TikZ and siunitx, a real PDF, nothing in the room's files, what's just been typed, a typo, a missing package, a broken `.bib`, two at once, a journal's class, shell escape, a build that never ends, and what a request can't do)
- `apps/web/test/research.e2e.mjs` (51 checks in a browser: the template, the layout, a real build, a mistake and going to it, as I type, citing, `\cite` completion, adding by DOI with the lookup stood in for, the notebook's figure in the paper, two people, and the code layout)
- `a11y.e2e.mjs` includes the layout with a paper's problems, what LaTeX said and the References tool

### Automations, part one: Activepieces' engine in the sandbox, and the chart ✅ (2026-11-08)

**What:** the owner's "n8n jaisa" automations, with nothing paid. A flow is a file in the room (`automations/<name>.flow.json`, in Activepieces' own format), drawn as a chart of boxes and arrows. Running it runs Activepieces' real engine and pieces (MIT) inside the room's sandbox, and the chart lights up step by step: what ran, which branch was taken, what failed, and what each step took in and gave out.

**Why it's built this way** (the long version is in `docs/pending.md`): n8n's licence allows only internal, personal or non-commercial use; Activepieces' builder embed is enterprise-only, and its free server refuses a second project, so rooms couldn't be kept apart. Its engine runs alone, though, with a small host of ours standing in for its server. Each room's runs stay in that room's sandbox, inside the jail, with no network.

**What it does:**
- **The chart** is the shared flowchart (`components/flowchart`): triggers, code, pieces, routers with their branches and loops with what's inside, each box with its kind and, after a run, how it went and how many times. Selecting a box shows its fields, made from what its piece says it needs, with dropdowns for its choices, and what it took in and gave out on the run being looked at.
- **Editing:** renaming, changing code or fields, the router's tests, "if it fails" (try again, carry on), adding a step after any step, inside a loop or in a router's branch (code, a router, a loop, or any action of any piece), and removing one. It's the room's file, so everyone edits it together, live, and the History, git and search all see it.
- **Running:** "Run it" with JSON for the trigger to hand over. Each step lights up while the run goes on (the engine reports steps only in its test mode, which is otherwise the same run). A run can be stopped. Runs queue, up to 20, and a run stops after 5 minutes by default (15 at most).
- **Runs:** each flow's last runs, with when, how long and who, and any one can be looked at again. Runs belong to the flow's own `id`, so they follow it when the file moves, and a new flow with an old name starts with none.
- **Examples:** 179 for coding, written here (collections found online don't show terms that allow copying them), in 12 kinds: releases, pull requests, code quality, tests and CI, security, issues, deploys, docs and data, notifications, tickets, AI and digests. **80 run here**, with no account: code steps, and real pieces for CSV, JSON (JSONata), XML, crypto, dates, maths, text and the room's own store. The other 99 need a service's connection and the internet, which rooms don't have yet, and the gallery says so on each.

**Where:**
- **Sandbox:** `sandbox/image/automation/` (`package.json` and its lockfile pin 44 pieces; `prepare.mjs` writes the manifest of their actions and fields; `host.mjs` is the worker that runs the engine), `sandbox/image/automation.py` (queue, status, stop, runs), and the `apengine` and `automation` stages of the Dockerfile, which take the engine from Activepieces' image by digest.
- **Runner and API:** `apps/runner/src/automations.ts`, `POST /api/rooms/:id/automations` (needs `code.run`, not in interviews; looking at status or runs doesn't wake a sleeping room); `packages/contracts/src/automations.ts`.
- **Web:** `components/room/tools/automations/` (`automations-tool.tsx`, `step-panel.tsx`, `examples-view.tsx`, `examples.ts`, `model.ts`).

**Found by using it, and fixed:**
- **A run could miss what was just typed:** it waits for the sandbox to have it, as LaTeX builds do.
- **Runs belonged to a file's path,** so a flow deleted and made again with the same name showed the old one's runs, and a webhook would have broken on a rename. Each flow now has its own `id`, kept through every edit.
- **An example said it made a safe branch name, and didn't:** the Slugify piece keeps colons and capitals. Running every example and checking its answer caught it; that example is code now.
- **The help under a field was read out as part of its name;** it's now tied to the field with `aria-describedby`.
- **Two older bugs the audit found:** going through the open files with the arrow keys lost focus to the editor, and on a phone the side bar's buttons were squashed below a finger's size once it held every app. Focus now stays on the tabs, and the bar scrolls.

**Tests:**
- `apps/web/components/room/tools/automations/model.test.ts` (24)
- `apps/runner/test/automations.e2e.mjs` (57 checks on the real engine and pieces: code and TypeScript, pieces, routers, loops, a failure that stops a run and one that carries on, retries, the store, a queue, stopping, too long, a flow's runs following its id, a file that isn't a flow or isn't there, paths that try to leave, and another room's token)
- `apps/runner/test/automation-examples.e2e.ts` (every step of all 179 examples checked against what its piece has, and all 80 that run here run on the engine with their answer checked)
- `apps/web/test/automations.e2e.mjs` (48 checks in a browser: the gallery, using an example, two people, a real run lit up on the chart, the other branch, earlier runs, what went in and came out, renaming and changing code, adding code and a real piece and running them, removing, a failure, steps lighting up while running, stopping, bad JSON, a new flow, a broken file, and a phone)
- `a11y.e2e.mjs` includes the tool

### Automations: expressions offered as they're typed ✅ (2026-11-18)

**What:** as in n8n's editor, typing `{{` in any of a step's fields opens a list of what it can be: what each step before this one gives (inside a loop, its item and index too), and, when a run is shown, every field inside them, with a sample of each (`fetch.output.body.items[0].id  a1`). What's typed after the `{{` narrows it, what starts with it first; the arrows move, Enter or Tab puts it in (a `}}` already there is replaced, not doubled), Escape closes the list and nothing else.

**Where:** `components/room/tools/automations/expressions.ts` (`suggestionsAt`, pure) and `expression-input.tsx`, the field every piece and built-in step's text uses (`step-panel.tsx`). The field stays a textbox for screen readers, with the list as its `aria-controls` and the choice its active descendant.

**Tests:** `expressions.test.ts` (with `model.test.ts`, 38: what's offered from the steps before and a run's data, narrowing, names found inside a path coming after, nothing outside `{{ }}`, a closing `}}` replaced, and the steps alone without a run); `apps/web/test/automations.e2e.mjs` (110 checks), adding the list on `{{`, narrowed, chosen with the arrows and Enter, and Escape closing only the list.

### Automations, part two: n8n's editor, our own way ✅ (2026-11-08)

**What:** the owner's "n8n ke saare features", for the editor. n8n's source was read for what its canvas does (its node settings, its right-click menu and its keys); none of its code is used.

**What it does:**
- **Adding anywhere:** a + on every arrow (faint until pointed at or focused), and a + wherever nothing comes next yet: after the last step, at the end of a loop's steps, in an empty branch or loop. Each says where it puts a step ("Add a step at the start of the Big branch of Big?").
- **The step picker:** the basics (code, a router, a loop) and every action of the 44 pieces (1,305), searchable by name or what it does, or browsed by service. The same picker replaces a step (keeping its name, so what refers to it still works) and changes the trigger.
- **The right-click menu and keys** on a box: Open, Rename (F2), Replace, Turn off (D), Add a step after (N), Duplicate, Copy, Cut, Paste after (Ctrl+D, C, X, V), Remove (Delete); the arrows move between boxes, up and down between branches; Ctrl+Enter runs. The keyboard's menu key opens the menu too. A box focused or selected off the edge of the chart is brought into view.
- **Undo and redo** take back one's own changes, not another person's (Yjs' undo manager on the flow's text, tracking only this browser's edits).
- **Copy and paste** give the copy and everything inside it names of their own, and their expressions follow: a copied loop still reads its own item. A step copied goes to the system clipboard as JSON too, for another room.
- **A step turned off** is passed over when the flow runs (the engine's own `skip`), with a dashed border and "Off" on the chart.
- **A note on any step,** shown under its box, and what the flow is for, beside its runs.
- **Data, as n8n maps it:** what went in and came out as a table, as JSON or as its fields; the data of every step before, from the run being looked at, each field with Use, which puts its expression where the cursor was in the field being filled in; and under a field with an expression, what it comes to on that run. Only plain paths are shown; the engine works out the rest.
- **Routers:** every test the engine has (22, by its own names), and and or, more branches and removing them, capitals mattering or not, and running the first branch that matches or each that does. A branch's name is drawn on its arrow, and said with its first step for a screen reader.

**Where:** `components/room/tools/automations/` (`flow-view.tsx`, `step-picker.tsx`, `router-fields.tsx`, `data-view.tsx`, `expressions.ts`, `clipboard.ts`, `step-panel.tsx`, `model.ts`), and `components/flowchart/flowchart.tsx` (labels and + on arrows, + points, the menu, keys, dashed boxes, notes, following focus), whose new parts are all opt-in, so the Flow tool is as it was.

**Found by using it, and fixed:**
- **"Starts with" didn't exist:** the engine calls it `TEXT_START_WITH`, without an S, and an example had the other spelling. It passed because its sample did start that way. Every router example is now run both ways, and every test's name is checked against the engine's.
- **The chart shrank until it couldn't be read** once arrows had room for labels; it now stops at a readable size, and "Show everything" goes smaller.
- **Branch names overlapped** where branches fan out from one router; they now sit at each arrow's end.
- **A step added off the edge of the chart couldn't be seen,** and nothing could be added at the end of a branch when the router was last. Both fixed.

**Left** (in `docs/pending.md`): choosing several boxes at once, sticky notes and groups placed freely, expressions completing as they're typed, and the command bar.

**Tests:**
- `model.test.ts` and `expressions.test.ts` (34: the + points and where each puts a step, branch names, turning off and notes, copying and pasting with names and expressions following, replacing, branches added and removed, the engine's tests, fields and paths, previews, putting an expression where the cursor is)
- `apps/runner/test/automation-examples.e2e.ts`: also every router example both ways, and every test's name
- `apps/web/test/automations.e2e.mjs` (69 checks in a browser, adding to part one's: the picker and searching it, the + at the end of a branch, data put in a field and what it comes to, the engine reading it, the menu's Duplicate, undo and redo, the other person seeing it, Delete, copy and paste from the keyboard with a name of its own, the arrows, N, D and the engine passing over a step turned off, a note, a branch added and removed, the 22 tests, and changing the trigger)

### Automations, part three: trying things ✅ (2026-11-17)

**What:** n8n's ways of trying a flow without running all of it again, on Activepieces' real engine.

- **One step on its own:** "Run this step" on a code step or a piece's action runs only that step, with every other step standing in with what it gave on the run shown (and the trigger with what's to be sent, if it hasn't run). It's the engine's own single-step mode (`stepNameToTest` and `sampleData`). The run is listed as "one step", and the chart lights up only that step.
- **Pinning:** "Pin this output" keeps what a step gave, in the flow's file (`pinned`). When the flow runs, a pinned step doesn't: it gives back what was pinned, so what comes after gets the same data every time and no service is called, which is how a step that needs an account can be tried around before there's a connection. The host does it by standing a code step in for each pinned one. The pin can be edited as JSON, and unpinned; the chart says "Pinned", and each run lists what was pinned. A pinned step tried on its own runs for real.
- **Carrying on from where a run stopped:** a failed, stopped or timed-out run has "Carry on from where it stopped". It runs the flow as it is now with what the first run was sent, keeping what succeeded and not running it again, and starting at the step that didn't: fix the step, then carry on. It's the engine's own resume (`executionType: RESUME`), reading the earlier run's steps from the host. Only a run of the same flow can be carried on.
- **What a run was sent** can be put back in "What to send", to try the same thing again.

**Where:** `sandbox/image/automation/host.mjs` (`withPins`, the step and resume modes), `sandbox/image/automation.py` (checking what can be tried, and from which run), `packages/contracts/src/automations.ts`, `apps/runner/src/automations.ts`, and in `components/room/tools/automations/`: `model.ts` (`pinStep`, `unpinStep`; pins follow a step when it's copied and go when it's removed), `step-panel.tsx` and `flow-view.tsx`.

**Read from Activepieces' source** (MIT, version 0.92.3-hotfix.2): how its single-step mode fills in the other steps (`test-execution-context.ts`), how a resume keeps what succeeded and skips it (`flow.operation.ts`, and the code and piece executors' `isCompleted`), and where it reads an earlier run from (`engine-file-api.ts`).

**Left** (in `docs/pending.md`): running from a chosen step onward, and pinning the trigger's data.

**Tests:**
- `model.test.ts` (35 with `expressions.test.ts`: pinning, the chart, pins going with a removed step and following a copy)
- `apps/runner/test/automations.e2e.mjs` (71 checks on the real engine, adding: one step with the data given and the steps before it not run; the trigger and a missing step refused; a pinned step that would fail not run, its data reaching the next step, and the run saying so; a pinned step tried on its own running for real; a run failing, then carried on once fixed, with the first step not run again and what it was first sent kept; a run that didn't fail, and another flow's run, refused)
- `apps/web/test/automations.e2e.mjs` (78 checks in a browser, adding: one step and only it lit up, pinning, a pinned step not run and the branch following the pinned data, unpinning, using what a run was sent, and carrying a failed run on with the step fixed)

### Automations, part four: built-in steps for data ✅ (2026-11-17)

**What:** n8n's core steps for working on lists of items, written here: **Edit Fields** (set fields, keep only some, take some away; `$item.path` reads from each item), **Filter** (19 tests, keeping what passes or what doesn't), **Sort** (as text, numbers or dates, either way, with empty values last), **Limit**, **Aggregate**, **Summarize** (how many, sum, average, smallest, largest, how many different, joined, overall or by group), **Remove Duplicates**, **Split Out**, **Rename Keys**, **Merge** (one after the other, matched by a field with what to keep, side by side, every pairing), **Compare Datasets** (only in the first, only in the second, the same, and different with which fields), and **Stop and Error**. They're in the step picker under Data, each with its own form, and nine examples use them.

**How:** a built-in step is a code step marked `builtin` in the flow's file. The host writes it as a module that calls ours in the image (`sandbox/image/automation/builtins.mjs`), whatever its code says, so Activepieces' engine works out its inputs' expressions as for any code step, a pinned one gives back what was pinned, and an improvement to a built-in step reaches every flow. A name that isn't a built-in step, or that tries to be a path, fails the run saying so.

**Why not a piece of our own:** Activepieces' pieces from npm come with their framework bundled inside, so a piece of ours would have needed `@activepieces/pieces-framework` as a new package. A marked code step needs nothing new.

**Where:** `sandbox/image/automation/builtins.mjs` (and the Dockerfile's copy of it), `host.mjs` (`writeCodeSteps`), and in `components/room/tools/automations/`: `builtins.ts` (the forms), `model.ts` (`newBuiltinStep`, the chart's Data glyph), `step-picker.tsx`, `step-panel.tsx` and `examples.ts`.

**Tests:**
- `sandbox/image/automation/builtins.test.mjs` (13, with `node --test`: every step, with paths, lists from JSON text, empty values, groups, and each way to merge)
- `model.test.ts` (36 with `expressions.test.ts`)
- `apps/runner/test/automations.e2e.mjs` (79 checks on the real engine, adding: Filter, Sort and Summarize chained, Stop and Error stopping the run with its message worked out, a pinned built-in step, and a name that isn't one or tries to be a path)
- `apps/runner/test/automation-examples.e2e.ts` (188 examples, 89 run on the engine: every built-in step's fields checked against its form, and every form against the image's code)
- `apps/web/test/automations.e2e.mjs` (80 checks), adding Filter from the picker, its form rather than code, and its run on the engine

### Automations, part nineteen: the room's variables ✅ (2026-11-19)

**What:** n8n's variables ($vars) for a room's flows: names and text a flow reads, such as a base address, an environment's name or a channel, kept with the room so each flow doesn't hard-code them.

- **In a flow:** `{{variables.NAME}}` or `{{variables['NAME']}}`, Activepieces' own expressions, anywhere a field takes one, inside text too. They're offered as `{{` is typed, with the steps' data. A name the room hasn't fails its step, saying "variable (NAME) not found".
- **The Variables dialog** (the tool's header): each one with its value, who set it and when, Copy (its expression), and, for owners, its value changed or removed. Names are letters, numbers and `_`, not starting with a number; values up to 4,000 characters; up to 100 a room.
- **Who:** they aren't secrets (those are connections), so anyone who can run the room's code sees them, values too. Only its owners (`room.manage`) add, change and remove them, one at a time, so two owners editing different ones don't undo each other. Each change is in the audit log by name, without its value.
- **Given to each run by the API**, as connections are (`ConnectionsVault`): runs by hand, by a webhook, a schedule, a room event, a service's new items, carried on after a wait, and a look for new items. A browser can't hand a run variables of its own. Kept plain in the room's settings (`automationVariables`).
- **Flows started by a flow:** a flow called (waiting or not) and an error flow get the room's connections and variables. Found on the way: before this, an error flow and a flow called without waiting got none of the room's connections, as the worker queued them without.

**Where:** `packages/contracts/src/variables.ts` (`VariableName`, `AutomationVariableInput`, `RunVariables`), `automations.ts` (on run, resume and poll); `apps/api/src/automations/automation-variables.service.ts` and `.controller.ts`, `connections-vault.ts` (`variablesOf`, `forRun`), `runner/runner.client.ts`, `sandbox/sandbox.controller.ts`; `apps/runner/src/automations.ts`; `sandbox/image/automation.py` (`variables_of`), `automation/host.mjs` and `engine-call.mjs` (`/v1/worker/variables/:name`); web `tools/automations/variables-settings.tsx`, `automations-tool.tsx`, `step-panel.tsx`.

**Tests:** `packages/contracts/src/variables.test.ts` (4: names, values, a run's, the expression), and `apps/runner/test/automation-variables.e2e.mjs` (14/14 on the real engine: an owner sets them and an editor can't, both ways of reading them and inside text, a changed value reaching the next run, a browser's own refused, one the room hasn't failing its step, an error flow getting them, removing one). Looked at in a browser, light and dark: the Variables dialog with two variables and a name typed wrong, and {{var in a step's field offering them; the accessibility test checks the dialog too.

### Automations, part eighteen: running from a step, and pins by hand ✅ (2026-11-19)

**What:** the rest of n8n's ways of trying a flow: running from a chosen step on (its partial runs), and pinning the trigger's data. On the way, pins now work as n8n's do: only on a run by hand.

- **Run from here:** a step's panel has it beside "Run this step", once a run of the whole flow is shown. That step and every step after it run with the flow as it is now. The steps before it aren't run again: they give what they gave on the run shown, which was sent the same data. It's the engine's own resume, given that run's steps up to the chosen one, so it works from a step inside a router's branch or from the router itself (which chooses again). A step inside a loop starts from its loop, as a loop keeps each time round apart. The run says "from <step>", and which run it started from.
  - **Refused, saying why:** the trigger, a step the flow hasn't, a run of one step tried on its own, a run still waiting, and a run of another flow.
  - Found by trying the engine first, in the sandbox, with steps that stamp the time they ran: kept up to a branch's step, only what's after it ran again; kept up to the router, the router chose again and its branch ran.
- **Pins, by hand only:** part three's pins stood in for their steps on every run. A pin left in a flow that's on would have quietly skipped real work on each webhook, schedule or room event. Now, as in n8n, only a run by hand (and one step tried, and a run from a step) uses them. Started by its trigger, every step runs for real, and the run lists no pins. The panel says so.
- **The trigger's pin:** "Pin this output" on the trigger keeps what it gave. A run by hand then starts with that rather than what's sent, and What to send says so.
- **A step replaced loses its pin:** what was pinned was the old step's output; changing the trigger drops the trigger's.
- **Looked at in a browser**, light and dark: a branch's step with Run this step and Run from here, the trigger pinned (its panel and its box), and What to send's note. Fixed on the way: the webhook trigger showed Activepieces' own notes with their server's blanks unfilled ("Live URL: {{webhookUrl}}"); a piece's note with such blanks is now left out, as the trigger's panel shows the room's own addresses.

**Where:** `sandbox/image/automation.py` (`steps_in_order`, the `from` mode); `sandbox/image/automation/host.mjs` (`byHand`, the trigger's pin, `from` resumed like `retry`); `packages/contracts/src/automations.ts` (the `from` mode); web `tools/automations/step-panel.tsx` (Run from here, what a pin does), `flow-view.tsx` (the run it starts from, the runs' words, What to send's note), `model.ts` (`canPin` takes the trigger, `replaceStep` drops the pin).

**Tests:** `apps/runner/test/automation-run-from.e2e.mjs` (17/17 on the real engine: from the last step, a branch's step, the router, a run itself run from a step, and inside a loop, each telling a step run again from one kept by the time it ran; the four refusals; pins by hand, the trigger's pin choosing the other branch, and every step running for real when started by its trigger), `model.test.ts` (32/32, with the trigger's pin and a replaced step's), and `apps/web/test/automations.e2e.mjs` (127/127: Run from here on a branch's step, the run saying so).

### Automations, part seventeen: files ✅ (2026-11-19)

**What:** files in automations, as n8n's binary data: what a step makes reaches the steps after it, a flow reads and writes the room's own files, and a run's files can be downloaded. Found on the way: a step's output over 32 KB never reached the next step.

- **Outputs over 32 KB:** Activepieces' engine keeps any step's output over 32 KB apart (a "slice") and reads it back when a later step uses it. The worker took every such upload for the run's details and couldn't give it back, so the next step got nothing, silently: a real run sent 50,000 characters and the next step got 0. Now each is kept with its run and given back, and the run's details have it whole (up to 8 MB in all).
- **A step's files** (File Helper's Create File, Zip and Unzip, the CSV piece's files, an Excel file) are kept with their run in the sandbox. They're read from the worker at an address ending in the file's name, as Activepieces' pieces take a file's name from it.
  - Each worker has a port of its own, so a run carried on after a wait, tried again, given pinned data or a called flow's output reads the same files from the worker running now (`filesHere`).
  - Up to 10 MB each, Activepieces' own limit. They go with their run (the 50 latest are kept).
- **Read files** (n8n's Read Files from Disk): the room's files a path or pattern names (`reports/*.csv`, `docs/**/*.md`), one item each, with its file and, when asked, its text. Never `.git` or `node_modules` unless named; up to 100 files, 50 MB together. A path that isn't there fails the step; a pattern can find none.
- **Write a file** (n8n's Write File to Disk): text, JSON or a step's file (its address, or the item Read files, Unzip or Create File gives) into the room's files: replacing, adding to the end, or new only. Folders are made as needed, and the room's live document then has it.
- **Convert to File, Extract from File and Compression** are Activepieces' own pieces, already in the image, now that files reach the next step: File Helper (create, read, zip, unzip, encoding, type), CSV (CSV and JSON both ways, CSV and Excel files) and XML.
- **Download:** a step's data lists its files above it, each with Download, through the API (`run-file`, Run rights), while the run is kept.
- **An example:** "Save a call's rows as a CSV file in the room" (the CSV piece's file, written into the room).
- **What a flow writes can be deleted:** the worker runs as the sandbox's other user (`ccuser`), so a folder Write a file made was `drwxr-sr-x`. The agent (`ccagent`, same group) couldn't remove a file someone then deleted in the editor. It stayed in the sandbox, came back into the room, and stopped the sandbox resetting (EACCES). The worker now keeps the agent's `umask 002`, which its engine, code steps and commands inherit.
- **Looked at in a browser**, light and dark: Read files' form, and a run's output with its files and Download. Fixed on the way: the files sat above "What came out"'s heading, so they looked like "What went in"'s.

**Where:** `sandbox/image/automation/files.mjs` (new: names, addresses, `filesHere`, `wholeSteps`, paths and patterns in the room), `host.mjs` (files and slices kept with the run, `/v1/step-files`, `/v1/codechatter/files`), `builtins.mjs` (`read_files`, `write_file`), `automation.py` (`run-file`), `Dockerfile`; `packages/contracts/src/automations.ts` (`run-file`); web `tools/automations/data-view.tsx` (`filesIn`, Download), `builtins.ts`, `examples.ts`.

**Tests:** `sandbox/image/automation/files.test.mjs` (5: names and addresses, files moved to this worker, slices put back in loops and within the budget, paths and patterns, never `.git` unless named), `builtins.test.mjs` (Read files and Write a file through a stand-in worker), `apps/runner/test/automation-files.e2e.mjs` (18/18 on the real engine: a big output reaching the next step and the details whole, File Helper's file read by the CSV piece, Download and its refusals, the room's files read, zipped, unzipped and written back to the live document, a run tried again reading a file made before it failed), `apps/web/test/automations.e2e.mjs` (125/125: Read files from the picker, run, and its file downloaded with its name), and `apps/runner/test/automation-examples.e2e.ts` (11/11: all 92 of the 194 examples that run here, the new one too, its file removed after).

### Automations, part sixteen: the internet, for the services the owner turns on ✅ (2026-11-19)

**What:** a room reaches nothing outside itself (ADR 0007). Now its owner can turn on the services its automations call, so a flow's GitHub, Slack or HTTP step reaches them, through the room's own proxy, and nothing else.

- **The Internet dialog** (the tool's header, or "Internet…" on a step that needs a connection): services to tick, each with its hosts (`PIECE_HOSTS`: GitHub's api.github.com and the rest, Slack's, OpenAI's, Notion's, and so on), and other hosts by name, for the HTTP, RSS and GraphQL steps and services with a host of their own (your-team.atlassian.net). Names only: an address, a port, a path, a wildcard or a private name (`.local`, `.internal`) is refused, saying why. Turning it on and off is the owner's, as package installs are (`sandbox.network`); anyone who can run the room's code sees what's on, and who turned it on. Each change is in the audit log with the hosts it came to.
- **One proxy for both:** the room's package-installs proxy (`egress`) now also takes the automations' hosts (`EGRESS_ALWAYS`, beside the registries' `EGRESS_ALLOW`). Installs still end on time by the proxy itself; when they do, it carries on for the hosts rather than exiting. It opens HTTPS (CONNECT, port 443) tunnels to those exact names only, and refuses a name that resolves to a private address. The hosts last a day after they were last needed: each run, look for new items or connection check renews them, and the sweep removes a proxy no one has needed. On Docker and on Kubernetes alike (`ProxyBase`, shared by `Egress` and `KubeEgress`).
- **Every program in the room** can reach those hosts while they're on, not only flows: the dialog says so, as it's the room's way out.
- **Pieces go through it:** Activepieces' pieces use Node's own fetch, which follows `HTTPS_PROXY` only when told (`NODE_USE_ENV_PROXY=1`), and the engine's calls to its own worker, the AI gateway and the room's services stay off the proxy (`NO_PROXY`). Found by running a real flow in a throwaway sandbox against a stand-in proxy: without it, a piece looked hosts up itself and failed; with it alone, the engine's own calls went to the proxy and broke the run.
- **Refused, with a reason:** a host that isn't on gets "isn't one of the hosts this room may reach: its owner chooses them under Automations, Internet", which a step shows as its error.
- **Looked at in a browser**, light and dark, for parts fourteen to sixteen: the Connections dialog with Postgres's form, the Internet dialog, and a polling trigger's panel. Fixed on the way:
  - the dialog's Name field had bigger type than the rest (`md:text-xs`);
  - a piece's note among its fields showed its Markdown as written ("\*\*NOTE:\*\*"), and is now rendered, small (`PieceNote` in `step-panel.tsx`);
  - "Try it" now sits beside "Turn on";
  - the title bar's More tooltip stayed open over the tool's header after choosing a theme, because the menu gives focus back to its button. It now waits for the pointer (`title-bar.tsx`).

**Where:** `packages/contracts/src/automations.ts` (`PIECE_HOSTS`, `hostProblem`, `internetHostsOf`, `AutomationInternetInput`); `apps/api/src/automations/automation-internet.service.ts` and `.controller.ts`, `connections-vault.ts` (the hosts with each run), `runner/runner.client.ts`, `sandbox/sandbox.controller.ts`; `apps/runner/src/egress.ts` (`ProxyBase`, `planOf`, `proxyEnv`), `kube-egress.ts`, `server.ts` (`sandbox/services`, and the hosts before a run); `sandbox/agent/src/egress.ts` and `egress-policy.ts`; `sandbox/image/automation/host.mjs` and `engine-call.mjs` (the proxy settings for pieces); web `tools/automations/internet-settings.tsx`, `automations-tool.tsx`, `connections.tsx`.

**Tests:** `packages/contracts/src/internet.test.ts` (4: names only, every host of a service once, what's refused, the API's alone), `apps/runner/src/egress.test.ts` (5: the proxy's settings and reading them back, installs and hosts together, no restart for the same hosts, going when there's nothing), `sandbox/agent/src/egress-policy.test.ts` (10, adding the refusal naming the room's hosts), and `apps/runner/test/automation-internet.e2e.mjs` (11/11, on the real internet: addresses and private names refused, an editor unable to turn it on, nothing reached while it's off, GitHub turned on and a flow's HTTP step reaching api.github.com while example.com is refused, and off again).

### Automations, part fifteen: a service's new items ✅ (2026-11-18)

**What:** pieces' polling triggers, as Activepieces' server runs them: a flow that starts on a service's new items (Postgres's New Row, a new Jira issue, a new RSS item, a new Notion database item: 37 of them, across 12 pieces), with nobody in the room.

- **The trigger's panel** ("Starting by itself") says how often it looks (every 5 minutes unless changed, every minute at most, once a day at least), turns it on and off, says when it next looks and last started a run, and why it stopped if it did. **Try it** asks the service now for an example of what the flow would be given, with "Use it as what to send".
- **Turned on, what's there already doesn't count:** the piece's own ON_ENABLE remembers it, in a store of the trigger's own (a file in the sandbox, apart from flows' store), and each look (RUN) gives only what's new since, each item a run of its own, with that item as the trigger's output. Turned off, the piece forgets (ON_DISABLE); turned on again, it starts from what's there then.
- **The timer** is the schedules' (every 20 seconds): a trigger whose time has come is claimed in Valkey first, so with several API servers one looks. A look that finds more than the room's queue holds says how many were passed over. A flow whose file no longer starts on new items turns itself off and says why, as schedules and room events do.
- **Connections** (part fourteen) are given to each look, so a piece signs in as a run's steps do. Services on the internet wait for the room to reach it (the internet switch and allowlist, next); the room's own databases work now.
- **A look that fails says why** on the panel, and tries again next time. Found so: Postgres's New Row reads its order column as a date wherever it can, so an integer id is taken for a time in 1970 and the look fails ("invalid input syntax for type integer"); order by a timestamp, such as `created_at`, as its own note suggests.
- **How:** `automation.py`'s `poll` op calls the engine's EXECUTE_TRIGGER_HOOK through `engine-call.mjs`, at once rather than behind the room's runs; the schedule piece's own triggers, polling ones to Activepieces, stay with the schedules' timer.

**Where:** `packages/contracts/src/automations.ts` (`PollInput`, the `poll` kind and op); `sandbox/image/automation.py` (`poll`, `polling_piece`), `automation/engine-call.mjs`, `automation/host.mjs` (a polled item as the trigger's output); `apps/api/src/automations/automation-triggers.service.ts` (`pollDue`, `pollHook`, `pollTest`) and `.controller.ts` (`poll-test`), `runner/runner.client.ts`; web `tools/automations/poll-settings.tsx`, `step-panel.tsx`.

**Tests:** `apps/runner/test/automation-polling.e2e.mjs` (16/16, about three minutes: the room's Postgres with a row already, a connection to it, less than a minute refused, turned on with when it next looks, two rows added each a run with its row and the old one not, when it last looked, turned off and a row then not running, the file no longer on new rows turning it off by itself).

### Automations, part fourteen: the room's connections ✅ (2026-11-18)

**What:** n8n's credentials, for Activepieces' pieces: a room keeps the sign-ins its flows use (a Slack token, a database's password), and a step chooses one by name (`{{connections['room-db']}}`, Activepieces' own expression). Until now no piece could sign in at all.

- **The Connections dialog** (the tool's header, or "Connections…" on a step that needs one): each connection with its piece, the fields that aren't secret (a host, a user), and whether it worked when last tried. Owners add one with the fields its piece describes for its own sign-in (a secret, a user and password, or its own fields, such as Postgres's host, port, user, password and database), and **Save and test** tries it at once; they give one new details, or remove it. Anyone who can run the room's code sees them, tries them, and uses them in a flow. OAuth2 (10 of the pieces) comes later, and says so.
- **A step** that needs one has a **Connection** list of the room's connections for its piece; one named that the room doesn't have says so.
- **Kept safe:** each is sealed with AES-256-GCM in the room's settings (`automationConnections`), under a key of its own (HKDF from the server's secret, apart from GitHub tokens'). Its secret never comes back: not when saved, listed or tried; what's shown is worked out on the server, which leaves out passwords, keys and tokens whatever the browser says. Changes go in the audit log by name and piece only.
- **Given to a run** by the API (`ConnectionsVault`, in `RunnerClient`), opened for that run only, for runs started by hand, a webhook, a schedule, a room event or carrying on; a browser can't hand a run connections of its own (the API takes them out). In the sandbox they go to the worker on stdin and are never written down; Activepieces' engine already keeps them out of a run's details, and the host also takes every connection's secret out of what a run keeps, as a second guard.
- **Tried by the piece's own check** (Activepieces' validate), in the room's sandbox, at once rather than behind the room's runs: `engine-call.mjs` asks the engine one thing and answers. What a database refuses with is said in words ("The user name or password is wrong. (28P01)"), not as its driver's error.
- **Who can use what:** anyone who can run the room's code could send a connection's secret somewhere with a flow, as in n8n, so only owners add them; the dialog says to give a room only what its members may use.

**Where:** `packages/contracts/src/automations.ts` (`ConnectionValue`, `AutomationConnectionInput`, `AutomationConnection`, `shownOf`, `connectionNameOf`, `AutomationRunnerInput`); `apps/api/src/automations/connections.ts`, `connections-vault.ts`, `automation-connections.service.ts` and `.controller.ts`, `github/token-box.ts` (a key for each purpose), `runner/runner.client.ts`, `sandbox/sandbox.controller.ts`; `apps/runner/src/automations.ts` and `server.ts`; `sandbox/image/automation/engine-call.mjs`, `automation.py` (`test-connection`) and `automation/host.mjs` (connections in the engine's shape, and secrets taken out); web `tools/automations/connections.tsx`, `automations-tool.tsx`, `step-panel.tsx`.

**Tests:**
- `packages/contracts/src/connections.test.ts` (4: each kind of sign-in, what's shown, the expression, who may give a run them), `apps/api/src/automations/connections.test.ts` (5: sealed, a key of its own, replaced, opened for a run, a refusal in words)
- `apps/runner/test/automation-connections.e2e.mjs` (20/20: the room's own Postgres, a connection saved and tried by the owner, what's shown, wrong details saying why, a flow's Postgres step querying with it, the secret in neither the list nor the run's details, an editor using and trying but not adding or removing, a browser's own connections ignored, a removed one saying so)
- `apps/web/test/automations.e2e.mjs` (123/123), adding the dialog, a piece's own fields, wrong details saved and saying so, the secret nowhere on the page, a step choosing it and saying when it's gone; `a11y.e2e.mjs` (163/164; the one miss was the settings page not loading within 30 seconds on a phone while other work was compiling, not this), adding the dialog with its form open

### Automations, part thirteen: CodeChatter's own steps ✅ (2026-11-18)

**What:** three built-in steps that only CodeChatter can have, under **This room** in the step picker: **Run a command** (n8n's Execute Command), **Ask the room's AI** and **Post to the room's chat**. With part twelve's events they close the loop: "someone types /deploy staging, run the deploy script, and say in the chat how it went".

- **Run a command:** bash, in the room's files (a folder of the room, or its top; a folder outside it is refused), inside the sandbox's jail like the flow, with the room's services and no other network. It gives `exitCode`, `stdout`, `stderr` (a megabyte each at most), `timedOut` and `durationMs`. It's stopped after the seconds asked (60 if none, 600 at most), with whatever it started. A command that fails fails the step, with its code and the last lines it printed; told not to, it gives the code for a router. The engine's own worker port and token aren't in its environment.
- **Ask the room's AI:** the model the room uses, through its AI gateway, so there's no key in the room and the room's rules apply (the interview switch, the rate limit, traces). Instructions, a model if not the room's, and "Answer as JSON", which reads the answer (in a fence or not) as `json` for the next steps.
- **Post to the room's chat:** a message everyone in the room sees, from **Automations** (no author, drawn as GitHub's are, links clickable), kept with the chat and found by its search. It reaches the API the way the AI does, through the agent's gateway door and the runner, which names the room (`/codechatter/chat` on the door, `/api/internal/automations/chat` on the API, never reachable from a browser). 20 a minute a room; none in an interview's chat. It doesn't count as unread, as GitHub's don't, and doesn't set off a chat event, so a flow can't answer itself forever.
- **In the gallery:** "Answer /status in the chat with what's changed" and "Tell the chat when a Run fails" (both run here), and "Explain failing tests with the room's AI" (which needs the room's AI, so the examples test checks its steps but doesn't run it).

**Where:** `sandbox/image/automation/builtins.mjs` (`run_command`, `ask_ai`, `post_to_chat`, `doorOf`, `folderOf`, `commandEnv`); `apps/runner/src/gateway.ts` (the chat's address on the door); `apps/api/src/automations/room-events.controller.ts` (`chat`); the message kind `automation` (`packages/contracts/src/chat.ts`, `packages/db/src/schema/app.ts`: a type only, no migration, and `MessagesService.post`); web `tools/automations/builtins.ts`, `step-picker.tsx`, `examples.ts`, and `components/room/chat-panel.tsx`.

**Tests:**
- `sandbox/image/automation/builtins.test.mjs` (18: the door, folders, the command's environment, the AI and the chat through a stand-in door with their refusals; running commands, which needs bash and a Unix folder, is skipped on Windows and runs for real below)
- `apps/runner/test/automation-codechatter.e2e.mjs` (18 checks: a chat command running a command in the room's files and answering in the chat as the automations, kept in its history; a failing command, one told not to fail, one out of time, a folder outside the room; the room's files as its folder and no engine token; the room's AI asked; the chat's address refusing strangers, an empty message and browsers): 18/18 with the local model (`gemma4:e4b`), which answered "Ready". With no model running, the AI step fails with a plain "The AI request failed", which the test also accepts.
- `apps/runner/test/automation-examples.e2e.ts` 11/11 (193 examples, 91 run here, the two new ones posting to the chat for real), and `apps/web/test/automations.e2e.mjs` 114/114.

### Automations, part twelve: what people do in the room ✅ (2026-11-18)

**What:** six more room events, from what people do rather than the audit log: **a Run fails** and **a Run finishes**, **tests fail** and **tests are run** (the Tests tab), **a commit is made in the sandbox**, and **a chat message**. "When a Run of a Python file fails, ask the AI why and post it", "when someone types /deploy staging in chat, deploy to staging", "on every commit in the terminal, run the linter".

- **A Run:** the API sees each Run end (`realtime/events.gateway.ts`) and queues one event, with the file, the command, how it ended (`code`, `reason`), how long it took, and the last 4,000 characters it printed, without the terminal's colours; who pressed Run is `by`. It failed when it ended with an error, ran out of time, printed too much or the sandbox failed it; **stopping it doesn't count**, nor a restart. A flow listening for failures also hears it as finished, from the one event (`eventNamesOf`).
- **Tests:** the API reads the Tests tab's stream as it passes to the browser (`TestsWatcher`, decoding the runner's bytes as text) and queues what it came to: passed of total, each case's verdict, time and output, a compile error. Failed means a case failed, errored or ran out of time, or it didn't compile; tests the person left before they finished say nothing.
- **Runs and tests of which files:** the same patterns as files changing (`src/**/*.py`), chosen on the trigger's panel ("Runs of which files", "Tests of which files"); the patterns carry over when the event changes between files, Runs and tests.
- **Commits in the sandbox:** the agent watches the repository's reflog (`/workspace/.git/logs/HEAD`, a stat every second and a half) and reads only what's added after it starts: commits however they're made (a terminal, Git in the sandbox, a script), including amends, merges, cherry-picks and reverts, not checkouts, resets, rebases or fast-forwards. Nothing is run and no hook is installed, so a repository's own config can't make the agent run anything. The runner sends them to the API's internal address (`/api/internal/automations/events`, its service token naming the room; Caddy never lets browsers reach `/api/internal`). The flow gets the branch and each commit's id, parent, kind, message, author and time; `by` is who git says, a name and not an account.
- **Chat:** a message queues an event once, though a retried send returns the same message (claimed in Valkey by the message's id). The trigger can listen only for messages that start with something, such as `/deploy`: case doesn't matter, and a start ending in a letter must end a word (`/deploy` isn't `/deployment`). What follows is `data.args` (`/deploy staging` gives `staging`).
- **Running them:** on the same queue as the other room events, with the same limit (30 runs a minute a flow) and the same rule that the file wins. Interview rooms have none.
- **Fixed on the way:** git didn't work in a terminal at all: `/workspace` belongs to the file-sync agent, and terminals and Run work as another user, so every git command there said "dubious ownership". Both images now have `/etc/gitconfig` trusting the sandbox's repositories (each sandbox is one room's).

**Where:** `packages/contracts/src/room-events.ts` (the events, `eventNamesOf`, `chatCommandOf`, `keptRoomEvent`, what each gives) and `automations.ts` (`startsWith`); `sandbox/agent/src/git-log.ts` (`commitsOf`, `branchOf`, `ReflogWatcher`); `apps/runner/src/room-events.ts`; `apps/api/src/automations/room-activity.ts` (`queueRoomEvent`, `runEventOf`, `TestsWatcher`), `room-events.controller.ts`, `automation-triggers.service.ts` (`onEvent`), `realtime/events.gateway.ts`, `judge/judge.controller.ts`; `sandbox/image/gitconfig`; web `tools/automations/room-event-settings.tsx`.

**Tests:**
- `packages/contracts/src/room-events.test.ts` (11, adding the settings each event keeps, failed heard as finished, chat starts, and the API refusing a start of two lines), `sandbox/agent/src/git-log.test.ts` (6: each kind of commit, what isn't one, merges, the last twenty, the branch, and the watcher saying only what's new, a line half written, and a repository made again), `apps/api/src/automations/room-activity.test.ts` (6: what fails a Run, its output as plain text, the Tests tab's stream cut anywhere in its bytes)
- `apps/runner/test/automation-activity.e2e.mjs` (27 checks: a Run pressed over Socket.IO failing, with the file, how it ended, its output and who; a passing Run and another file not running it; failing tests with each result, passing ones not; a chat command with what follows it, other messages and a retried send not; two commits made with git in the sandbox, with their branch, kinds, messages, author and parent; the repository it made removed)
- `apps/web/test/automations.e2e.mjs` (114 checks), adding: a Run failing keeping the files asked for, the chat asking what a message starts with, and its example being a command
- Run again after it: `automation-events.e2e.mjs` 17/17

### Automations, part eleven: waiting, and approvals ✅ (2026-11-18)

**What:** n8n's Wait node, on Activepieces' own pieces: **Delay For** and **Delay Until** pause a run for a time or until a date, and the webhook piece's **Respond and Wait for Next Webhook** answers its caller and pauses until its own address is called. That address is how an approval works: send it (by Slack, email, a chat message) with `&action=approve` or `&action=reject`, and the run carries on with what was in the call, for a router to decide on.

- **Approval links**, a built-in step, make a link for each choice ("approve, reject", or your own) before the run waits, so they can be sent first (the wait's own address only exists once it has paused): the "Respond and Wait for Next Webhook" step after them waits at the same address, and gives the choice clicked as `queryParams.action` for a router. Someone clicking one in a browser gets a plain page saying their answer was passed on, or that nothing is waiting any more. The gallery has "Ask for approval before deploying" (Slack, then Netlify or a reason) and "Follow up on a new issue a day later".
- **A waiting run** is shown as "Waiting until 14:00" or "Waiting for a call to its address", not as a failure; it carries on **as the same run**, from where it stopped ("waited"), with what had run kept. One waiting for a time can be carried on now, by someone with Run rights.
- **Waiting for a time** survives the room going quiet: a sandbox stops after 15 idle minutes, so the API keeps the waits. Its 20-second timer asks rooms that ran automations in the last half hour which runs are waiting (looking doesn't wake a room), keeps those waiting for a time with the room's settings, and when one's time comes wakes the sandbox and carries it on, claimed first so two API servers don't both.
- **Waiting for a call:** the address is the API's (`/api/hooks/automations/resume/:room/:run/:token`), with a token of the run's own, checked in the sandbox and never shown in the run's details. `/sync` keeps the caller waiting for the run's answer (its last step's output, or what a step that waits again says to answer), as a webhook told to answer when the flow finishes does. Two calls at once carry it on once; a second call, or a wrong token, finds nothing (404). A webhook flow that answers when it finishes and pauses answers with what the waiting step said.
- **How:** the engine asks its server for a waitpoint; `automation/host.mjs` answers it (the address, or the time), the run ends as PAUSED, and `automation.py`'s `resume` queues it to carry on with the engine's waitpoint resume.

**Where:** `sandbox/image/automation/host.mjs` (`/v1/waitpoints`, the resume mode, approval links' address) and `builtins.mjs` (`approval_links`), `automation.py` (`waits`, `resume`, the token kept back), `apps/runner/src/server.ts` (`waits` looks without waking), `apps/api/src/runner/runner.client.ts` (the resume address, and rooms that ran automations lately), `apps/api/src/automations/automation-triggers.service.ts` (`carryOnWaits`, `resumeHook`) and `automation-hooks.controller.ts`, web `flow-view.tsx` (waiting runs, Carry on now).

**Tests:** `sandbox/image/automation/builtins.test.mjs` (15, adding Approval links against a stand-in worker); `apps/runner/test/automation-wait.e2e.mjs` (21 checks: a Delay pausing a run and saying until when; its token never shown; the room saying what's waiting; the API's timer carrying it on by itself, as the same run from where it stopped, in time; a person carrying an hour's wait on now, once; waiting for a call, a wrong token finding nothing, the call carrying it on with what was sent and the caller at /sync getting its answer; a second call finding nothing; approval links made before the wait, clicking one in a browser saying thanks and carrying the run on with the choice, and the other link then saying nothing's waiting).

### Automations, part ten: who may call a webhook ✅ (2026-11-18)

**What:** as n8n's Webhook node, a webhook can ask more of a call than knowing its secret address: **a header** with a secret value (an API key), **basic auth**, or **a signature of the body** made with a shared secret, as GitHub sends in `X-Hub-Signature-256` (`sha256=` and the HMAC-SHA256 in hex) and Shopify in base64, with the header and what comes before the signature set to suit the service.

- **On the webhook's panel,** "Who may call it" chooses, saves, and says what it asks now; a secret is typed in, kept sealed (AES-GCM, as GitHub tokens are) and never shown again ("Set: type a new one to change it").
- **The live address** refuses a call that doesn't show it (401, saying what was missing or didn't match, never the secret). **The test address** still takes it, and says whether the live one would have, so a service can be set up and its signature checked before turning it on.
- **Checked the same way every time:** comparisons take the same time whatever matches; a signature is checked against the body exactly as it came (kept for JSON, forms and text), so a body changed on the way fails.
- Headers that are the browser's or the server's (`Cookie`, `Host`, `Authorization` for a header secret) can't be chosen; a secret is at least 8 characters.

**Where:** `apps/api/src/automations/hook-auth.ts` (new), `automation-triggers.service.ts` and `automation-hooks.controller.ts`, `main.ts` (the raw body), contracts' `AutomationHookAuthInput`, web `components/room/tools/automations/hook-auth-settings.tsx` on `trigger-settings.tsx`.

**Tests:** `apps/api/src/automations/hook-auth.test.ts` (7: each kind, a header's name in any case, a signature on a changed body, GitHub's and Shopify's forms, a secret that can't be read, nothing shown back, settings refused); `apps/runner/test/automation-hooks.e2e.mjs` (37 checks), adding a signature asked for and never shown, an unsigned call and a forged one refused, a signed one run, the test address saying it would be refused, a header and basic auth, a short secret refused, and back to the address alone; `apps/web/test/automations.e2e.mjs` (106 checks), adding the panel.

### Automations, part nine: sub-flows ✅ (2026-11-18)

**What:** n8n's Execute Workflow. A built-in step, **Call a flow** (with the data steps), runs another flow in the room with what it sends, and gives what that flow's last step gave, so a long flow can be split into pieces, and one piece used by several.

- **Who may be called:** only a flow whose trigger is This room: **Called by another flow** (n8n's Execute Workflow Trigger), so a flow isn't run from elsewhere by surprise. The step offers just those; one named in the file that can't be called is still shown, to be put right. There's nothing to turn on (the API refuses it, and its panel says why).
- **Waiting** (the default), the called flow runs there and then, inside the caller's run and the time it has left, as its own run of its own flow ("Called by Caller"); its last step's output is this step's. **Not waiting,** it's queued for after, and the step gives its run's id.
- **What's stopped, and why:** a flow that can't be called; one that fails, took too long or was stopped ("Fails when called failed: No stock left"); and flows calling each other more than 5 deep, such as one calling itself. Stop stops the caller and the flow it called.
- **How:** the step asks the worker running its flow (`automation/host.mjs`), on the engine's own loopback port, which runs the called flow with a second engine and answers when it's done; the live view stays the caller's. `node:http`, not `fetch`, as `fetch` gives up on an answer after 300 seconds.

**Where:** `sandbox/image/automation/builtins.mjs` (`call_flow`), `automation/host.mjs` (`callFlow`, nested runs), `automation.py` (`find`), contracts' `room-events.ts` (`flow.called`), web `components/room/tools/automations/builtins.ts` and `error-flow-field.tsx` (`CallFlowField`, and `useOtherFlows` shared with the error flow).

**Tests:**
- `sandbox/image/automation/builtins.test.mjs` (14, adding Call a flow against a stand-in worker: waiting, not waiting, JSON typed as text, a failure's reason, and outside a run)
- `apps/runner/test/automation-subflows.e2e.mjs` (13 checks: calling and getting the last step's output, used by the next step; the called run its own, saying who called it, with the live view left alone; not waiting, queued and run after; a flow that can't be called refused and not run; a called flow's failure failing the step with its reason; a flow calling itself stopped 5 deep, with a run for each level; and a called flow refused as a room event to turn on)

### Automations, part eight: an error flow ✅ (2026-11-17)

**What:** n8n's error workflow. A flow names another under **If it fails, run** (its details, beside "What it's for"); when one of its runs fails or takes too long, that flow runs, with what went wrong.

- **The error flow** starts on This room: **Another flow fails**, so it says what it is on the chart; only such flows are offered, and one named in the file that isn't is still shown, to be put right. It has nothing to turn on (the API refuses it, and its panel says why): the failing flow names it.
- **What it gets** is what n8n's Error Trigger gives: `execution` (the run's `id`, `retryOf`, `error` with its `message` and the `step` it failed at, `lastNodeExecuted`, `mode`, what started it, and when), and `workflow` (`id`, `name`, `path`). The run says "Sync the orders failed" where others say Webhook or Schedule.
- **The failed run says so:** "its error flow ran", or why it didn't (the flow isn't in the room any more).
- **No loops, no surprises:** a step tried on its own doesn't start it, nor does a run that was stopped; an error flow that fails doesn't start another.
- **Where it happens:** in the sandbox, as n8n does it in-process: when a run ends failed, `automation/host.mjs` asks `automation.py` to queue the error flow, found by its id wherever its file is, and the worker already running goes on to it (`noWorker`, so there's never a second worker on the same queue).

**Where:** `sandbox/image/automation/host.mjs` (`queueErrorFlow`), `sandbox/image/automation.py`, contracts' `room-events.ts` (`flow.failed`, `ERROR_FLOW_EVENT`) and `automations.ts` (`errorRun`, `errorProblem`), web `components/room/tools/automations/error-flow-field.tsx`, and the error flow's note in `room-event-settings.tsx`.

**Tests:**
- `apps/runner/test/automation-error-flow.e2e.mjs` (12 checks: a failing run starting its error flow, which gets the run, the error, the step and the flow as n8n's does; the failed run saying so; a step tried alone not starting it; an error flow that fails not starting another; one that isn't there saying so; and an error flow refused as a room event to turn on)
- `apps/web/test/automations.e2e.mjs` (103 checks), adding: an error flow's trigger having nothing to turn on, and "If it fails, run"

### Automations, part seven: room events ✅ (2026-11-17)

**What:** a flow that runs when something happens in its room: files changing, a commit pushed or a pull request opened from Source control, the room published to GitHub, someone let in or leaving, the room's settings or its sandbox's image changing. n8n has nothing like it, as it isn't an IDE: "when someone changes a Python file, run the linter and post what it found", "when a commit is pushed, write release notes".

- **Choosing it:** "Change the trigger" lists **This room** first, with each event and what it means. The trigger's panel chooses the event and, for files, which ones: globs, one a line or comma-separated (`src/**/*.py`), every file when empty; a pattern outside the room says so. It shows an example of what the flow is given, with "Use it as what to send" to try it, and turns it on, as a schedule's does.
- **What the flow gets:** `event`, `at`, `by` (who, by id and name), and for files `files` (each `path`, `kind`, `change`: added, changed, renamed, moved, deleted or restored, and `from` when it moved), or the event's `data` (a commit's branch, a pull request's number and address).
- **Files changing** is seen by collab, which has each room's files open (`apps/collab/src/extensions/automation-events.ts`): what people change through their own connection, collected per file (added then edited is added; added then deleted is nothing; renamed back is nothing; many keystrokes are one change), sent 3 seconds after they stop, or at most 15 seconds after the first change. **What the sandbox writes doesn't count**, so a flow that writes files can't set itself off; nor does the server's own seeding, or another collab server's share (it counts its own).
- **The rest** come from the audit log: `AuditService.record` queues the room actions that are events.
- **Running them:** both go on one Valkey list, taken from atomically by the API every second (`AutomationTriggersService.drain`), so with several API servers each event runs once; the flows listening for it, and for files only those whose files match, run in the room's sandbox. A flow is run at most 30 times a minute by events, and says so when some were passed over. The queue is kept to 1,000, so it can't grow without end while the API is away.
- **The file wins,** as with schedules: a run sends back what the flow's file listens for now, and the trigger follows it; a flow whose trigger is no longer a room event, or listens for another one now, turns itself off and says why, rather than run for the wrong thing.
- **In the flow file** the trigger is Activepieces' webhook trigger with a `room` setting: the engine needs a piece trigger to start a run, and taken to Activepieces the flow still works, as a webhook.

**Where:** `packages/contracts/src/room-events.ts` (the events, what they give, globs); `apps/collab/src/extensions/automation-events.ts`; `apps/api/src/audit/audit.service.ts`, `apps/api/src/automations/automation-triggers.service.ts` (`drain`, `onEvent`, `runTriggered`, shared with schedules) and `RoomsRepository.userNames`; `sandbox/image/automation.py` and `automation/host.mjs`; web `components/room/tools/automations/room-event-settings.tsx`, "This room" in `step-picker.tsx`, `newRoomEventTrigger` in `model.ts`.

**Tests:**
- `packages/contracts/src/room-events.test.ts` (7: globs, several at once, folders, settings that can't be used, reading a flow's event) and `apps/collab/src/extensions/automation-events.test.ts` (8: only a person's own connection, every kind of change with who, the sandbox's and the server's not counting, changes that cancel out, deleted paths, many keystrokes as one, the event queued once the edits stop, and a long stream still sent)
- `apps/runner/test/automation-events.e2e.mjs` (17 checks: a person's edits through collab, as a browser makes them, running a flow with the files it listens for and who; other files and the sandbox's changes not running it; many edits as one run; the room's settings changing, from the audit log; a flow listening for another event now turning itself off and not running; what can't be used refused)
- `apps/web/test/automations.e2e.mjs` (101 checks), adding: the room's events among the triggers, its panel in place of the webhook's, a pattern outside the room, the example used as what to send, turning on and what it listens for, and forgetting it

### Automations, part six: schedules ✅ (2026-11-17)

**What:** a flow that runs by itself at set times, as n8n's Schedule Trigger, with nobody in the room. The trigger is Activepieces' own schedule piece, already in the image: every few minutes, every hour, day, week or month, or a cron expression, each with its timezone.

- **The panel** (the trigger's, under "Starting by itself") shows the cron the settings come to and the next three times, on the schedule's own clock, says plainly what's wrong with a cron that can't work (a minute of 61, 30 February, a timezone that isn't one), and turns it on. On, it says when it next runs and last ran. Changing the settings while it's on changes when it runs, once the typing stops.
- **What the flow gets** is what the schedule piece gives: `cron_expression`, `timezone`, and `scheduled_at`, the time it was for.
- **The timer** is in the API, every 20 seconds (`AUTOMATION_SCHEDULE_TICK_MS`): each flow whose time has come runs once. Each time is claimed in Valkey first (`SET NX`), so with several API servers only one runs it, and when it ran is kept with the room, so a restart doesn't run it again. A time missed by more than 10 minutes, with the server down, isn't made up, as n8n doesn't; nothing from before it was turned on runs. The room's sandbox is started for it.
- **The file wins:** the flow is a file anyone can change, by hand or with git. A run sends back the schedule the file has now, and the next time goes by that. A flow whose trigger is no longer a schedule, or that's gone, turns itself off and says why; turning it on again forgets that.
- **Cron** is our own, small and tested (`packages/contracts/src/schedule.ts`), as nothing in the API read cron and no package was added: five fields, lists, ranges, steps, names, `@daily` and the like, either day field matching as in Vixie cron, on a timezone's clock. On the night clocks go forward, a time that doesn't exist is passed over; when they go back, one that happens twice runs twice. The API and the panel use the same code, so the times shown are the times it runs.

**Where:** `packages/contracts/src/schedule.ts` (and `automations.ts`: the `schedule` kind); `apps/api/src/automations/automation-triggers.service.ts` (`tick`, `runScheduled`) and `RoomsRepository.withSetting`; `sandbox/image/automation.py` (only while it still starts on a schedule, and sending its schedule back) and `automation/host.mjs` (the schedule piece's output); web `components/room/tools/automations/schedule-settings.tsx`.

**Tests:**
- `packages/contracts/src/schedule.test.ts` (16: reading cron and its mistakes, timezones, weekdays and either day field, 29 February and a cron that never comes, the clocks changing both ways, the piece's six triggers, and what's due: once, the latest of several missed, none from long ago or from before it was on)
- `apps/runner/test/automation-schedules.e2e.mjs` (22 checks, about three minutes, as cron counts in whole minutes: a second API of its own runs its timer every second beside the dev API's, so each time is wanted by two servers; it runs by itself, once each time, with what the schedule piece gives; the file's schedule changed by hand is followed; a flow no longer on a schedule turns itself off and doesn't run; schedules that can't be used are refused)
- `apps/web/test/automations.e2e.mjs` (93 checks), adding: the next times shown, a wrong cron saying why and not turning on, turning on and when it next runs, changing its times while on, and forgetting it

### Automations, part five: turning a flow on, with webhooks ✅ (2026-11-17)

**What:** a flow that starts by itself when something calls it, as n8n's Webhook node: GitHub, a CI job or a form sends to its address, and the flow runs in the room's sandbox, with nobody in the room.

- **Turning it on** is on the trigger's panel: it gets a **live address**, which runs the flow, and a **test address**, which runs nothing and shows what was sent, with "Use it as what to send", to set the flow up with real data. It can be turned off and on, given a **new address** (the old one stops at once), or forgotten.
- **What the flow gets** is what Activepieces' webhook trigger gives: the body (JSON, a form, or plain text), the headers without cookies or what the proxies add, and the query, with any method.
- **Answering:** at once, with the run's id (202), or when the flow finishes, with what its last step gave (or 500 and why it failed), waiting up to 30 seconds.
- **The run** says a webhook started it. A flow whose file has moved is still found, by its own id; one that's gone says so.

**Kept safe:**
- The address's token is the secret, as with Slack's and GitHub's incoming webhooks: only its hash is matched against, in constant time, and the token itself is sealed (AES-GCM, as GitHub tokens are), so people who can run the room's code can see the address again. A wrong address, another room's, or one for an interview room finds nothing (404), and says nothing about the room.
- Each address takes 60 calls a minute; a room can have 10 flows turned on; bodies are up to 1 MB.
- Turning on, changing and forgetting need Run rights, and each goes in the audit log.

**Where:**
- **API:** `apps/api/src/automations/` (`automation-triggers.service.ts`; `automation-triggers.controller.ts` for `/api/rooms/:id/automations/triggers`; `automation-hooks.controller.ts` for the public `/api/hooks/automations/:room/:token` and its `/test`), the bodies webhooks send in `main.ts`, and `RoomsRepository.setSettingEntry`. Triggers are kept in the room's settings, one entry each, changed in one statement so two people changing different ones don't undo each other: no migration.
- **Sandbox:** `automation.py` finds a flow by its id when its file has moved, and passes the headers and query on; `host.mjs` gives them to the engine.
- **Web:** `components/room/tools/automations/trigger-settings.tsx`, on the webhook trigger's panel.

**Left** (in `docs/pending.md`): an error flow, sub-flows, waiting and approvals, forms and chat, and a webhook checking a signature besides its address.

**Tests:**
- `apps/runner/test/automation-hooks.e2e.mjs` (28 checks, the whole way: turned on through the API and called from outside, with Activepieces' engine running it; the test address showing what it was sent, without cookies, and running nothing; answering when finished with the last step's output, the query and a header; the run saying a webhook started it; answering at once; a form, plain text and GET; turned off; a new address and the old one stopping; a moved file still found; wrong addresses and another room's; someone signed out; too many calls; and forgetting it)
- `apps/web/test/automations.e2e.mjs` (87 checks), adding: turning on, the address, a test call shown and used as what to send, a call from outside running it and showing as "Webhook", and forgetting it

### Code tours ✅ (ChatGPT 21, checked 2026-11-18)

**What:** a guided walk through the room's code, as CodeTour does in VS Code: a tour is stops, each at lines of a file with a title and a note in Markdown. **Tours** is beside the code (Apps, "Beside the code").

- **Making one:** "Add this line to a tour" (or the selected lines) from the editor's right-click menu and the palette asks which tour, or a new one, and the stop's title and note. Stops are edited, reordered (dragging, or the keyboard as on the task board) and removed in the tool.
- **Playing one:** each stop opens its file at its lines, marked in the editor with the note beside them; Next and Back (the keyboard too), and "Stop 3 of 8". Playing is each person's own: one person's place moves nobody else.
- **Stops follow the code:** a stop keeps its file by id (so renames and moves keep it) and its lines as Yjs positions, so text added above moves it with them. A deleted file, or lines wholly removed, says so and can be skipped, rather than landing on other code.
- **Together:** one `room:ID:tours` document. Each tour and stop is its own map, ordered by rank with the id to break ties, so two people adding stops at once both keep theirs. Collab lets only those who can edit files change it: a viewer plays tours, sees no controls to change them, and a forged change is refused and not kept.
- **Where:** `packages/workspace-model/src/tours.ts`; web `components/room/tools/tours/` and `editor/tour-marks.ts` (the action and the marked lines), wired in `wire-editor.ts` and `overlays.tsx`.
- **Tests:** `packages/workspace-model/src/tours.test.ts` (with the package's 68), browser `apps/web/test/code-tours.e2e.mjs` 20/20 (two people, a stop following its lines, a deleted file, removed lines, a viewer refused by collab, cleaned up even on failure). Run here: 68/68, then 20/20. One run failed to give test2 back their editor role while the dev API was restarting (another change was being written); it was put back by hand, and the next run passed.
- **Looked at in a browser** (2026-11-19, light and dark: the add-stop dialog, the panel, a tour playing). **Fixed then:** the stop's lines were painted solid orange, with orange code on them hard to read, as Monaco takes a decoration's class apart at "/" and `bg-brand/15` became `bg-brand`; they're now classes of their own (`cc-tour-line`, `cc-tour-gutter` in `app/globals.css`), a light tint with a line beside it. `code-tours.e2e.mjs` 20/20 after.
- **Left** (pending.md): putting a stop whose lines are gone on other lines, import and export, undo for a deleted stop.

### The task board ✅ (ChatGPT 15, checked 2026-11-08)

**What:** one board per room, with **To do**, **Doing** and **Done**. Some cards are written by hand; the rest are the `TODO`, `FIXME`, `HACK` and `XXX` comments in the room's code, which turn up by themselves and open their line when clicked.

- **The document:** `room:ID:tasks`, a single kind. Each card's column and order are one value, and its title, description and assignee each have their own key, so two people moving different cards, or one moving and one editing, both keep what they did. Collab's existing rule covers it: writing needs `files.edit`, so viewers read.
- **Cards from the code** aren't written to the document: each browser works them out and merges them into what it shows, so several people with the board open don't each add the same card. Only a code card that someone moves or assigns is kept, under a key made of the file's id, the marker and the text, so it survives lines moving. When its comment goes, a card in Done disappears quietly, and one in Doing stays, marked "No longer in the code", until someone removes it.
- **The scanner** (`scanCodeTasks`) is a small lexer that knows each language's comments (`//`, `#`, `--`, `/* */`, `<!-- -->`, `%`, `;`) and skips strings, Rust lifetimes and C++ digit separators. It yields every 4096 characters, and the board scans in 5 ms slices, so typing never waits. Files too big for search are skipped and counted, and at most 500 code cards show.
- **Moving:** dragging, the Move menu, or Left and Right on a focused card, with the change read out.

**Where:** `packages/workspace-model/src/tasks.ts`, `apps/web/components/room/tools/tasks/` (`tasks-tool.tsx`, `use-code-tasks.ts`, `connection.ts`, `task-editor.tsx`).

**Checked:** the code and the tests were read against the brief; typecheck and lint are clean.

**Left for later** (in `docs/pending.md`): a change rescans every file, rather than just the one that changed; two identical TODOs in one file show as one card; deleting a card has no undo.

**Tests:**
- `packages/workspace-model/src/tasks.test.ts` (17: comment styles, words in strings and names, keys when lines move, two people moving cards at once)
- `apps/web/test/task-board.e2e.mjs` (21 checks, two people: adding, dragging, the keyboard and the Move menu, an edit and an assignment at once, filters, a typed TODO becoming a card and opening its line, Doing and Done when the comment goes, a viewer, and collab refusing a viewer's write)
- `a11y.e2e.mjs` includes the board

### Explain this data ✅

**What:** a button on a query's results and on a notebook's table. A model shown rows guesses at sums and averages and only sees a few of them, so DuckDB works out the numbers and the model explains them.

- **The numbers (`sandbox/image/summarize_data.py`, in the sandbox, inside the jail):** DuckDB works out each column's type from the text, and `SUMMARIZE` gives its range, mean, spread, quartiles, distinct values and empties. Plain SQL adds exact duplicates, outliers beyond 1.5 times the interquartile range, common values and strong correlations. Column names are quoted, so one can't become SQL.
- **Where from:** the rows a query returned, or a pandas table read from the notebook's HTML output, which drops the "..." row pandas leaves in the middle of a long one. Up to 5,000 rows.
- **The answer (mode `data`):** the prompt says the numbers are correct and not to work out its own, to say when they don't cover every row, that a correlation isn't a cause, and to give next steps in SQL or pandas. A few rows go with them, to show what the data looks like: the button says so. Secrets are taken out on the server, and the data can't close its section.
- **Checking it:** "The numbers it was given" sits under the answer, with DuckDB's version and each column's numbers. Questions after it keep the same numbers. The mode only appears once started from a table, and has no "Apply to file".
- **Who may:** `POST /api/rooms/:id/data/summary` needs `code.run`, the button also needs `room.chat`, and neither is for interview rooms.

**Rebuilding:** both sandbox images need it.

**Not included:** summarizing a whole table beyond the rows returned, which would need its own query for each kind of database.

**Tests:**
- `packages/contracts/src/data-summary.test.ts`, `apps/runner/src/data-summary.test.ts`, `apps/api/src/ai/prompts.test.ts`
- `apps/runner/test/data-summary.e2e.mjs` (21 checks with real DuckDB, the mean worked out in the test to compare: types from text, an outlier, duplicates, empties, a strong correlation, awkward names, a name trying to be SQL)
- `apps/web/test/explain-data.e2e.mjs` (19 checks, a real SQL result and a real pandas table from a real kernel, the model stood in for)
- Tried against the real `gemma4:e4b`: 62 rows, and the empties, outliers, duplicates and city counts it gave were DuckDB's
- `a11y.e2e.mjs` includes the numbers

### Traces ✅

**What:** "AI calls" in the Prompts tool. Every call to the AI from a room, from the AI panel, the Playground or code in the sandbox: who made it, its model, tokens in and out, time to the first word and in all, whether it worked, and what was said.

- **Kept:** in the `ai_traces` table (migration 0015, a new table only), for `AI_TRACES_DAYS` (14, and 0 keeps none). Text has secrets taken out and is cut to 16,000 characters. An image isn't kept, only that there was one, and what's embedded is only counted, as it can be a whole project. Inline completions aren't traced: they come many to the minute and there's nothing to read.
- **Who can read what:**
  - **Someone's conversation is theirs,** as it is in the panel. Anyone in the room sees that it happened and what it cost, but only they can read it, and for anyone else a failure's message is only "It failed", as it can quote what was sent.
  - **Code in the sandbox** isn't anyone's, so whoever can run code there can read its calls.
  - **This goes by where a call came from, not by having no person:** deleting an account empties the column, and that mustn't hand someone's conversation to the room. A test holds this, including against the room's owner.
- **Not in interview rooms:** an interview keeps its own record, and this shouldn't be another about a candidate.
- **Real tools:** with `AI_TRACES_OTLP_URL`, each call also goes out over OTLP/HTTP with OpenTelemetry's names for AI calls (`gen_ai.request.model`, `gen_ai.usage.input_tokens` and so on), which Jaeger, Langfuse and Phoenix read. Only models, tokens and times go, unless `AI_TRACES_OTLP_CONTENT=true`, as prompts then leave this server. It never holds up a call: failures are only logged.

**Tests:**
- `apps/api/src/ai/traces.test.ts`
- `apps/api/test/traces.e2e.mjs` (25 checks, its own API with a stand-in model and tracing tool: each kind of call, times and tokens, secrets, who can read what, someone who has left, spans without what was said)
- `apps/web/test/traces.e2e.mjs` (18 checks, the list stood in for)
- Tried against real Jaeger: a call's span arrived with its model and tokens, and without its prompt
- `a11y.e2e.mjs` includes the view with a call open

### The MCP tool ✅

**What:** a tool for people building or using MCP servers: add one, see the tools, resources and prompts it offers, and try them, without connecting it to an AI first.

- **The real tool:** the official MCP Inspector's command line (`sandbox/image/mcp-inspector/`, from a lockfile with no install scripts, 111 MB, in both images). `apps/runner/src/mcp.ts` runs it inside the jail like a Run, from `/workspace`.
- **Servers** are in `.mcp.json` at the room's root, the file other MCP tools read, so it's edited together, kept in git and usable elsewhere. A command is started for each call and keeps nothing between them. An address is a server that's already up, in a terminal say.
- **The tool (`tools/mcp/mcp-tool.tsx`):** a form from each tool's input schema (text, number, switch, choice, and JSON for the rest), its answer in words with all of it as JSON beneath, and resources and prompts likewise. "Try an example" adds a small server with no dependencies, written here, to try it on and start from.
- **Getting it right:**
  - **Values** go as JSON, so the text `123` stays text.
  - **Names** go as `--tool-name=x`, so one starting with a dash can't be taken for an option. A server's name can't start with one at all, and only six methods are allowed.
  - **A tool's failure is an answer:** the Inspector exits with a failure but still prints it, so what it printed is read first.
  - **Its complaint about a keychain**, which a sandbox doesn't have, is never given as the reason.
- **Who may:** `POST /api/rooms/:id/mcp` needs `code.run`, as it starts programs in the sandbox, and isn't for interview rooms. It waits for the edits the browser has seen, so a server added a moment ago is there.

**Rebuilding:** both sandbox images need it.

**Not included:** connecting a room's servers to the AI panel, and HTTP servers needing sign-in.

**Tests:**
- `packages/contracts/src/mcp.test.ts`, `apps/runner/src/mcp.test.ts`, `apps/web/components/room/tools/mcp/config.test.ts`
- `apps/runner/test/mcp.e2e.mjs` (21 checks, the real Inspector and a real server: types kept, awkward text whole, a tool's failure, a server that won't start or crashes, names that look like options, the room's folder and user with no server secrets)
- `apps/web/test/mcp.e2e.mjs` (25 checks in a browser, all the way to the sandbox, with nothing stood in for)
- `a11y.e2e.mjs` includes the tool

### Ask the codebase (RAG) ✅

**What:** a mode in the AI panel. A question is searched for in the room's files first, and the model answers from what's found, citing each place. A model can't hold a whole project, and answers from what it can't see are guesses.

- **Search (`sandbox/image/codebase_search.py`, in the sandbox, inside the jail):**
  - **Passages:** lizard finds whole functions where it knows the language, with overlapping windows of lines for the rest, and documents too.
  - **Index:** a DuckDB file in the room's home, so it outlives the sandbox. Only files whose hash changed are read again, and a removed file goes.
  - **By meaning:** an embedding for each passage, compared by cosine similarity. It's the room's model through the AI gateway, so the sandbox still has no network and no key.
  - **By words:** DuckDB's BM25 (`fts`, baked into the image, as sandboxes can't download it), with the words inside identifiers, so `parseConfig` is found by "parse config".
  - **Together:** reciprocal rank fusion, as the two kinds of score can't be compared.
- **Secrets:** `.env` and key files are never read, and neither are installed packages. gitleaks runs over changed files first, and lines it finds are replaced before anything is stored or sent. If it can't run, nothing is read. Secret-shaped text is taken out again in the sandbox, and once more on the server.
- **Embedding model:** `AI_EMBEDDING_MODEL`, or with Ollama, a pulled model with "embed" in its name (`nomic-embed-text` here). Those are left out of the Playground, as they can't answer a prompt. Without one, or if it fails, it searches by words and says so. Changing the model embeds everything again.
- **The answer:** the prompt says to answer only from the passages, to say when they don't answer it, and to cite `path:line`.
  - Citations open the file.
  - A file that isn't there, or a place it wasn't shown (`citationsNotShown`), is flagged under the answer.
  - "What it read" shows each passage, how it was found, and opens it.
- **Who may:** `POST /api/rooms/:id/ai/retrieve` needs both `code.run` and `room.chat`, and isn't for interview rooms. The mode isn't offered otherwise.
- **Also fixed:** the AI panel could drop a question when what it waited for finished before its "preparing" state had caught up.

**Rebuilding:** both sandbox images need it.

**Not included:** code-aware parsing beyond functions (classes as units, say), and re-ranking with a second model.

**Tests:**
- `packages/contracts/src/rag.test.ts`, `apps/runner/src/rag.test.ts`, `apps/api/src/ai/prompts.test.ts`, `gateway.test.ts`, `ai.config.test.ts`
- `apps/runner/test/rag.e2e.mjs` (23 checks with real embeddings: an identifier found first, a meaning found with no word in common, fresh secrets and `.env` appearing nowhere, only changed files read again, a removed file gone, no model, a wrong model and recovering, two searches in turn)
- `apps/web/test/ask-codebase.e2e.mjs` (27 checks, search and model stood in for)
- Tried from a browser through to `gemma4:e4b` and `nomic-embed-text`: the search took 2 seconds, the answer about a minute, and the planted key wasn't in what was sent
- `a11y.e2e.mjs` includes what it read

### Evals ✅

**What:** "Test it" in the Prompts tool. Say what a good answer looks like, and check it every time the prompt changes. The checking is done by **promptfoo**, the standard open-source tool for this, in the room's sandbox, through the AI gateway.

- **Test cases** (up to 30, in the `prompts` document, edited together): each fills in the prompt's variables, using the prompt's own value when a case hasn't one, and has up to 10 checks: contains, contains in any case, doesn't contain, is exactly, matches a pattern, is JSON, contains JSON, JavaScript, the AI agrees that (`llm-rubric`), answers within a time.
- **Results:** a score for each column (passed, average time, tokens), a pass or fail in words for each case on each column, and when one's opened, which check failed, why, and the answer that failed it.
- **What changed:** each run says how many are newly failing or fixed since the one before, marks those cells, and says whether the prompt was different. The last 6 runs are kept with the prompt they used.
- **The real tool:** "Copy the promptfoo config" gives the same config to save and run with `promptfoo eval` in a terminal, as `promptfoo` is on the PATH in every sandbox.
- **Runner (`apps/runner/src/evals.ts`, `POST /rooms/:id/evals`):** the config and results live in a folder of `/tmp` for the length of the run, so nothing lands in the room's files, and telemetry and update checks are off. One run at a time in a room, up to 30 minutes. It streams how many calls have gone through, counted at the gateway. Stop ends promptfoo and removes the folder. The parser keeps named fields only, as promptfoo repeats the whole prompt in every result.
- **API (`POST /api/rooms/:id/evals`):** needs both `code.run` and `room.chat`, and isn't for interview rooms.
- **The image:** promptfoo comes from a lockfile (`sandbox/image/promptfoo/`), so all its packages are checked against their hashes, with no install scripts. Leaving out its optional extras takes it from 734 MB and 617 packages to under 270 MB, and it peaks at about 200 MB of memory, within a room's limit. It went in both images.
- **Limits to know:** models here use temperature 0 and at most 1,024 tokens unless a column says otherwise (promptfoo's defaults). A large set of evals can use up the room's gateway limit (120 requests per 10 minutes), which the tool shows by counting calls first.

**Tests:**
- `packages/contracts/src/evals.test.ts`, `apps/runner/src/evals.test.ts` (parsing a report shaped from real output), `apps/web/components/room/tools/prompts/evals-model.test.ts`
- `apps/runner/test/evals.e2e.mjs` (19 checks, the real promptfoo and the real model: checks passing and failing, a value with quotes and newlines arriving whole, JavaScript, the AI judging, a second run refused, Stop leaving no folder and no process)
- `apps/web/test/evals.e2e.mjs` (35 checks, two people, promptfoo stood in for)
- Tried from a browser through to `gemma4:e4b`: 4 cases on 2 columns, 10 calls, 21 seconds
- `a11y.e2e.mjs` includes the view with its results

### AI gateway ✅

**What:** code in a room's sandbox calls the room's model as if it were OpenAI, so real SDKs and tools work (`pip install openai`, `OpenAI()`, nothing else). It's the way in for Evals and RAG too. The sandbox still has no network and holds no key.

- **The way out:** the sandbox's agent listens on `127.0.0.1:3129` (`sandbox/agent/src/gateway.ts`) and carries each connection over its stdio to the runner (`gw_open`, `gw_data`, `gw_closed`). The runner serves them with an HTTP server that never listens (`apps/runner/src/gateway.ts`), and passes `GET /v1/models`, `POST /v1/chat/completions` and `POST /v1/embeddings` to the API with a service token for that room. **The room comes from which sandbox's channel a call arrived on**, so nothing the code sends can change it.
- **In the sandbox:** `OPENAI_BASE_URL`, `OPENAI_API_BASE` and a placeholder `OPENAI_API_KEY` (SDKs won't start without one) are in every terminal and Run. The door isn't shown in the Ports panel and can't be reached through a preview, for the package relay too.
- **API (`apps/api/src/ai/gateway.controller.ts`, `gateway.ts`):**
  - Only a service token for the API gets in, and Caddy answers 404 for `/api/internal/*`.
  - **Models:** only those on offer (the Playground's list); `default` means the server's own.
  - **What goes on:** a fixed list of fields, so `store`, `service_tier` and the like don't. One answer per request, and limits on `max_tokens`.
  - **What comes back:** a provider's answer as it came. Its failures are cleaned so they can't carry the key, and a refused key is reported as the server's problem.
  - **Streams** pass through as they come. Usage is read from them for the room's count, and a usage-only chunk goes only to code that asked for it: plenty of code reads `chunk.choices[0]` without checking.
  - **Claude** doesn't speak this format, so it goes through a plain text adapter that refuses `tools` and images, rather than quietly dropping them. It hasn't been tried against the real service.
- **Who may:**
  - **The limit is the room's** (`AI_GATEWAY_RATE_LIMIT`, 120 requests per window; 0 turns the gateway off), as anyone's code in a room comes through here, and a loop should stop quickly. Tokens count towards the room's creator.
  - **Interview rooms:** refused unless the interviewer has allowed the AI, when each call is noted in the sitting's record. Without this, code could get round "AI off".
  - **Demo rooms and archived rooms:** refused.
  - A throwaway judge container has no agent, so hidden tests can't reach it.
- **In the Prompts tool:** "Use it from code" shows the current prompt as Python, JavaScript or curl, with its variables filled in and no key.

**Rebuilding:** both sandbox images need it (`pnpm sandbox:build`, `pnpm sandbox:build:full`). The container config went up, so rooms get the new agent on next use, and their files and home survive.

**Tests:**
- `sandbox/agent`, `apps/runner` and `packages/auth` unit tests, `apps/api/src/ai/gateway.test.ts` (20)
- `apps/api/test/gateway.e2e.mjs` (31 checks, its own API and a stand-in provider: who gets in, exactly what the provider is sent, the key never coming back, the rooms refused, a loop stopped)
- `apps/runner/test/gateway.e2e.mjs` (14 checks from inside a real sandbox with the real model). With `REAL_SDK=1`, 5 more: OpenAI's own Python library installed with pip, then listing models, answering, streaming and showing a refusal, with no settings of its own
- `runner.e2e`, `network.e2e` and `dev.e2e` pass with the new agent

**Not done:** it hasn't been run on the Kubernetes driver, as the cluster here doesn't have the images loaded (in `docs/pending.md`).

### Prompt Playground ✅

**What:** the Prompts tool. People write a prompt together, try it on several models and settings side by side, and see each answer's tokens and speed. It's what LangSmith's or OpenAI's playground does, kept in the room.

- **The prompt:** a system prompt, a conversation of user and assistant messages, and `{{variables}}` that get a field as soon as they're typed (the same way promptfoo writes them, ready for Evals). Everything's in the room's `prompts` document, so two people can type in the same field.
- **Columns (up to 4):** each with its own model, temperature, token limit and JSON switch. Each shows its answer with the time to the first word, the time in all, tokens in and out, and tokens a second, which leaves out the wait for the first word. JSON answers are checked.
- **Runs:** the last 12 of each prompt are kept with the prompt they used. One can be opened, and its prompt brought back with "Use this prompt". The table says which runs differ from the prompt as it is now. Someone who can't edit can still try it, but their run isn't kept.
- **Server (`POST /api/rooms/:id/ai/prompt`, `GET .../ai/models`):**
  - The prompt goes exactly as written, with nothing of ours. It needs `room.chat`, follows the interview rule for candidates, and each column counts against the person's AI limit.
  - **Only models on offer run**, as a paid provider's others would be on the owner's bill: `AI_MODEL`, those in `AI_PLAYGROUND_MODELS`, and with Ollama whatever's been pulled.
  - The model and settings reach the provider through `ModelRequest.tuning`. Every AI answer now reports its timing, and Ollama's report real token counts instead of an estimate.
- **Comparing fairly:** with Ollama, columns run one after another, as sharing one machine would make each look slow. A warning shows when a prompt is longer than the server's context setting, since a local model loses its start silently.
- **Not in interview rooms.** Closing the tool stops a run.

**Tests:**
- `packages/contracts/src/prompts.test.ts`, `apps/web/components/room/tools/prompts/model.test.ts`, `apps/api/src/ai/ai.config.test.ts`
- `apps/api/test/prompts.e2e.mjs` (29 checks, its own API and a stand-in model: exactly what the model is sent, models not on offer, the limit)
- `apps/web/test/prompts.e2e.mjs` (34 checks, two people)
- Tried against the real `gemma4:e4b`: two columns in 43 s, Ollama's own token counts, about 10 tokens a second
- `a11y.e2e.mjs` includes the tool with a prompt and its answers

### Code analysis and the AI's project review ✅

**What:** an Analysis tool that runs real tools over the room's files, and a review by the AI that starts from what they found. A model can't take in a whole project and guesses at numbers, so tools measure and the model explains.

- **The tools**, in the sandbox image at pinned versions with checked downloads (a stage of `sandbox/image/Dockerfile`, Python's from `analysis-requirements.txt` with hashes):
  - scc: lines and languages
  - lizard: complexity of each function
  - gitleaks: secrets, with `--redact=100`, and a config of its own in `gitleaks.toml`
  - bandit: Python security, when there's Python
  - pyright, ruff and tsc: through the existing Check all files
- **Runner (`apps/runner/src/analysis.ts`):** they run inside the room's jail with no network and a time limit, one analysis at a time per room. The parsers keep named fields only, so a secret's value can't pass through, and bandit's password rules (which quote the value) get a fixed message. A tool that's missing, times out or fails says so in the report: it can't read as a clean project.
- **API:** `POST /api/rooms/:id/analysis`, needs `code.run`.
- **Tool (`tools/analysis/analysis-tool.tsx`):** tiles, then Secrets, Security, Errors and warnings, the most complex functions and Languages. Each place opens the file at that line. It stays for 30 minutes after closing, and isn't in interview rooms.
- **Project review (`packages/contracts/src/ai-analysis.ts`, mode `project`):**
  - **What's sent:** the tools' results as facts, what the file list shows (no tests, no README, no lockfile, no CI, generated files in the project), the tree, up to 12 key files (README, manifest, setup, entry points, then source) and outlines of the rest, cut to the model's context by the server.
  - **Secrets:** `.env` and key files are never read. Anything shaped like a secret is taken out in the browser and again on the server. Only the file and rule go, from gitleaks.
  - **Keeping the model honest:** it's told the facts are correct and which files it hasn't read. Paths in an answer open the file, and ones that aren't in the project are named underneath, so a made-up file is visible.
  - **Running:** the panel runs the tools first if there's no result under 10 minutes old. Without rights or a sandbox it goes on from the files alone and says so.
- **Also fixed:** `GET /api/rooms/:id/repo` answers 204 for a room that isn't linked to GitHub, instead of a 404 in the console of every room opened.

**Rebuilding:** both sandbox images need it (`pnpm sandbox:build`, `pnpm sandbox:build:full`). Rooms on an older image get a note saying so, not a clean report.

**Not included:** Opengrep, until its rules' licence is checked.

**Tests:**
- `apps/runner/src/analysis.test.ts` (parsers, from the tools' real output)
- `packages/contracts/src/ai-analysis.test.ts`
- `apps/api/src/ai/prompts.test.ts`: the project's sections, secrets the browser let through, a file trying to close its section, a small model's context
- `apps/runner/test/analysis.e2e.mjs` (22 checks, a fresh random secret appears nowhere in the report) and `apps/web/test/analysis.e2e.mjs` (24, a stand-in model, checking what it's sent)
- Tried against the real `gemma4:e4b`: about a minute, the right files and lines, no secret in the request or the answer, no invented file
- `a11y.e2e.mjs` includes the tool (99 checks)

### Deeper collaboration

- ✅ **Multiplayer debugger:** done for Python, C, C++, Go, Java, JavaScript and TypeScript (section 14 A, Debugger)
  - ✅ breakpoints everyone sees, stepping together, and a shared variables and call-stack view
  - ✅ Debug Adapter Protocol in the sandbox: debugpy for Python, gdb for C/C++, Delve for Go, js-debug for Node (JavaScript and TypeScript), java-debug for Java
- ⬜ **Suggestion mode:**
  - edits become proposals that the file's owner accepts or rejects, like "Suggesting" in Google Docs, but for code
  - built on Yjs, so proposals merge like any edit
- ⬜ **Room branches:**
  - fork the room's files into a branch and experiment without disturbing others
  - merge back through a 3-way merge view with conflict resolution
- ⬜ **Live authorship:**
  - lines tinted by who wrote them (a person, or the AI in its own typeface)
  - "who wrote this and when" on hover, taken from the Yjs history; no git needed
- ⬜ **Session recording and replay** for any room: scrub a timeline of edits, runs and chat, and share a moment by link.
- ⬜ **Smarter calls:** live captions, AI meeting notes with action items, and follow-the-speaker's cursor.

### Developer tools inside the room

- ⬜ **Test explorer:** live results for pytest, Vitest/Jest and JUnit, with coverage shown in the editor gutter for everyone.
- ⬜ **Profiler:** a CPU flame graph for any run (py-spy, `node --cpu-prof`), shown in the browser.
- ✅ **Database playground:** done as one-click databases, SQLite and DuckDB files (§14 D).
- ✅ **HTTP client:** done as the API studio (§13), which reaches the room's own servers too.
- ⬜ **Package manager:** search npm and PyPI and add a dependency in one click (through the network switch).
- ✅ **Problems panel:** done in §14 A (Problems, and Check all files).
- ⬜ **Room secrets:** encrypted environment variables injected only into runs. They never appear in files, chat or history.
- ⬜ **Share a deploy preview:** publish the room's web app at a public link that stays up after the room closes.

### Advanced AI

- ⬜ **Ask the codebase:** semantic search over the room's files (pgvector embeddings), answers that cite files and lines.
- ⬜ **AI team:** agents with roles (builder, reviewer, tester) work on one task and review each other; you approve the result.
- ⬜ **Natural-language terminal:** describe what you want, see the command it proposes, and approve it before it runs.
- ⬜ **Generate tests and docs** for a file or a selection, run them in the sandbox, and keep only the ones that pass.
- ⬜ **AI code review** of the room's changes before they become a GitHub pull request.

### Learning and events

- ⬜ **Classroom mode:**
  - teacher dashboard with every student's room live
  - assignments auto-graded by the judge
  - "broadcast my screen" to the class
- ⬜ **Contest and hackathon mode:** timed problems, a live leaderboard and judge-verified scores.

### Enterprise

- ⬜ **SSO and provisioning:** single sign-on (OpenID Connect, SAML) and SCIM for adding and removing users.
- ⬜ **Plans and billing:** Stripe in test mode, with quotas per plan.
- ⬜ **Data controls:** retention policies, "export all my data", and account deletion (GDPR).
- ⬜ **Plugin SDK:** third-party panels and commands in sandboxed iframes, through a documented message API.

### Reach

- ⬜ **Languages:** Hindi and English interface (i18n from the start of each new screen).
- ⬜ **Installable app (PWA):** offline editing that syncs when you reconnect (y-indexeddb).
- ⬜ **Mobile layout** for reviewing, chatting and following along.
- ⬜ **Embeddable read-only rooms** for blogs, docs and portfolios.

## 12. New ideas: pick what comes first

None of these is in a phase above yet. ★ marks my recommendations.

### Run and code without limits

1. ★ **In-browser runner (WebAssembly):**
   - Python (Pyodide) and JavaScript run instantly in the browser, with no server
   - works offline and on free hosting, so the demo site can run code
2. ★ **Competitive-programming helper:**
   - paste a Codeforces or LeetCode link to import the samples
   - run against every test and see ✓/✗ diffs; a custom-input box
3. **Run configurations:** saved arguments, stdin files and environment per file (like `launch.json`).
4. **Resource monitor:** live CPU and memory of the sandbox in the status bar, and a process list with Kill.
5. **Ports panel:** every server running in the sandbox, with open preview, copy link and public/private (like Codespaces).
6. **Service add-ons:** one-click Postgres, Redis or MongoDB next to the room's sandbox.
7. **More languages:** Go, Rust, Kotlin, Ruby, PHP and C# in a "full" sandbox image.
8. **Saved environments:** keep installed packages as a reusable snapshot, so the next start is instant.

### AI that teaches and interviews

9. ★ **AI mock interviewer:**
   - asks a DSA or system-design question and watches you code
   - gives hints when you're stuck and scores you at the end
10. **AI tutor mode:** hints and questions instead of answers, for learning.
11. **Complexity analyzer:** Big-O estimate for your solution, with a suggestion to make it faster.
12. **Screenshot to code:** paste an error screenshot or a UI mockup; the AI explains it or builds it.
13. **Voice coding:** say what you want ("add a loop over users") and approve the edit.
14. **Explain-on-hover:** plain-language explanation of any line, for beginners.
15. **AI commit messages** and pull-request descriptions.
16. **Architecture map:** an auto-generated diagram of files, modules and dependencies.

### Working together

17. ★ **Code tours:** a guided walkthrough (file, line, note, next) that anyone can play step by step.
18. **Line reactions:** quick 👍 ❓ 🔥 on a line; lighter than a comment, and they fade.
19. **Laser pointer:** in Present mode, the presenter's pointer and highlight are shown to everyone.
20. **Mob programming timer:** driver/navigator roles that rotate on a timer and hand over edit rights.
21. **Task board:** a Kanban board per room. TODO/FIXME comments become cards automatically.
22. **Chat power-ups:** threads, polls, voice notes (transcribed), and "turn this message into a task".
23. **Status:** "In a call", "Focusing" and "Away" (auto-detected), shown on avatars.

### Show your work (great for students and job hunting)

24. ★ **Public profile and portfolio:** your public rooms, languages, a contribution heatmap, and a shareable link.
25. ★ **Replay to GIF/MP4:** export a typing replay of a session as a video for LinkedIn and a README.
26. **Beautiful code images** (Carbon-style), shared to LinkedIn or X in one click.
27. **Template gallery:** community templates (Next.js, FastAPI, Spring Boot, DSA sets) with ratings.
28. **Streaks and badges:** daily practice streaks, solved-problem counts, achievements.

### Editor power-ups

29. **Vim and Emacs keybindings,** plus a zen mode.
30. **Markdown preview** with Mermaid diagrams and math (KaTeX).
31. **Viewers:** images, PDF, and CSV as a sortable table.
32. **Format on save** (Prettier, black, clang-format) with shared settings (`.editorconfig`).
33. **Team snippets:** a shared snippet library with tab-triggers.
34. **Minimap presence:** coloured marks on the scrollbar showing where everyone is in the file.

### Beyond the browser

35. ★ **VS Code extension:** join a CodeChatter room from VS Code, with live editing, chat and run.
36. **Browser extension:** an "Open in CodeChatter" button on GitHub repositories and LeetCode problems.

### Added from your feedback

37. ★ **Code and algorithm visualizer:**
    - step through a program and watch variables, the call stack, arrays, linked lists, trees and graphs change as it runs, like Python Tutor but live and shared with the room
    - the AI narrates each step ("i moves right because 7 > 5")
    - Python first (a tracer in the sandbox), then JavaScript, Java and C++
38. ★ **Every programming language:**
    - 40+ languages through **language packs**: toolchains in a shared read-only volume that every sandbox mounts
    - the base image stays small, a new language needs no rebuild, and more packs can be added at any time
    - syntax highlighting for 80+ languages comes from Monaco
39. **More interface languages:** Hindi and English first, then Spanish, Portuguese, French, German, Japanese, Chinese and Arabic (right-to-left).

### Your picks, and where they go

You chose 21 of the 39: 18 from the list (11 of the 12 ★), the visualizer (#37), all programming languages (#38), and more interface languages (#39). Each is scheduled next to the phase it depends on:

| When | Features |
|---|---|
| **With Phase 2** (they use the sandbox) | #4 resource monitor, #5 ports panel, #2 competitive-programming helper, #7 and #38 every language via language packs, #6 service add-ons |
| **With Phase 3** (recruiter kit) | #1 in-browser runner (so the free demo site can run code), #24 public profile and portfolio |
| **With Phase 4** (AI) | #37 visualizer, #9 AI mock interviewer, #10 AI tutor mode, #11 complexity analyzer, #12 screenshot to code |
| **With Phase 5** (collaboration tools) | #17 code tours, #21 task board from TODOs |
| **With Phase 6** (pro editing) | #30 Markdown and math preview, #29 Vim keys and zen mode |
| **With Phase 9** (platform) | #35 VS Code extension (it uses the public API) |
| **Throughout** | #39 interface languages: every new screen is written translation-ready |

The rest of this list stays available for later.

## 13. Workspace suite: Notion, Obsidian, Postman, Figma and Slack, built in ⬜

Everything a team uses around its code, inside the same rooms, with the same live collaboration (Yjs), permissions, search and AI. Each part is built here, not embedded. Every part links to the others: mention a doc in chat, embed an API request in a doc, attach a design frame to a task.

### Docs (like Notion)

The **Docs** tool is in the room's activity bar. Browser test: `apps/web/test/docs.e2e.mjs` (8/8, two people).

- 🟡 **Block editor on Yjs** (Tiptap), edited together live with name-flagged carets:
  - ✅ headings, lists, to-dos, callouts, quotes, dividers, code blocks, tables, links, and a `/` command menu
  - ⬜ toggles, runnable code blocks, images, math, Mermaid, drag-to-reorder
- 🟡 **Page tree:**
  - ✅ pages and sub-pages, icons, favourites, drag to move, trash with restore
  - ⬜ organisation-wide pages, covers, recent pages
- 🟡 **Databases:**
  - ✅ data model (`docs/database/`): property types text, number, select, multi-select, person, date, checkbox, status, relation; views table, board, calendar, gallery, list; filters, sorts, grouping; CSV
  - ⬜ the database view UI (next)
- ✅ **Templates:** meeting notes, RFC, bug report, sprint, interview kit.
- ⬜ **Embeds:** room files (live code), run output, API requests, design frames, videos, links with previews.
- 🟡 **Comments and history:**
  - ✅ comment threads on selected text, with replies and resolve; version history with preview and restore (the current version is saved first)
  - ⬜ suggestions
- 🟡 **Sharing:**
  - ✅ publish a read-only link; export to Markdown
  - ⬜ custom slugs, PDF

### Knowledge base (like Obsidian)

- ⬜ **Markdown notes** that stay plain `.md` in the room: they're real files in the sandbox too.
- ✅ **Links:** `[[wiki links]]` to pages and room files with autocomplete, **backlinks** on every page, unlinked mentions.
- ✅ **Graph view:** an interactive map of pages and the code files they link to.
- ✅ **Organising:**
  - `#tags`: Ctrl+click one, or pick it in the sidebar, to filter the page list
  - daily notes with a month calendar
  - a quick switcher (Ctrl+K) and page templates
- 🟡 **Code links:**
  - ✅ `[[src/app.py]]` opens the file
  - ⬜ line anchors (`#L10`) and hover previews
- ⬜ **Offline first:** notes are readable and editable offline, and sync when you reconnect.

### API studio (like Postman) 🟡

The **API** tool in the activity bar. Browser tests: `apps/web/test/api-studio.e2e.mjs` (8 checks, two people) and `api-studio-import.e2e.mjs` (27).

- ✅ **Collections:** folders and requests in the room, edited together live.
- 🟡 **Request builder:**
  - ✅ methods, parameters, headers
  - ✅ bodies: none, JSON, form, text, GraphQL
  - ✅ auth: Bearer, Basic, API key (in a header or the query)
  - ⬜ multipart, OAuth 2.0
- ✅ **Environments and variables** (`{{baseUrl}}`). A secret's value stays on your device and is never saved in the room.
- ✅ **Two ways to send**, with time and size:
  - **from the sandbox:** `http://localhost:<port>` reaches the server running in the room
  - **through the server:** for public APIs; private and internal addresses are blocked (DNS pinned, redirects not followed)
- 🟡 **Response viewer:**
  - ✅ pretty JSON with search, raw, headers, HTML preview, copy and download
  - ⬜ a cookies tab
- ✅ **Tests:**
  - checks: body contains, header exists, JSON value equals or exists
  - a collection runner, and history
- ✅ **Scripts** (2026-11-18), as Postman's: the Scripts tab has one to run **before sending** and one **after the response**, written together in the shared document, with snippets (set a variable, add a header, status is 200, a JSON value, save a value for the next request).
  - **What they can do:** Postman's `pm`: `pm.environment` (and `pm.variables`, `pm.globals`, `pm.collectionVariables`, all the person's own values, as values set from a response are), `pm.request` (its address, method, headers and a text body: changed for that send only, the request staying as written), `pm.response` (`json()`, `text()`, `code`, `responseTime`, headers, and `pm.response.to.have.status(200)`, `.to.be.ok`, `.to.have.header()`), `pm.test` (async too) and `pm.expect` (chai's words: `to.equal`, `eql`, `include`, `property`, `below`, `a`, `match`, `oneOf` and the rest, with chai's messages: `expected "GET" to equal "DELETE"`), and `console`.
  - **Where they show:** `pm.test` results join the Tests tab's checks (2/3 on the tab); what they log shows as **Console**, marked before or after; a script that stops says why and at which line of it. A script before sending that stops means the request isn't sent.
  - **Safe to run someone else's:** each runs in a worker inside a hidden frame of `/frames/script`, whose policy allows no network at all (the worker inherits it), no eval, and gives it an opaque origin, so it can't read the app or its cookies; the worker also takes away `fetch`, `XMLHttpRequest`, `WebSocket`, storage and nested workers. It's stopped after 5 seconds (a loop that never ends), and what it sends back is read as untrusted. `pm.sendRequest` says plainly that scripts have no network.
  - **Postman's own scripts** come with a collection only when asked: the import preview offers "Bring their scripts too" (off by default), and each request gets its collection's, folders' and own scripts in the order Postman runs them, each marked with where it came from.
  - **Fixed on the way:** the worker for this had been written but nothing ran it (`script-worker-source.ts` was dead code, and the bug list said so); the Tests tab had claimed test scripts already.
  - **Where:** `components/room/tools/api-studio/scripts.ts` (what goes in and out), `script-sandbox.ts` (the frame), `script-worker-source.ts` (the worker and `pm`), `scripts-editor.tsx` (the tab), `execute.ts` (before and after a send), `response-pane.tsx` (Console), `import-postman.ts` and `import-dialog.tsx`; `app/frames/script/route.ts` and `SCRIPT_FRAME_CSP` in `lib/csp.ts`.
  - **Tests:** `scripts.test.ts` (5: the request in and out, `pm` in a real worker context with variables, headers, logs and seven tests, no network, a mistake's line, results read safely) and `import-postman.test.ts` (scripts only when asked, in Postman's order); browser `api-studio.e2e.mjs` 20/20 (two people seeing a script, a script changing where a request goes, 2/3 tests and why one failed, the Console, no network, a loop stopped, a mistake's line, a collection's scripts offered, not taken, and run when brought).
- 🟡 **Import and export:**
  - ✅ cURL import
  - ✅ code snippets for curl, fetch, axios, Python and Go
  - ✅ **OpenAPI 3.0 and 3.1, Swagger 2.0 and Postman v2.0 and v2.1 import** (prompt 14, ChatGPT, checked here):
    - JSON or YAML, pasted or from a file, with the format worked out and a preview before anything changes. It all arrives in one new folder and one new environment, in one transaction, and never overwrites anything.
    - **A file can come from a stranger:** nothing is fetched or sent while importing, remote references are counted and skipped, reference cycles and deep chains stop, `__proto__` and its like can't change anything, YAML aliases are refused, and there are limits of 5 MB, 2,000 requests and 200 levels. Scripts aren't imported. Credentials become secret variables with no value.
    - **Tried on the real thing:** Swagger's own Petstore in YAML and in Swagger 2.0, as well as the tests' documents.
    - **Changed when checking it:**
      - `yaml` was imported through pnpm's own folder by a relative path, to avoid adding a package, which a different install could break. It's now a real dependency of the web app, at the version already in the lockfile.
      - cURL had changed: each command made a folder and an environment, switched to that environment, and lost any token in it. It's one request at the top again, and a credential leaves the shared document for a secret variable with its value on the device of whoever pasted it, so the request still works for them.
      - Secrets were found by letters anywhere in a name, so `keyword` lost its value. It's now by whole words.
      - The whole preview was read aloud on each change; now just its first line.
    - **Tests:** `import-openapi.test.ts` and `import-postman.test.ts` (27), snippets in `packages/contracts`, `a11y.e2e.mjs` includes the preview.
- ⬜ **Mock server:** example responses served at a room URL, so the frontend can start before the backend.
- ⬜ **WebSocket and Server-Sent Events** tester.

### Design canvas (like Figma) 🟡

The **Design** tool. Tests:
- browser: `apps/web/test/canvas.e2e.mjs` (13/13, with the whiteboard) and `canvas-groups.e2e.mjs` (17/17, groups with two people)
- canvas engine and PDF writer: 86/86

- ✅ **Multiplayer vector canvas:**
  - frames, rectangles, ellipses, lines, arrows, pen paths, text, sticky notes and images
  - edited live together, with presence
  - several designs per room
- 🟡 **Layers and properties:**
  - ✅ a layers panel (rename, hide, lock, reorder)
  - ✅ a properties panel; alignment and snapping
  - ✅ **groups** (ChatGPT 24, checked 2026-11-19):
    - **Making them:** Ctrl+G, or Group in the toolbar, groups what's selected, keeping their stacking order; Ctrl+Shift+G ungroups, leaving them selected. Shapes from different frames or groups aren't grouped, with a message saying why.
    - **The model:** a group is a shape (`type: "group"`) whose children have it as their `parentId`, like a frame's, but it draws nothing and doesn't clip. Its box is worked out when the canvas is read (`normalizeGroups` in `groups.ts`), never written, so two people moving its children can't leave a stale box. A group emptied (its last child deleted, here or by someone else once their changes merge) goes too. A missing or looping parent puts a shape at the top level, as a lost frame's did.
    - **Using them:** a click selects the whole group, and moving, resizing and rotating carry every child. Double-click goes in a level, shown by a dashed outline, and Escape comes back out. Hiding or locking a group hides or locks what's in it. Copy, paste, duplicate, delete and undo keep groups whole.
    - **Everywhere:** the layers panel nests them, folding and renaming; export (PNG, SVG, PDF) draws the children; a group works inside a main component and its instances; the Whiteboard has them too.
    - **Where:** `canvas/groups.ts`, `tree.ts` (`effectiveParent`, `ancestors`, `effectiveHidden`, `effectiveLocked`), `editor.ts` (grouping, `activeGroup`, emptied groups removed), `interaction.ts`, `layers.tsx`, `group-controls.tsx`, `store.ts`, `export.ts`, `shape-view.tsx`, and a button in the Design and Whiteboard editors.
    - **Tests:** `canvas/groups.test.ts` and `groups-render.test.ts` (with the rest of the canvas engine, 86/86: order and positions kept, nesting, the box following its children, the last child deleted, copy and paste, undo, two documents at once), and `apps/web/test/canvas-groups.e2e.mjs` (17/17: two people, Ctrl+G, the other moving the group, double-click, ungroup and undo, exports, a grouped component's instance).
    - **Checked by Claude:** the diff read against the brief; its tests run again, and the canvas's own (13/13: it moved that test onto the apps menu, where its buttons had gone); accessibility 164/164. Looked at in a browser, light and dark. Fixed:
      - nothing showed which group you'd gone into, once the pointer left it: now a dashed outline (`overlay.tsx`);
      - the opacity box cut "100" to "1(" in every shape's properties (`properties.tsx`, from before).
    - **To watch:** each change (each step of a drag too) scans the whole canvas for groups left empty: fine at today's sizes, worth a cheaper check on very large canvases.
- 🟡 **Components and styles:**
  - ✅ reusable components with instances and overrides
  - ⬜ variants, shared colour and text styles
- ✅ **Auto layout** for frames.
- ⬜ **Prototype mode:** link frames with click-through transitions and a present view.
- 🟡 **Dev handoff:**
  - ✅ generated CSS for a shape, a frame as HTML and CSS
  - ✅ the export dialog: PNG, JPEG, SVG and PDF, with a page per frame
  - ✅ the eraser (E) for pen strokes and shapes
  - ⬜ "turn this frame into code" with the AI
- ⬜ **Comments** pinned on the canvas.

### Diagrams (draw.io) ✅

The **Diagrams** tool is the real draw.io editor (open source, Apache 2.0), embedded through its official embed mode. It has every draw.io feature: all shape libraries (flowchart, UML, ER, BPMN, network, cloud…), connectors and layouts, pages and layers, and its own export dialogs. Browser test: `apps/web/test/diagrams.e2e.mjs` (8/8, two people, in CI). embed.diagrams.net answers automated browsers with a 403, so the test serves the real draw.io from a throwaway container (`jgraph/drawio`) while the app still asks for embed.diagrams.net under its real security policy.

- ✅ **Edited together live:**
  - draw.io's own per-shape patches (diffSync) travel over the room document, so two people editing different shapes both keep their work
  - someone opening the diagram later loads the latest copy
  - viewers get a read-only view that follows along
- ✅ **In the app's look:**
  - our header (rename, back, Export)
  - draw.io's clean "simple" UI, recoloured to our black, white and orange
  - follows light and dark mode
- ✅ **Export:** draw.io's PNG, JPEG, SVG, PDF and HTML dialogs, with all their options, or the `.drawio` file itself.
- 🟡 **Hosting:**
  - loads from embed.diagrams.net by default (it opened in a normal browser, under the security policy, on 2026-11-06); PDF export goes through draw.io's server
  - `NEXT_PUBLIC_DRAWIO_URL` points at a self-hosted copy (`docker run jgraph/drawio`)
  - ⬜ add it to production compose
- ⬜ **Next:** comments on shapes, diagrams embedded in Docs pages, AI "draw this as a diagram" (Mermaid to draw.io).

### Messaging (like Slack)

- ⬜ **Channels:** organisation-wide public and private channels next to room chat, plus direct messages and group DMs.
- ⬜ **Conversations:** threads, reactions, @mentions (person, @here, @channel), pinned messages and saved items.
- ⬜ **Rich messages:** code snippets with Run, file sharing, link previews, message formatting, message edit and delete.
- ⬜ **Unread tracking** per channel, notification preferences, and a mentions inbox.
- ⬜ **Huddles:** one-click audio with screen share (LiveKit).
- ⬜ **Slash commands and bots:** `/run`, `/ai`, `/poll`, `/remind`, plus incoming webhooks and bot users for integrations.
- ⬜ **Presence and status:** emoji status and "Do not disturb" schedules.
- ⬜ **Search:** full-text across messages, files, docs, notes and requests (Postgres full-text search).

### Across the suite

- ⬜ **One command bar (Ctrl+K)** searches and jumps to anything: files, docs, notes, requests, designs, channels, people.
- ⬜ **One permissions model:** room and organisation roles apply to every tool.
- ⬜ **AI everywhere:** summarise a channel or doc, draft a spec, generate requests from code, turn a design frame into a component.

**Where it fits:** after the AI phase, in this order:
1. Docs and knowledge base (they share one editor)
2. Messaging (it grows out of room chat)
3. API studio
4. Design canvas (the largest piece)

## 14. Next: a full IDE (VS Code features, every language, frameworks, databases, GitHub, Kubernetes) 🟡

From the owner's asks, planned so each piece builds on the last. One piece at a time; each ends with a browser test and a status update here.

**Order:**
1. ✅ Check the agents' tools: API Studio (7/7), Design and Whiteboard (6/6).
2. Editor at VS Code level (A).
3. Every language (B).
4. ✅ Room network: the foundation that C, D and the sandbox side of E need. Each room has a private network (10/10), and the owner can allow package installs for an hour (24/24).
5. ✅ One-click databases (D): five databases, connections in every terminal and Run, a query console and table browser, backups, seeds and reset (33/33, browser 15/15).
6. 🟡 Framework templates (C): room.json, the Dev server tab, eighteen templates and pre-warmed caches. Spring Boot, Laravel, Rails and ASP.NET Core need their build tools in the image first.
7. GitHub (E). Its import and push go through the GitHub API, so they can start earlier if you want.
8. Kubernetes (F): the playground can come any time (it needs nothing else); real workloads come after the room network and databases; the Helm chart and Kubernetes runner come with production hardening.

### A. Editor at VS Code level 🟡
Monaco is VS Code's editor, and `monaco-vscode-api` brings VS Code's own services, so most of this is wiring, not rebuilding. Browser test: `apps/web/test/editor.e2e.mjs` (12/12, two people).
- 🟡 **Navigation:**
  - ✅ the **command palette**: F1 or Ctrl+Shift+P (Edge keeps Ctrl+Shift+P for InPrivate windows, so F1 is the sure one), with about 150 commands: the room's, the editor's, and Monaco's own editing actions
  - ✅ a **command centre** in the title bar: search files, or type `>` for commands
  - ✅ **Quick Open** (Ctrl+P, fuzzy), **go to line** (Ctrl+G, `line:column` works), **go to symbol** (Ctrl+Shift+O)
    - fixed: in a room with a few hundred files, Enter in Quick Open or Compare could pick nothing (the highlight followed a list about to change)
    - Ctrl+Enter belongs to a tool that marks itself `data-own-run-key`: API Studio sends without also running the open file, and the database console runs its query
  - ✅ **breadcrumbs** above each editor (2026-10-20): the file's folders, the file, and the symbols the cursor is in; a folder's menu opens its files in that pane, the file's menu is its outline, a symbol's menu lists the ones beside it. On by default; Settings or the palette hide them
  - ✅ **Outline view** in the sidebar (with Files and Search): the open file's symbols, the one the cursor is in marked, a filter, click or Enter to go there; it follows typing and the editor you last used
  - ✅ symbols for more languages: TypeScript and JavaScript from their worker as before; Python, Markdown, Go, Rust and shell read from the text (`editor/outline.ts`) until the language servers come. Go to symbol (Ctrl+Shift+O) uses them too
  - tests: `outline.test.ts` 11/11, browser `apps/web/test/outline.e2e.mjs` 21/21
- 🟡 **Editing:**
  - ✅ multi-cursor and column selection, folding, sticky scroll, bracket-pair colours and guides, minimap
  - ✅ format document (Shift+Alt+F); Ctrl+S formats when "format on save" is on; every edit saves as you type
  - ✅ **snippets** (2026-10-20) for Python, JavaScript, TypeScript, Java, C, C++ (with a competitive-programming template, `cp`), Go, Rust, HTML, CSS, Markdown and shell: offered with completions as you type (Tab moves through the placeholders), and from Insert snippet… in the palette (`editor/snippets.ts`; tests: `snippets.test.ts` 4/4, browser `snippets.e2e.mjs` 9/9). Only snippets the typed word starts are offered, so the file's own words still complete (Monaco offers them only when nothing else does)
  - ✅ **Emmet** for HTML and CSS (2026-10-20, `emmet-monaco-es`): abbreviations like `ul>li*3` or `m10` among the completions, Tab or Enter expands them (browser `keys.e2e.mjs`)
- 🟡 **Layout:**
  - ✅ a **split editor** (Ctrl+\\) with any file on the right
  - ✅ **compare two files** in a diff editor; both sides are the live files
  - ✅ **Markdown live preview**, updating as anyone types:
    - beside the file (Ctrl+K V, or the tab bar's Markdown preview button)
    - or on its own to read (Ctrl+Shift+V, or Preview only)
  - ✅ **Zen mode** (Ctrl+K Z) hides everything but the code
  - ✅ **file previews** (2026-10-20), with the same button and keys as Markdown's (Ctrl+K V beside, Ctrl+Shift+V on its own):
    - **CSV and TSV as a table**, live as anyone types: quoted cells, a sticky header (or not: a switch), click a heading to sort (numbers by value), a filter across every cell, numbers right-aligned, the first 1,000 rows drawn; double-click a row to see its line in the code
    - **SVG as an image**: fit or actual size, its size shown, on a checkerboard; drawn as an image, so a script in the file never runs
    - tests: `csv.test.ts` 10/10, browser `apps/web/test/preview.e2e.mjs` 19/19
  - ✅ (2026-11-05) PNG, JPEG and other binary files: images, PDFs, fonts, audio and video open in the binary viewer (§5 Files, Binary files)
  - ✅ **grid splits** (2026-10-21): up to four editors as VS Code splits them: Ctrl+\ to the right, Split down below the main editor and then below the right one, each with its own file (Change file), breadcrumbs and close button, Close all split editors to go back to one; rows and columns resize. Browser `grid.e2e.mjs` 9/9
- ✅ **Change language mode** for a file, from the palette or the status bar.
- ✅ **Follow someone:** their file opens for you as they move, with a banner and a Stop button (like Live Share). Start it from the palette ("Follow someone…") or, since 2026-10-10, with the Follow button beside each person in the People panel (the faces in the top bar); `room-people.e2e.mjs` 7/7.
- ✅ **Search and replace across files** (Ctrl+Shift+F, Ctrl+Shift+H; the Search view shares the sidebar with Files):
  - match case, whole word and regex (a bad one says why), include and exclude globs; results grouped by file, live as anyone edits, capped at 2,000 with a note
  - a result opens its file with the match selected; arrow keys move through results
  - replace (people who can edit): `$1`, `$<name>` in regex mode, a live preview, Replace all after a confirmation with the count, or one file at a time; one change everyone sees at once, small edits so others keep their cursors, and Undo for 10 seconds
  - built by a parallel agent (Opus, at the owner's request) on the main session's matching and replacing logic; tests: `search.test.ts` (28) and `apps/web/test/search.e2e.mjs` (23/23), both checked by the main session
- ✅ fixed: a new file named with Enter got a blank first line; new files typed in a Windows browser got 
 line endings, which break shell scripts in the Linux sandbox (files are 
 unless they already use 
)
- 🟡 **IntelliSense for every language:** language servers run inside the room's sandbox, inside the jail, reached over a WebSocket through the API (`/ws/lsp`, edit rights) and the runner (`lsp.ts`, one server per editor, ended when the editor goes); the browser's client is `monaco-languageclient` (`editor/language-client.ts`)
  - ✅ **Python** (Pyright 1.1.400, both images), 2026-10-20: type errors and other problems underlined as you type, completions, hover with signatures and docstrings, go to definition (F12 or Ctrl+click, into another file's tab), references and the rest of what Pyright offers; imports between the room's files resolve, because the server reads them from the sandbox
  - the editor's services can read every room file (`editor/workspace-fs.ts`), so a definition in a file nobody has open still opens
  - fixed on the way: Go to line (and every palette page) now hands focus back to the code
  - known: Pyright 1.1.400 stops answering after `initialized` when a client offers workspace-folder changes; the runner turns that offer off (a room has one folder)
  - ✅ **C and C++** (clangd 19, both images), 2026-10-21: gcc's headers (bits/stdc++.h too), C17 and C++20 for files without a build setup, no background index (it would write .cache/ into the room)
  - ✅ **Go** (gopls) and **Rust** (rust-analyzer, with rust-src) in the full image; in the base image the server says it comes with the full image. rust-analyzer finds a crate at the workspace's root or one folder down, keeps cargo offline, and reads the standard library from its sources (the sandbox has no network)
  - the servers' own formatting is left out (the room's Format document runs the same tools), so a file never has two formatters
  - fixed on the way: a palette page that moves to the code (Go to line) no longer leaves focus on the page
  - tests: `lsp.test.ts` 9/9, `apps/runner/test/lsp.e2e.mjs` 12/12 (Python, C++, Go, Rust), browser `apps/web/test/lsp.e2e.mjs` 11/11 (Python and C++)
  - ✅ (2026-10-27) Java: Eclipse JDT LS 1.62 (full image; checked against Eclipse's SHA-256). It needs Java 25 to run, so the full image has Java 25's runtime for it alone (rooms' `java` stays 21, and it completes from 21's library). A .java file in no Maven or Gradle project is still understood. It's heavy (about 650 MB each, one per editor with Java open), so its heap is kept to 512 MB and only the quick compiler runs; its data folders in /tmp are cleared after half a day (`sandbox/image/jdtls`)
  - ⬜ one JDT LS shared by the room's editors would save memory; TypeScript and JavaScript already have IntelliSense in the browser
  - ✅ **Problems** (2026-10-21): a tab beside Output with what the language servers and TypeScript report in the open files, grouped by file, with a filter and a switch each for errors, warnings and info; a click puts the cursor on it. The status bar counts errors and warnings, and opens the tab. "Show problems" in the palette. Browser `problems.e2e.mjs` 10/10
  - ✅ (2026-10-28) problems in files nobody has open: **Check all files** in the Problems tab (for people who can run code) runs the project-wide checkers in the sandbox, each where its project is, as the room's files say: Pyright for Python, the project's own TypeScript for each tsconfig.json (not installed is a note: run npm install), `go vet` for each Go module and `cargo check --offline` for each crate (full image; a base image says so). What they find joins the live problems: open files stay live, the rest show the check's, and a line says what ran and what couldn't (`apps/runner/src/check.ts`, `POST /api/rooms/:id/check`). Tests: the parsers' unit tests (3), runner `check.e2e.mjs` 6/6 (Pyright's type error and undefined name with their places, TypeScript not installed, go vet's Printf mistake), browser `problems.e2e.mjs` 14/14 (a Python file written from a terminal, never opened, found)
  - ✅ fixed on the way: E2ETST had test files left by runs whose clean-up failed (an earlier debugger run's, a probe's, a language-server run's); they're gone, and the Problems test cleans up even when the terminal is hidden
- 🟡 **Formatters** (2026-10-20): Format document (Shift+Alt+F, and on save when that's on) for languages the browser can't format itself runs their formatter in the room's sandbox, inside the jail:
  - ✅ Python (Ruff), C and C++ (clang-format, following a `.clang-format` file), shell (shfmt, with the editor's indentation) in both images; Go (gofmt) and Rust (rustfmt) in the full image
  - ✅ the result lands as small edits, one per changed run of lines, so others' cursors stay put (`editor/line-edits.ts`); one Undo puts it back; a syntax error leaves the file alone and shows the formatter's message
  - JavaScript, TypeScript, JSON, CSS and HTML keep Monaco's own formatter in the browser
  - tests: `line-edits.test.ts` 6/6, `apps/runner/test/format.e2e.mjs` 9/9, browser `apps/web/test/format.e2e.mjs` 8/8
  - ✅ (2026-10-27) Java: google-java-format 1.37 (full image; GitHub's digest)
  - ✅ (2026-10-27) Prettier for a project that has its own config: with a `.prettierrc` (or `prettier.config.*`) anywhere in the room, its JavaScript, TypeScript, CSS, JSON, HTML, Markdown and YAML format with the project's own Prettier, the nearest `node_modules/.bin/prettier` above the file, in the sandbox, which reads the project's settings; not installed yet, it says to run npm install. The browser's formatter stays for rooms without one. With two formatters, VS Code's own choice asks for a default and formats nothing, so while Prettier is on a choice of ours takes it (`editor/sandbox-format.ts`). Tests: runner `format.e2e.mjs` 12/12 (with a stand-in Prettier in node_modules), browser `format.e2e.mjs` 10/10. Not looked for: package.json's "prettier" key
- 🟡 **Debugger** (2026-10-21), multiplayer: one session for the whole room, which everyone follows; people who can run code start it, step and evaluate, the rest watch.
  - ✅ Python (debugpy) and C and C++ (gdb's own Debug Adapter Protocol mode, compiled with debug information first), both already in both images, inside the jail like a Run
  - ✅ breakpoints in the gutter (click left of a line number, or F9), shared through the files document and anchored to their lines, so they stay put while people edit above them; sent to the debugger at once, even while it runs
  - ✅ Run and debug view (keys as in VS Code: F5 start or continue, F10, F11, Shift+F11, F6 pause, Shift+F5 stop): who started it and where it's paused, Variables (expandable), Watch, Call stack (a frame shows its variables and opens its file), Breakpoints; the paused line is marked in everyone's editor
  - ✅ Debug console tab: the program's output for everyone, and expressions in the paused frame (gdb takes its own commands there)
  - how: the runner is the debug adapter's client (`debug.ts`): it starts the session, sends the room's breakpoints, numbers each person's requests and sends each answer back to whoever asked; events go to all. The API's `/ws/debug` lets in room members, driving for Run rights.
  - Tests: `apps/runner/test/debug.e2e.mjs` 22/22 (two people on a Python session and a C one, a live breakpoint, a compile error, watch-only limits), `apps/web/test/debugger.e2e.mjs` 20/20 (two people in the browser), and the breakpoints' unit tests (anchoring through someone else's edits)
  - ✅ (2026-10-26) Go, with Delve (Debian's, in the full image): the room builds a .go file with optimisations off (its folder's package when it's in a module, else the file alone; or a package by its folder, launch.json's `${fileDirname}` or `${workspaceFolder}`), then Delve runs it. Delve serves the protocol only on a TCP port, so a small bridge in the sandbox passes it through stdin and stdout like the others. "Stop on entry" stops at `main.main` (Delve's own entry is in the runtime's start-up code); the program's output comes as output events; Delve's notes for its own terminal and its second "terminated" are left out. The base image says Delve comes with the full one.
  - Tests (Go): `debug.e2e.mjs` 37/37 (a module's package built with its other file, a breakpoint, a variable and a watch, output; a file alone with arguments and stop on entry; a package by folder; a compile error), `debugger.e2e.mjs` with `GO=1` 24/24 (a Go file in the browser: breakpoint, paused, its variable, run to the end), and launch.json's unit tests 4/4 (Go by file, folder and the room's top)
  - ✅ fixed on the way: the browser test's watch check matched both the expression ("x * 100") and its value
  - ✅ (2026-10-26) JavaScript and TypeScript, with js-debug (VS Code's Node debugger, v1.140.0 from its GitHub release, checked against the SHA-256 GitHub publishes; in both images). A .ts file runs as it is: Node 24 strips the types and keeps every line and column, so breakpoints need no source maps. js-debug runs each Node process as a child session it asks the client to open (`startDebugging`); `sandbox/image/js-debug-bridge.mjs` opens it in the sandbox, gives it the breakpoints and exception filters sent so far, and passes everything after to it, so the runner sees one session as with the other debuggers. Only the first process is debugged (processes it starts are declined). The program's stdout and stderr come through, not only console.log; Node's notes on the inspector are left out. launch.json takes `node` and `pwa-node` configurations with a .js or .ts program, and the starter file has "Node: current file".
  - Tests (JavaScript): `debug.e2e.mjs` 46/46 (a breakpoint, a variable and a watch, console and stdout output; a .ts file as it is; stop on entry with arguments and environment), `debugger.e2e.mjs` 28/28 with `GO=1` (a .js file in the browser, as with Go), launch.json's unit tests 5/5
  - ✅ (2026-10-27) Java, with java-debug 0.60 (VS Code's Java debugger's plugin, from Open VSX, checked against its SHA-256), which runs inside JDT LS: the room compiles the file with `javac -g` (with its package's sources beside it, so errors read as javac's), then a bridge in the sandbox starts JDT LS at the file's source root with the plugin, has it make the file's project (its source path the root, as the package says; JDT LS's own guess is the file's folder), asks for a debug server and passes the protocol through, filling in the main class and project. Arguments go as one command line. "Java: current file" is in the starter launch.json; `java` configurations take `mainClass: "${file}"`. An adapter that stops before it's ready now says why (its last stderr lines).
  - Tests (Java): `debug.e2e.mjs` 51/51 (a class in a package using another, stopped at a breakpoint with its source, a variable and a watch, output; a compile error), `debugger.e2e.mjs` with `GO=1` 32/32, launch.json's unit tests 6/6
  - ✅ fixed on the way: the browser test typed code and Monaco closed the class's brace itself (now it deletes what the editor added after the cursor); the editor's language status service was missing (JDT LS's client adds one), and a language client that drops its connection while the sandbox starts no longer leaves an error on the page
  - ⬜ for Node, `runtimeExecutable` and npm-script configurations, and processes a program starts
- 🟡 **Personal settings:**
  - ✅ font size and ligatures, tab size and indentation, word wrap, minimap, line numbers, whitespace, cursor style, bracket colours, sticky scroll, format on save (Ctrl+,)
  - ✅ **Vim key bindings** (2026-10-20, `monaco-vim`, loaded only for people who turn them on): Settings, Key bindings, or the palette; modes, motions, operators, registers and : commands, with the mode and the command line under the editor; `:w` does what Ctrl+S does. Browser `keys.e2e.mjs` 12/12 (with Emmet)
  - ✅ **Editor themes** (2026-10-21): Settings, Theme: the room's own (following the app's light or dark), Visual Studio Light and Dark, and high contrast light and dark; **Import…** takes a VS Code theme's .json (comments and trailing commas fine), with its editor colours and its TextMate scopes mapped onto the highlighters' tokens (`editor/vscode-theme.ts`); imported themes stay in this browser and can be removed. Tests: `vscode-theme.test.ts` 6/6, browser `themes.e2e.mjs` 11/11
  - ✅ **settings saved to your account** (2026-10-21): the editor settings and imported themes follow you to any browser (`user_settings`, migration `0002_user_settings`; GET and PUT `/api/me/settings`; `editor/settings-sync.ts`). Loaded when a room opens, saved a moment after a change; a change this browser didn't get to save (a reload right after it) wins over the account's older copy. Browser `account-settings.e2e.mjs` 5/5
  - ⬜ Emacs key bindings (the `monaco-emacs` package hasn't been updated since 2022)
- 🟡 **Tasks and launch configs:**
  - ✅ **tasks** (2026-10-21): `.vscode/tasks.json` (shell, process and npm tasks; args, folder, environment, build and test groups; `${file}`, `${workspaceFolder}` and the rest) and every package.json's scripts. Run task… in the palette, and Ctrl+Shift+B for the default build task. A task runs in your own Task terminal (a tab beside the others), which Ctrl+C's the last one first, as VS Code reuses its task terminal; it needs terminal rights. Tests: `tasks.test.ts` 8/8, browser `tasks.e2e.mjs` 8/8
  - ✅ **`launch.json`** (2026-10-21) for the debugger: Run and debug picks a configuration (or the open file), and F5 runs the one picked. Python configurations by program or module (`-m`), C and C++ ones by source file (the room compiles it); args, cwd, env, stopOnEntry (stopAtEntry) and justMyCode, with `${file}`, `${workspaceFolder}` and the rest filled in; attach and other debuggers are listed with why they're skipped. "Add a launch.json" writes a starter file. The runner checks every path stays in the room. Tests: `launch.test.ts` 3/3, the runner's `debug.e2e.mjs` now 29/29 (arguments, environment, folder, stopping on entry, a module, C with arguments, refusals), browser `launch.e2e.mjs` 9/9
- ⬜ **Extensions** from Open VSX through the VS Code extension host. Last: the largest piece.

### B. Every language ✅ (24 more languages)
- The base image runs Python, JavaScript, TypeScript, C, C++, Java and Bash.
- 🟡 **Language packs:**
  - ✅ the Dockerfile has two targets:
    - `base`, the default: `pnpm sandbox:build`
    - `full`, which adds 24 languages: `pnpm sandbox:build:full`, then `SANDBOX_IMAGE=codechatter-sandbox:full`
    - production compose builds `SANDBOX_TARGET` (default `base`)
  - ✅ the full image (5.6 GB) passes `apps/runner/test/languages.e2e.mjs`: 26/26
    - every language prints its answer through the real runner, inside the terminal jail
    - no build files are left in the room
    - the judge works on Rust
    - the runner (22/22) and judge suites pass on it too
  - ✅ the jail is built in its own stage, so changing it doesn't re-download every toolchain; apt downloads are cached between builds
  - ✅ this PC's runner uses the full image (`SANDBOX_IMAGE=codechatter-sandbox:full` in `.env`)
  - ✅ (2026-10-28) the room owner picks base or full per room, in the Ports panel (Sandbox image), where the server has both: `SANDBOX_IMAGE_BASE` and `SANDBOX_IMAGE_FULL` beside `SANDBOX_IMAGE`, the default for rooms that haven't picked. The pick is in the room's settings; the API names it in every service token it gives the runner (`img`), the runner remembers it per room and starts the sandbox from that image, and switching restarts the sandbox into it (files kept; recorded in the audit log). Everyone sees which image the room runs; only the owner switches. Tests: runner `image.e2e.mjs` 8/8 on a runner of its own with both images (default, full, remembered, base, back to default), browser `sandbox-image.e2e.mjs` 7/7 on this PC (the owner switches E2ETST to base and back to full; the editor sees it but has no switch; on a server with one image it says so and skips)
- 🟡 **Run plans, judge plans and syntax highlighting:**
  - ✅ one recipe table (`apps/runner/src/plans.ts`) feeds both Run and the judge, so they can't drift apart
  - ✅ on the base image, a full-image language explains how to get it instead of "command not found"
  - ✅ compilers write to `/tmp`, never next to your file
  - ✅ in the full image:
    - systems: Go, Rust, Fortran, Assembly (NASM), D, Ada, Pascal, Crystal
    - JVM: Kotlin (official compiler), Clojure, Groovy
    - .NET: C# (Mono)
    - scripting: Ruby, PHP, Perl, Lua, R, Elixir
    - functional: Haskell, OCaml, Racket
    - others: SQL (SQLite), Prolog (`.pro`), COBOL
  - ✅ highlighting for these in the editor (closest grammar where Monaco has none)
  - ⬜ not packaged for Debian yet, so a later batch from official releases: Zig, Nim, Julia, Dart, Swift, Scala 3, F#
- ✅ **Python data pack:** numpy, pandas, matplotlib and the Jupyter kernel in the base image; plots and tables show in notebooks (§2). A plain Run has no plot window: save plots to a file there.

### Room network (foundation) ✅
A room has no internet by default; the owner can open package registries, and nothing else, for an hour. Decision and evidence: ADR 0007.
- ✅ **Each room has its own network** (`cc-<namespace>-net-<room>`):
  - internal, and with no address on the host (Docker's `isolated` gateway mode), so there is no route out at all
  - each room takes a /26 of `SANDBOX_SUBNET` (default `10.213.0.0/16`, 1,024 rooms), because Docker's default pools run out at about 30 networks
  - the sandbox joins only its room's network; the room's services will join it and be reached by name
  - older sandboxes move onto it on their next start, and the sweep removes a network once its room has had no container for a day
- ✅ **Security tests:** `apps/runner/test/network.e2e.mjs` (10/10)
  - from a real Run, a service on the room's network answers by name (the positive control)
  - another room, the app's own database, the host, cloud metadata, the internet and outside DNS are all unreachable
  - runner (22/22), judge and Kubernetes (4/4) suites still pass on the new network
- ✅ **Package installs**, off until the owner turns them on in the Ports panel (**Allow for an hour**):
  - everyone in the room sees whether they're on, until when, and who allowed them; each switch goes in the audit log
  - while on, a proxy container joins the room's network as `egress`; it opens HTTPS tunnels to package registries only:
    - npm, PyPI, Go modules, crates.io, RubyGems, Maven Central and Clojars, Packagist, NuGet, Hex, CRAN (`PACKAGE_REGISTRIES` in contracts)
    - Go modules include `storage.googleapis.com` (2026-10-26): the Go proxy sends larger modules (Gin's) from its Cloud Storage bucket. Like the registries' own upload APIs, it's a host someone with their own credentials could write to, so it adds no new way out
    - Packagist includes `api.github.com` and `codeload.github.com` (2026-10-28, the owner's call): Composer downloads each package's code from GitHub. With installs on, a room can reach GitHub's API too (as it can npm's and PyPI's upload APIs), so it's no new kind of way out
    - other hosts, ports, IP addresses and plain HTTP get a 403 with a reason, and so does a registry name that resolves to a private address
  - it exits by itself when the hour is up, even if the runner is down; **Turn off** stops it at once
  - nothing to set up: every terminal and Run has `HTTPS_PROXY` set to the agent's relay. While installs are off, the relay answers "This room has no internet…", which npm and pip show
  - `pip install` works (pip is in the images now and installs for the user); `npm install -g` goes to `~/.local`
  - the home folder is now a volume per room, so the package managers' caches make repeat installs fast and survive restarts
  - terminals start plain bash, so `~/.local/bin`, `~/.cargo/bin` and `~/go/bin` stay on `PATH`
- ✅ **Tests:**
  - `apps/runner/test/egress.e2e.mjs` (24/24): real installs with npm, pip, Go, Cargo and RubyGems; every refusal; the off message; the home surviving a restart; off by hand and by time
  - `apps/web/test/installs.e2e.mjs` (7/7): the owner switches installs on and off; an editor sees who allowed them and has no switch
  - the proxy's rules: `sandbox/agent/src/egress-policy.test.ts` (9 tests; the agent package passes 13/13)
  - with the proxy settings, the home volume and plain-bash terminals in place, the network (10/10), runner (22/22), judge, Kubernetes (4/4) and languages (26/26) suites still pass

### Docker housekeeping ✅ (2026-10-09)
The owner noticed Docker piling up: deleting a room never deleted its Docker pieces, and every image rebuild left the old one behind.
- ✅ deleting a room deletes its sandbox, databases, package proxy, volumes and network at once (the files live on in the room's document)
- ✅ the API's janitor (`apps/api/src/rooms/room-janitor.ts`) sends the runner the rooms that exist, soon after it starts and every six hours; the runner removes what's left of any others (`POST /maintenance/prune`; never a room in use, never on an empty list)
- ✅ sandbox images are labelled; `pnpm sandbox:build` and `:full` then run `pnpm docker:tidy`, which removes the copies they replace and keeps the build cache to 10 GB
- ✅ cleared once by hand: 23 leftover containers, 17 volumes and 5 networks of deleted rooms, old local production images, and 20 GB of build cache

### D. One-click databases ✅
Decision and design: ADR 0008.
- ✅ **The Databases tool** (in Apps): PostgreSQL 18, MySQL 8.4, MariaDB 11.8, MongoDB 8.0 and Redis (Valkey 9).
  - one click starts it for the room; the first start downloads its image, and the panel says so
  - each runs in its own container on the room's network, with its data on a volume of its own
  - hardened like the sandbox: the database's own user from the start (never root), no capabilities, a read-only root, memory and process limits, no published ports
  - Stop keeps the data and Delete removes it; databases sleep when the room idles and wake with its sandbox
  - starting, stopping and deleting need terminal rights, and each is in the audit log
- ✅ **Connecting from your code:**
  - every terminal and Run already has `DATABASE_URL`, `POSTGRES_URL`, `MYSQL_URL`, `MARIADB_URL`, `MONGODB_URL` and `REDIS_URL`; code reaches each by name (`postgres:5432`)
  - `psql`, `mysql`, `mariadb` and `redis-cli` are in the sandbox and connect with no arguments
  - the panel shows the address, user, database, URL (password hidden, with copy buttons) and the command for a terminal; only people who can run code see the connection
- ✅ **Query console and table browser** (Open on a running database):
  - SQL for the three SQL databases (several statements, each result or status in order), one mongosh expression for MongoDB, one command per line for Redis; Ctrl+Enter runs it
  - results are real tables (NULL shown as NULL), up to 500 rows; errors in the database's own words
  - the table browser lists tables, views, collections or keys, and shows the first 100 rows (or a key's value by its type); clicking a table puts its query in the console to edit
  - queries run inside the database's container through its own client; the browser never connects to it. Anyone in the room can browse; writing queries needs terminal rights
- ✅ **Tests:**
  - `apps/web/test/databases.e2e.mjs` (15/15): two people; start, connection and copy, stop, delete; the console runs SQL; a table preview; a backup downloads; an upload loads; reset empties it; the editor sees the same tables
  - `apps/runner/test/databases.e2e.mjs`: all five start in about 17 seconds; hardened and private; consoles, errors, table lists and previews for all five; seeding from a room file, a SQL backup, reset and restoring it; MongoDB's archive backup and restore; MySQL's dump; Redis's snapshot; MongoDB from the sandbox; data survives stop, sleep and wake; delete wipes it. 33/33, including `psql`, `mysql`, `mariadb` and `redis-cli` from the sandbox
  - parsers for every client's output (`database-queries.test.ts`, 13 tests, from real captured output) and the connection settings (`databases.test.ts`)
- ✅ **Backups, seeds and reset** (in the console's header):
  - **Backup** downloads the database: SQL from `pg_dump`, `mysqldump` or `mariadb-dump` (loading it again replaces those tables), a `mongodump` archive, or Redis's RDB snapshot
  - **Load a file**, from the room (a `seed.sql` everyone edited) or from your computer (up to 64 MB): SQL, a mongosh script or `mongodump` archive, or Redis commands, run through the database's own client. That's seeding and restoring alike
  - **Reset** deletes the data and starts it again, empty
  - backups need the right to run code; loading and resetting need terminal rights; each is in the audit log
  - not yet: loading a Redis snapshot back (it says so)
- ✅ **SQLite files** (2026-10-27), under the database servers in the Databases tool: the room's SQLite files (Django's `db.sqlite3`, a Flask app's), found in the sandbox by SQLite's header (dependency and build folders skipped), open in the same console and table browser. They need no server: Python's `sqlite3` (in both images, unlike the `sqlite3` command) reads them in the sandbox, inside the jail, as the room's user (`apps/runner/src/sqlite.ts`). Statements run in turn, each showing its rows or how many it changed, and the first error ends them with the earlier results kept; results stop at 500 rows; blobs show their size. It opens files that exist and never makes one. Anyone in the room can browse, and the console needs terminal rights, as for the servers.
  - ✅ (2026-10-27) **Backup** downloads SQL (Python's `iterdump`, after a `DROP ... IF EXISTS` for each table and view, so loading it again replaces them, as the servers' backups do); **Load a file** runs SQL from the room or this computer (up to 64 MB) into it as a script, saying how many rows changed, and refuses a database file or an archive in place of SQL. Backups need the right to run code and loading needs terminal rights; both are in the audit log. There's no Reset: delete the file.
  - Tests: `apps/runner/test/sqlite.e2e.mjs` 22/22 (found by header, not in node_modules or a lookalike; tables and views; previews with NULLs, floats, blobs and an awkward name; statements in turn and the first error; saved changes; 500 rows; outside paths, missing and non-SQLite files; a backup that restores the emptied table, a room file loaded, bad SQL, a database file refused), `apps/web/test/sqlite.e2e.mjs` 13/13 (made from a terminal, found, opened, previewed, queried, backed up and loaded into; the editor browses it), and `databases.e2e.mjs` still 15/15
- ✅ **DuckDB** (2026-10-27): the Databases tool's list of files ("Database files" now) has the room's DuckDB files beside its SQLite ones, and a row for its CSV, Parquet and JSON files, which open in the same console as DuckDB over the room's folder: the table browser lists the data files, a preview reads one by path, and SQL joins them (`select … from 'sales.csv' join 'items.parquet' using (region)`). DuckDB's Python package (1.5.6, the wheel for the images' Python, installed by its PyPI SHA-256) is in both images, with its CSV, Parquet and JSON readers built in, so nothing is downloaded; it runs in the sandbox, inside the jail, as the room's user, its scratch space in /tmp (`apps/runner/src/duckdb.ts`, sharing SQLite's Python runner in `sqlite.ts`). INSERT, UPDATE and DELETE say how many rows changed and COPY how many it wrote; a file is opened only if it exists. No backup or load for DuckDB yet (its EXPORT writes a folder).
  - Tests: `apps/runner/test/duckdb.e2e.mjs` 16/16 (DuckDB and data files found, not in node_modules; data files as tables, a CSV previewed, grouped, JSON lines summed, CSV joined with Parquet; a DuckDB file's tables and views, statements in turn, saved changes, 500 rows; a missing file, an outside path), `apps/web/test/duckdb.e2e.mjs` 9/9 (a CSV written in the editor, found, previewed, grouped; a mistake shows DuckDB's words), and the SQLite tests still pass (runner 22/22, browser 13/13)
  - ✅ fixed on the way: the SQLite runner test left its folder in E2ETST's files (it trashed the seed file only)
- ⬜ Later: ClickHouse, OpenSearch, Neo4j; DuckDB backups.

### C. Frameworks 🟡
- ✅ Fixed while adding templates (2026-10-21): a sandbox that failed to start while a preview's WebSocket waited for it crashed the whole runner (an unhandled promise rejection). `sandbox.ts` now handles it, and the runner logs any other stray rejection instead of exiting.
- ✅ **`.codechatter/room.json`** says how to install, run and preview a room: `install` (run when the `installed` path is missing), `dev`, `port`, and the `databases` to start first. Templates and imported projects both use it; a broken one is explained, not run.
- ✅ **The Dev server tab** (bottom panel, when the room has a room.json):
  - **Start** installs if needed (through the package proxy), starts the room's databases, then runs the dev server in one terminal everyone in the room shares
  - **Restart** and **Stop**; **Open preview** once its port listens (on its own origin)
  - when the first start must install packages and installs are off, the owner gets one button, **Allow installs and start**; others are told to ask the owner
  - starting and stopping need terminal rights and go in the audit log
- 🟡 **Templates that start in one click:**
  - ✅ frontend: React, Vue and Svelte, each on Vite with live reload in the preview
  - ✅ backend: Express with the room's PostgreSQL (started with it), FastAPI, Flask and Django; the Node.js API template has a room.json too
  - ✅ (2026-10-21) frontend: Next.js (App Router, a client component), SvelteKit, Astro and Solid (Vite)
  - ✅ (2026-10-21) backend: Fastify and Hono, restarting on every save
  - ✅ (2026-10-26) frontend: Nuxt 4 and Angular 20 (a standalone component with a signal), both warmed
  - ✅ (2026-10-26) backend: NestJS (warmed), Gin on Go and Axum on Rust (the full image's Go 1.24 and Rust 1.85; `go mod tidy` and `cargo fetch` the first time, so installs must be allowed: their downloads go to the home folder, which the warm cache doesn't keep)
  - ✅ (2026-10-28) backend: Spring Boot 4.0 on Java 21 and Maven (the full image now has Debian's Maven 3.9, with global settings that send it through the room's package proxy: Maven doesn't read HTTPS_PROXY). The first Start builds it (`mvn package`, downloading from Maven Central while installs are allowed), then `mvn spring-boot:run` serves it; 45 seconds here, downloads included. Its downloads live in ~/.m2, so it isn't warmed
  - ✅ (2026-10-28) backend: Laravel 12 on PHP 8.4 (full image: Debian's Composer and the PHP extensions Laravel needs). The owner allowed Packagist's code hosts in the package proxy: Packagist sends Composer to GitHub for each package's zipball (`api.github.com`, sent on to `codeload.github.com`). The template is Laravel's slim skeleton; its `.env` sends caches, compiled views and logs to /tmp (and uses array sessions and cache), so the room's files stay its own, and holds a development key (`php artisan key:generate` for anything real). The sandbox no longer syncs `vendor` folders back into the room (Composer's, and Go's), and the warm cache keeps `vendor` too, named by composer.json and composer.lock: a new room starts in 6 seconds warmed, 18 installing
  - ⬜ backend: Rails, ASP.NET Core (Bundler and native gems; the .NET SDK)
  - ⬜ warm Go's and Cargo's caches too (they live in the home folder)
- ✅ **Pre-warmed caches** (2026-10-26): a new room from any of the sixteen warmed framework templates starts in 7 to 18 seconds here (it was 15 to 61, after the owner allowed installs), with nothing downloaded and installs left off.
  - `pnpm sandbox:warm` (like building the image; `pnpm sandbox:warm react flask` for some, `--force` to redo) installs each template's packages once, in a clean container of the sandbox image with ordinary internet access, never in a room, and archives what the install made (`node_modules`, `.venv`) in the `cc-<ns>-warm` volume, named by the install command and the dependency files' exact text (`apps/runner/scripts/warm.ts`, `src/warm-cache.ts`)
  - every sandbox sees the volume read-only at `/usr/local/share/cc-warm` (under `/usr`, which the jail lets everything read). Start unpacks the archive matching the room's dependency files before installing, and the Dev server tab offers plain Start once it knows an archive matches. Rooms can't write to it, so no room can plant code in another's packages. A room whose `package.json` or `requirements.txt` differs installs as before.
  - the SvelteKit template runs `svelte-kit sync` before `vite dev` (an unpacked install hasn't run SvelteKit's postinstall)
  - ✅ **fixed on the way:** the preview sent each request through Node's global HTTP agent, which keeps sockets for reuse under one name for every room, so a later request (perhaps for another room) could go down an earlier request's tunnel while its own leaked, and a page loading dozens of modules at once (SvelteKit) had some requests hang. Each request now has its own agent and tunnel, never pooled (`apps/runner/src/preview.ts`); 62 parallel module requests, three rounds, none fail.
  - Tests: `warm-cache.test.ts` (5), `templates.e2e.mjs` with `WARM=1` 16/16 (plain Start from the tab's first answer, installs off; 9 to 19 seconds each), Gin and Axum with installs (112 and 93 seconds: real downloads, and Axum's first build), and preview (19/19), dev (8/8) and runner (23/23) still pass
  - ✅ (2026-10-26) a brand-new room's Dev server tab offers plain Start from its first answer: before the room's sandbox is up, the runner checks the warm volume itself (`WarmIndex` in `warm-cache.ts`: a throwaway container lists it, at most once a minute, in about 0.4 s); `templates.e2e.mjs` with `WARM=1` fails if the tab ever offers to allow installs
  - ✅ the sandbox's file sync now skips what framework dev servers generate (`.svelte-kit`, `.nuxt`, `.output`, `.angular`, `.astro`, `.turbo`, `.vercel`), as it did `.next`, so they don't fill the room's file tree
- ✅ **Tests:**
  - `apps/runner/test/dev.e2e.mjs` (8/8): reads room.json; installs first and skips it on restart; starts its databases; answers through the preview; explains a broken room.json; stops
  - `apps/web/test/templates.e2e.mjs`: as a person would, for all eighteen (6 to 61 seconds each here; a server-rendered page's counter is clicked until it has hydrated): a room from the template, allow installs, Start, then the app works in the preview (the front ends' counters count). Real downloads, 15 to 60 seconds each; each room is deleted after. `TEMPLATES=react,flask` runs some

### F. Kubernetes

Two tracks. Kubernetes for the code people write in rooms, and CodeChatter itself on Kubernetes.

**Track 1: Kubernetes in rooms**
A real cluster normally needs privileged containers. Those can't be given to code from strangers, so this starts unprivileged and grows from there.
- ✅ **Kubernetes playground:** test `apps/runner/test/kubernetes.e2e.mjs` (4/4, through the real runner)
  - **What's in the full image:**
    - `kubectl` and Kubernetes 1.37, plus Helm 4.3, checked against their published SHA-256 sums
    - **KWOK**: a real Kubernetes API server and etcd with simulated nodes, running as ordinary processes inside the sandbox jail, with no network and no privileges
  - **`k8s up`** starts it in about 4 seconds, then `kubectl` and `helm` just work: Deployments roll out, Services get IPs, Helm installs charts, RBAC applies. Pods report Running, but no containers run. `k8s down` stops it.
  - **The "Kubernetes playground" room template:** a README, `demo.sh` (one Run deploys everything), manifests in `k8s/`, and a Helm chart in `chart/`
  - **What it took:**
    - the API server needs an address to advertise in a network-less sandbox (loopback, with the endpoint reconciler off)
    - the cluster starts in its own session, so it outlives the Run or terminal that started it
    - its Go threads count as processes, so rooms on the full image get 2 GB and 1024 processes on this PC (`.env`)
  - a rebuilt image reaches a running room when its sandbox restarts (Ports tab, Restart sandbox)
  - ✅ (2026-10-27) `kubeconform` (v0.8.0) with offline schemas, so manifests can be checked without a cluster: the schemas are made when the image is built, from the OpenAPI spec of the same Kubernetes version the playground runs (`sandbox/image/k8s-schemas.py`: 325 kinds in 2.8 MB, one shared definitions file), strict, so a misspelt field is an error, and nullable where Kubernetes allows it. Both downloads are checked against SHA-256 sums, and the build checks a good Deployment passes and a misspelt `replica` doesn't. The panel's **Check** (next to Apply, and while the playground is stopped too) lists each object in the open manifest with where each mistake is (`/spec/template/spec/containers/0/ports/0/containerPort: got string, want null or integer`); a custom resource is skipped, and text that isn't YAML says so. `kubeconform` works in terminals too.
- 🟡 **Kubernetes panel** (like Lens or VS Code's Kubernetes extension), a room tool (Apps → Kubernetes, for people who can run code):
  - ✅ (2026-10-21) start and stop the playground; workloads (Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Pods), Services, Ingresses, ConfigMaps, namespaces, nodes and events, with counts, a namespace filter, health and ages, refreshed every few seconds
  - ✅ YAML and describe for any of them, and delete (asked twice); Secrets stay out, so their values never show
  - ✅ apply the open manifest (YAML or JSON) in one click, as it is in the editor; kubectl's own words when it refuses
  - how: `POST /rooms/:id/kube` on the runner (`kube.ts`) runs kubectl in the sandbox's jail, as a Run would, and sums each object up; the API's `/api/rooms/:id/kube` needs Run rights and logs changes in the audit log
  - Tests: `apps/runner/test/kube.e2e.mjs` 22/22 and `apps/web/test/kubernetes-panel.e2e.mjs` 14/14 on the real playground (with Check: a good manifest, misspelt and mistyped fields, a custom resource, not YAML), and the summaries' and the check's unit tests
  - ⬜ logs and port-forward, once workloads are real (pods are simulated in the playground)
- ✅ **Kubernetes-aware editor** (2026-10-28): every YAML file gets completions, hover, checks and formatting (monaco-yaml, which the owner allowed), and Kubernetes manifests get the schemas of the playground's Kubernetes: a misspelt field is a problem ("Property replica is not allowed"), and Ctrl+Space under a Deployment's spec offers its fields. The schema is one file the web app serves (`public/schemas/kubernetes.json`, 1.4 MB, made by `apps/web/scripts/kubernetes-schema.mjs` from the same pinned spec as kubeconform's, checked against its SHA-256): each of the 196 kinds' schemas applies only to a document whose apiVersion and kind name it, so other YAML (Chart.yaml, a workflow) gets nothing from it but suggestions for those two fields, and custom resources aren't errors. monaco-yaml asks for its worker the older way, so it gets a Monaco that makes it as this one wants (`monaco-setup.ts`). Test: `apps/web/test/kubernetes-yaml.e2e.mjs` 5/5; the playground template's manifests check clean
- ⬜ **Real workloads** (after the room network and databases):
  - a per-room virtual cluster (vcluster) on the platform's own cluster, with quotas and gVisor
  - for a single-owner server, an owner-enabled k3s add-on
  - images built from the room's Dockerfile (rootless BuildKit) into a per-room registry, then deployed and opened in the preview

**Track 2: CodeChatter on Kubernetes**
- 🟡 **Helm chart** (`infra/helm/codechatter`, [README](../infra/helm/codechatter/README.md)), 2026-10-10:
  - ✅ **What runs:**
    - an edge (Caddy, the routes of `infra/caddy`, on a LoadBalancer)
    - web, api and collab, with migrations as an init step
    - the runner with `RUNNER_DRIVER=kubernetes`, so rooms are namespaces on the same cluster
    - Postgres, Valkey, Mailpit, and a demo seed Job
    - secrets generated on install and kept on upgrades
  - ✅ **Locked down:**
    - every pod non-root, with a read-only root, no capabilities and seccomp
    - the runner's ClusterRole is only what it does to rooms: it can write Secrets but not read any
    - a ValidatingAdmissionPolicy lets the runner change only `cc-<namespace>-*` namespaces
  - ✅ **Images:** `pnpm k8s:images` builds the app images. Pods pull `latest` again on each start, so rebuilds reach them.
  - **Two fixes it needed:**
    - the auth package now allows a localhost `APP_URL` over plain http in production, since browsers keep Secure cookies there (`isLoopback`, tested)
    - the edge runs a copy of Caddy's binary, because the image's file capability won't start without capabilities
  - **Tested:** installed on Docker Desktop's Kubernetes at http://localhost:8090. Browser suites against it:

    | Suite | Result |
    |---|---|
    | editor | 16 |
    | databases | 15 |
    | installs | 7 |
    | new room | 4 |
    | room people | 5 |
    | search | 23 |
    | docs | 8 |
    | API studio | 7 |
    | diagrams | 7 |
    | canvas | 12 (after a fix: the canvas header kept its toolbar in place while a name was being renamed, so the first click after a rename no longer misses) |
    | templates (all seven) | 8 |
  - ⬜ **Later:**
    - several replicas (collab joined through Valkey)
    - an Ingress with cert-manager and the wildcard preview host
    - CloudNativePG
    - NetworkPolicies for the app's own namespace
- ✅ **Kubernetes runner driver** (the owner's priority, 2026-10-09; done 2026-10-10): rooms run on Kubernetes when `RUNNER_DRIVER=kubernetes`; Docker stays the light default for development, and every test runs on both. Built and tested on Docker Desktop's Kubernetes, with the official client (`@kubernetes/client-node`, added).
  - each room is a namespace (`cc-<namespace>-<room>`): deleting the room deletes the namespace, and with it everything the room had
  - K1 ✅ the sandbox as a pod (`kube-sandbox.ts`): non-root, read-only root, no capabilities, seccomp; PersistentVolumeClaims for the workspace and home; the same agent, runs, terminals and preview tunnel over the Kubernetes exec and attach API, behind one exec interface for both drivers (`RoomSandbox`, `ExecHandle`)
    - each room runs as its own user (100000 and up); every exec gets exactly the room's environment (`env -i`) and the room's process limit (`prlimit --nproc`, the agent's processes included, like Docker's PID limit)
    - running out of memory ends the whole pod on Kubernetes 1.32+ (not just the program, as on Docker): the runner notices, waits out the pod status's few seconds of lag, and starts a new pod with the next run; terminals start over
    - tested with a second runner (`RUNNER_PORT=4202 RUNNER_DRIVER=kubernetes SANDBOX_NAMESPACE=kube`, the tests' `RUNNER_URL`): runner 22/23 (network isolation is K2), judge 9/9, dev server 7/8 (databases are K3); on Docker all pass, with a new out-of-memory case in `runner.e2e.mjs`
    - on Kubernetes, databases and package installs answer 501 until K3 and K4; `/healthz` checks the cluster too
  - K2 ✅ the room network as a NetworkPolicy (`room`, made with the namespace before any pod): the room's own pods only, in and out; the sandbox pod has no DNS server, so lookups fail at once (ADR 0007, "On Kubernetes"). `network.e2e.mjs` asks the runner its driver: 11/11 on Kubernetes, 10/10 on Docker; runner 23/23 on Kubernetes
  - K3 ✅ one-click databases as StatefulSets (`kube-databases.ts`): a claim each for the data, and a Service each named after its kind (`postgres`, `mysql`…) that the sandbox finds through `/etc/hosts`; sleeping with the room scales them to 0. `Databases` is driver-neutral now (status, console, tables, backups, loads), over a small driver for each (`docker-databases.ts`). The room's password is in a Secret, in no pod spec or exec request (Mongo's clients take theirs from the environment now, on both drivers). `databases.e2e.mjs` asks the runner its driver: 33/33 on both; runner, dev server (8/8 with its databases), network and judge pass on both
  - K4 ✅ the package proxy as a pod (`kube-egress.ts`), the only one allowed out: its own NetworkPolicy lets it reach the cluster's DNS and public HTTPS, nothing else; the sandbox finds it as `egress` in its `/etc/hosts`; it exits on time, with a pod deadline behind that. Both drivers share a `PackageProxy` interface. The sandbox's relay now gives up on the proxy after 2 seconds, so "no internet" comes at once on Kubernetes too, where the room's policy drops the connection unanswered. Sandbox pods check for a newer image each start (`SANDBOX_IMAGE_PULL=Always`), so `pnpm sandbox:build` reaches the cluster. `egress.e2e.mjs` asks the runner its driver: 24/24 on Kubernetes (real npm, pip, Go, Cargo and RubyGems installs)
  - K5 ✅ every suite on both drivers.
    - **Done:** every runner suite passes on Kubernetes (runner 23, judge, network 11, egress 24, databases 33, dev server 8, every language 26, the Kubernetes playground 4) and on Docker. Getting there fixed:
      - the open-files limit: pods get about a billion, Erlang's VM ran out of memory sizing tables by it, so execs now get Docker's 1,048,576
      - the judge waiting forever on a stream nobody read
    - **Browser suites** against the Helm chart's deployment on Docker Desktop's Kubernetes (`APP_URL=http://localhost:8090`), with no change to the shared dev stack: templates 8/8 (all seven frameworks, with real installs through the proxy pod and Postgres as a StatefulSet), editor, databases, installs, new room, room people, search, docs, API studio and diagrams. Canvas 12/12 on both, after a fix to the canvas header (its toolbar moved when a name changed width, losing the click). The AI suites need an AI provider, which the demo leaves off.
  - later: gVisor RuntimeClass where the cluster has it; a pod-level PID limit (Kubernetes sets that per node, hence prlimit); the agent reporting the pod's memory and processes itself, instead of an exec before each run
- ⬜ **Scale and run:**
  - autoscaling (HPA, and KEDA for job queues), Prometheus and OpenTelemetry
  - GitHub Actions building images to GHCR, Argo CD deploying them
- ✅ **Free demo:** the chart installs on Docker Desktop's built-in Kubernetes. Steps are in the chart's README: build the images, `helm install`, open http://localhost:8090 and sign in as test1. Without Helm installed, the full sandbox image's Helm renders it for `kubectl apply`.

### E. GitHub
- ✅ Sign in with GitHub (needs a GitHub OAuth app; see Housekeeping).
- ✅ **Import a repo into a room** (2026-10-21), public or private.
  - New room has a GitHub choice: `owner/name`, `owner/name@branch`, or any GitHub link (`…/tree/branch` too). The room is named after the repository unless you name it, and the rooms list shows the repository.
  - The API downloads one tarball through the GitHub API (`api/src/github`, its own small tar reader), so the sandbox still needs no internet. Text files only: binaries, links and files over 1 MB stay out, and a room takes at most 3,000 files and 25 MB; the invite step says what came in and what stayed out.
  - The files are kept with the room (`room_repos`, gzipped, with the branch and commit) and collab seeds the room from them once, as it does templates. They're the base Source Control will compare with.
  - Private repositories: a personal access token in Settings (a new page; the user menu linked to it already). GitHub checks it when it's saved; it's sealed with AES-256-GCM under a key from BETTER_AUTH_SECRET and never sent back.
  - An "Open in CodeChatter" link: `/new?repo=owner/name` (after sign-in when needed).
  - One import at a time per person; clear messages for a missing repository, a refused token, GitHub's hourly limit without a token, and repositories over 60 MB compressed.
  - Tests: `github-import.e2e.mjs` 16/16 against real GitHub (octocat/Spoon-Knife), unit tests for the tar reader, file picking, token sealing and repository parsing.
- ✅ **Source Control panel** (2026-10-21), for rooms made from a repository (activity bar, Ctrl+Shift+G, the palette):
  - the room's changes since the last sync (changed, added, deleted), worked out in the browser against the base the API keeps; each opens as a diff, GitHub's version beside the live file; Discard puts a file back
  - commit and push to the room's branch or a new one, with your own GitHub token, through the Git Data API (a tree on the base commit, a commit, then the branch moved forward only; file modes kept). A branch with commits the room hasn't seen is refused until you pull; so is a commit with conflict markers still in it.
  - pull: the API fetches the branch, the browser merges it line by line (diff3, as git does) into everyone's files as one edit, and conflicts are marked `<<<<<<<` as in git
  - switch branches (once changes are committed or discarded); everyone's view follows a sync through the files document
  - every sync names the base it was made against, so a stale view is refused, and a room syncs one at a time
  - Tests: `apps/api/test/source-control.e2e.mjs` 23/23 against a mock GitHub with real git objects (its own API on :4011), `apps/web/test/source-control.e2e.mjs` 19/19 against real GitHub without a token, and the merge's unit tests (8)
- ✅ **Pull requests** (2026-10-21), in the Source Control view:
  - the repository's open pull requests; one opens in the editor area with its description and each file's diff (both line numbers, added and removed lines marked, binary files noted)
  - review comments on lines, as threads under them, outdated ones at the file's top; comment on any line (a removed line goes on the old side, as on GitHub) and reply, posted with your token, so it's the review GitHub shows
  - open a pull request from the room's branch into the default branch (kept from the import, `room_repos.default_branch`); from the default branch itself the room says to commit to a new branch first
  - Tests: the API suite against the mock GitHub now 34/34 (open, already open, list, files, line comment, reply, a line off the diff), `apps/web/test/pull-requests.e2e.mjs` 18/18 (real Spoon-Knife pull requests read through the API, then the review UI with the room's routes answered in the browser), and the patch parser's unit tests
- ✅ **Webhooks** (2026-10-21): pushes, pull requests (opened, merged, closed, reopened, ready for review) and finished Actions runs posted to room chat as messages from "GitHub", with their links.
  - Turned on in the Source Control view (Activity in chat, for people who manage the room). With a token that can, the webhook is made on GitHub; otherwise its address and secret show once, to add by hand. Turning it on again replaces the secret; off removes the webhook.
  - `POST /api/github/webhooks/:room` takes only deliveries signed with the room's secret (sealed in `room_repos`), about the room's repository; GitHub needs a public address to reach it (docs/deploy.md).
  - Tests: the API suite against the mock GitHub now 43/43 (made with a token, ping, push, bad or missing signature, another repository, a quiet event, reconnect, off, by hand), `apps/web/test/webhooks.e2e.mjs` 14/14 (by hand, a signed push shows in chat with its link), and the messages' unit tests
- ✅ **Export** (2026-10-21):
  - a room that isn't on GitHub shows Publish in the Source Control view (now in every room; Ctrl+Shift+G): a new repository of yours (private unless you say so, named from the room) with exactly the room's files as one commit, and the room is then linked to it, so commit, pull, pull requests and webhooks work there
  - a file as a gist from the palette ("Share the file as a GitHub gist…"), secret unless made public, with its link to copy
  - both use your token (repo and gist scopes; Settings' link asks for both)
  - Tests: the API suite against the mock GitHub (now several repositories, and gists) 52/52, `apps/web/test/export.e2e.mjs` 13/13

## Developer tooling ✅

- **Project subagents** in `.claude/agents/`: code-reviewer, test-writer, ui-auditor (design rules and accessibility), db-migration-reviewer.
- **Project hooks** in `.claude/settings.json` (scripts in `.claude/hooks/`):
  - a shell guard blocks git writes and anything that stops the shared dev stack, and blocks `pnpm dev` when it's already running
  - an edit check flags hex colours in web TSX and broken package.json or tsconfig
  - a session reminder states the house rules
- `pnpm dev:stop` stops leftover dev servers from this repo only.
- **Token use:**
  - `CLAUDE.md` holds the map and rules, so sessions don't re-explore
  - project settings drop unused git instructions and connectors, and cap long tool output
  - one piece of work at a time, in the main session; no parallel agents. Five agents running at once hit the usage limit together and stopped mid-feature.

## Housekeeping (owner actions)

- Rotate every v1 secret (`server/.env`) before any deployment.
- Add `http://localhost:8080/api/auth/callback/google` to the Google OAuth client. Create a GitHub OAuth App to enable GitHub sign-in.
- Choose hosting: Azure for Students with a college email, or your own PC with Tailscale Funnel. See `docs/deploy.md`.
