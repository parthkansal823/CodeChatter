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
  - read-only mode for viewers
- ✅ Room chat: history, offline outbox, code snippets, unread badge.

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

The **AI** tab sits next to Chat. This PC runs it on **local Ollama** (`AI_PROVIDER=ollama`, `AI_MODEL=hermes3`): free, private, no key. Other options are in `.env.example`.

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
  - 🟡 **TURN over TLS** on its own public TCP 443 address, for networks that only allow HTTPS (UDP TURN and TCP 7881 don't get through those). Also browser tests of a forced relay and of screen sharing. Handed to ChatGPT: the brief is `docs/handoff/chatgpt-12-turn-tls.md`.
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

Tests: `apps/api/src/interviews/views.test.ts` (6), `apps/web/components/interviews/{replay,report}.test.ts` (11), `apps/collab/src/extensions/revocation.test.ts` (2), `apps/runner/test/judge-isolated.e2e.mjs` (9), `apps/collab/test/interviews.e2e.mjs` (78, including the timer taking rights from an open editor), `apps/web/test/interviews.e2e.mjs` (32, the whole flow with a guest). All three end-to-end suites are in `scripts/e2e-ci.mjs`.

Found by those tests and fixed:

- Hocuspocus's `closeConnections` detaches the document but leaves the socket open, so a candidate's editor would have gone silently stale. Revocation closes the socket.
- A scorecard stayed on "Save" after saving, because `jsonb` returns keys in its own order. The form compares values.

What's left is in `docs/pending.md` under step 11.

## 8. Teams and admin ⬜

- 🟡 **Organisations:** making a team (`/orgs/new`, which the switcher links to but doesn't exist), the members page, and the invitation page (`/invite/<id>`, which invitation emails already link to). Handed to ChatGPT: the brief is `docs/handoff/chatgpt-9-org-members.md`.
  - roles: owner, admin, member, guest
  - invitations, and auto-join by email domain
  - organisation templates and policies
- ✅ **Room roles:** owner, editor, runner, viewer, interviewer, candidate. One permission matrix drives all of them, and interview mode (§7) gives the last two their use.
- 🟡 **Settings pages:** profile, password, two-factor sign-in (the sign-in step exists, but nothing turns it on) and active sessions. Handed to ChatGPT: the brief is `docs/handoff/chatgpt-10-account-security.md`.
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
  - **Follow-ups handed to ChatGPT** (`docs/handoff/chatgpt-13-follow-ups.md`), found while checking:
    - the worker should claim deliveries with a lease rather than hold one transaction across up to 20 sends; one failed update now rolls back the batch, and everything in it is sent again;
    - old deliveries should be deleted after 30 days, and ones left pending while a webhook was paused should expire;
    - also the audit CSV's silent 10,000-row cap, and a `WORKERS` option for the load test.
  - **Tests:**
    - unit tests for the signature and the service (API 482/482);
    - `apps/api/test/webhooks-out.e2e.mjs` 35/35, with its own API on :4013 and its own receiver;
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

- ⬜ **Sandbox and browser security:** gVisor runtime, CSP with nonces, and a separate origin for previews.
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
    - **29 suites:** 13 for the runner, collab and the API, and 16 in the browser. They need neither the full image, nor a paid AI key, nor real GitHub. All 29 pass here, with no retries, in about 7 minutes.
    - **Failures** become annotations on the run, with a table on its page; logs and screenshots are kept as artifacts.
    - **Found on the way:**
      - suites run back to back trip the 10-a-minute sign-in limit, so the script clears only those counters in the dev Valkey before each suite (the limit itself stays, and `auth-flow.e2e.mjs` checks it);
      - the browser tests load Playwright from `spikes/s1-editor`, which the root install doesn't install, so the workflow installs it;
      - `isolation.e2e.mjs` flagged the read-only template cache (`cc-dev-warm`), and now allows it;
      - `apps/collab/test/collab.e2e.mjs` is from the first spike and expects files E2ETST doesn't have, so it's left out.

  Still to do:
  - the workflow's first run on GitHub.
- ⬜ **Cutover from v1:** move the data from MongoDB, then delete `client/` and `server/`.
- ⬜ **Security review:** a final pass over everything above.

## 11. Advanced features ⬜

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

The **API** tool in the activity bar. Browser test: `apps/web/test/api-studio.e2e.mjs` (7/7, two people).

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
  - test scripts with `expect()`, run in a worker
  - a collection runner, and history
- 🟡 **Import and export:**
  - ✅ cURL import
  - ✅ code snippets for curl, fetch, Python and Go
  - ⬜ OpenAPI and Postman import, axios
- ⬜ **Mock server:** example responses served at a room URL, so the frontend can start before the backend.
- ⬜ **WebSocket and Server-Sent Events** tester.

### Design canvas (like Figma) 🟡

The **Design** tool. Tests:
- browser: `apps/web/test/canvas.e2e.mjs` (12/12, with the whiteboard)
- canvas engine and PDF writer: 50/50

- ✅ **Multiplayer vector canvas:**
  - frames, rectangles, ellipses, lines, arrows, pen paths, text, sticky notes and images
  - edited live together, with presence
  - several designs per room
- 🟡 **Layers and properties:**
  - ✅ a layers panel (rename, hide, lock, reorder)
  - ✅ a properties panel; alignment and snapping
  - ⬜ groups
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

The **Diagrams** tool is the real draw.io editor (open source, Apache 2.0), embedded through its official embed mode. It has every draw.io feature: all shape libraries (flowchart, UML, ER, BPMN, network, cloud…), connectors and layouts, pages and layers, and its own export dialogs. Browser test: `apps/web/test/diagrams.e2e.mjs` (7/7, two people).

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
  - loads from embed.diagrams.net by default; PDF export goes through draw.io's server
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
