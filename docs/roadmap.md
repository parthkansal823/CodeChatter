# CodeChatter v2 roadmap

A real-time collaborative IDE: people code together in the same files, run code in a private sandbox, talk, draw, and get help from AI. This page is the complete plan, in build order, with status.

**Legend:**
- ✅ done and tested
- 🟡 in progress
- ⬜ planned

Each phase ends with automated tests and a working demo.

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
- ⬜ **Flowchart:** Mermaid source edited together, with a live render.
- ⬜ **Notes:** shared notes, private notes, and a shared focus timer.
- ⬜ **Video and voice:** LiveKit (SFU with TURN), a dock and picture-in-picture, screen share.
- ⬜ **GitHub:** import a repository, commit, push and open pull requests.
- ⬜ **Files:** uploads (images and binaries in S3), zip import and export.
- ⬜ **Notifications:** inbox with unread counts and an email digest, plus an activity feed per room.
- ⬜ **Public rooms:** explore page, open read-only, fork into your own room.

## 6. Pro editing ⬜

- ⬜ **Language servers in the sandbox:** Python (basedpyright), Go, C/C++ (clangd), Rust. TypeScript runs in the browser.
- ⬜ **Time travel:** checkpoints (manual, automatic every 10 minutes, and before AI edits), a history slider, diff, and restore.
- ⬜ **Inline comment threads** on code, anchored so they survive edits.
- ⬜ **Search and replace** across the workspace.
- ⬜ **Split and diff editors.**
- ⬜ **Follow and Present mode:** see what a teammate sees.
- ⬜ **Command palette and shortcuts:** one hotkey registry, a shortcuts sheet, and keybinding settings.
- ⬜ **Source Control panel:** real git in the sandbox (branch, diff, commit, push).
- ⬜ **Secret scanning** before a push.

## 7. Interview mode ⬜

- ⬜ Question bank with starter code and test cases (visible and hidden).
- ⬜ Schedule an interview, with interviewer and candidate roles and a single-use candidate link.
- ⬜ Server-side timer and phases.
- ⬜ Tests panel: a judge container runs the hidden tests. The candidate sees pass counts; interviewers see diffs.
- ⬜ Private rubric and scorecards that the candidate never receives.
- ⬜ Replay: code, runs and chat on one timeline.
- ⬜ Report export.

## 8. Teams and admin ⬜

- ⬜ **Organisations:**
  - roles: owner, admin, member, guest
  - invitations, and auto-join by email domain
  - organisation templates and policies
- ⬜ **Room roles:** owner, editor, runner, viewer, interviewer, candidate. One permission matrix (done) drives all of them.
- ⬜ **Settings pages:**
  - profile
  - security: 2FA, active sessions
  - appearance, editor, notifications, connected accounts
- ⬜ **Audit log:** filters and CSV export.
- ⬜ **Usage dashboard:** runs, AI tokens, sandbox minutes, with quotas.
- ⬜ **Instance admin:** users, rooms, health.

## 9. Automations and platform ⬜

- ⬜ **Workflow builder** (n8n-style canvas):
  - triggers: file saved, run finished, chat message, schedule, webhook, GitHub push
  - actions: run tests, AI agent, post to chat, email, Slack/Discord, HTTP request, checkpoint, GitHub PR
  - logic: conditions and delays
  - run history and retries
- ⬜ **Outgoing webhooks:** signed with HMAC, with retries and a delivery log.
- ⬜ **Public API** with personal access tokens, and a `cc` CLI that syncs a folder with a room.
- ⬜ **CodeChatter MCP server:** Claude Code, Claude Desktop and Cursor can open rooms, read and edit files, and run code.
- ⬜ **Dependency alerts (OSV)** and `devcontainer.json` support.

## 10. Hardening and launch ⬜

- ⬜ **Sandbox and browser security:** gVisor runtime, CSP with nonces, and a separate origin for previews.
- ⬜ **Operations:** OpenTelemetry traces, Prometheus metrics, dashboards, and nightly backups.
- ⬜ **Load test:** k6, 50 rooms × 10 people, with 95% of updates delivered in under 150 ms.
- ⬜ **Accessibility:** an axe audit with zero violations. Lighthouse score of 90+ on marketing pages.
- ⬜ **GitHub Actions CI:** lint, types, tests, e2e, image build, vulnerability scan.
- ⬜ **Cutover from v1:** move the data from MongoDB, then delete `client/` and `server/`.
- ⬜ **Security review:** a final pass over everything above.

## 11. Advanced features ⬜

### Deeper collaboration

- ⬜ **Multiplayer debugger:**
  - breakpoints everyone sees, stepping together, and a shared variables and call-stack view
  - Debug Adapter Protocol in the sandbox: debugpy for Python, the Node inspector, gdb for C/C++
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
- ⬜ **Database playground:** SQLite or Postgres inside the sandbox, a SQL console, and a table viewer.
- ⬜ **HTTP client:** a Postman-style request builder aimed at the room's running server.
- ⬜ **Package manager:** search npm and PyPI and add a dependency in one click (through the network switch).
- ⬜ **Problems panel:** linters (ruff, ESLint, clang-tidy) run in the sandbox, with diagnostics shared by everyone.
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
6. 🟡 Framework templates (C): room.json, the Dev server tab, and seven templates (React, Vue, Svelte, Express with PostgreSQL, FastAPI, Flask, Django). More templates and pre-warmed caches next.
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
  - ⬜ PNG, JPEG and other binary images: they need binary files in the room first (§5 Files; today the sandbox syncs text files only)
  - ⬜ grid splits
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
  - tests: `lsp.test.ts` 6/6, `apps/runner/test/lsp.e2e.mjs` 8/8, browser `apps/web/test/lsp.e2e.mjs` 9/9
  - ⬜ next: C and C++ (clangd), Go (gopls) and Rust (rust-analyzer) in the full image, Java (jdtls); TypeScript and JavaScript already have IntelliSense in the browser
  - ⬜ a Problems panel listing every file's problems
- 🟡 **Formatters** (2026-10-20): Format document (Shift+Alt+F, and on save when that's on) for languages the browser can't format itself runs their formatter in the room's sandbox, inside the jail:
  - ✅ Python (Ruff), C and C++ (clang-format, following a `.clang-format` file), shell (shfmt, with the editor's indentation) in both images; Go (gofmt) and Rust (rustfmt) in the full image
  - ✅ the result lands as small edits, one per changed run of lines, so others' cursors stay put (`editor/line-edits.ts`); one Undo puts it back; a syntax error leaves the file alone and shows the formatter's message
  - JavaScript, TypeScript, JSON, CSS and HTML keep Monaco's own formatter in the browser
  - tests: `line-edits.test.ts` 6/6, `apps/runner/test/format.e2e.mjs` 9/9, browser `apps/web/test/format.e2e.mjs` 8/8
  - ⬜ Java (google-java-format), and Prettier for a project that has its own config
- ⬜ **Debugger:** breakpoints, step, variables, watch, call stack and a debug console, over the Debug Adapter Protocol (debugpy, Node inspector, gdb or lldb, Delve) in the sandbox.
- 🟡 **Personal settings:**
  - ✅ font size and ligatures, tab size and indentation, word wrap, minimap, line numbers, whitespace, cursor style, bracket colours, sticky scroll, format on save (Ctrl+,)
  - ✅ **Vim key bindings** (2026-10-20, `monaco-vim`, loaded only for people who turn them on): Settings, Key bindings, or the palette; modes, motions, operators, registers and : commands, with the mode and the command line under the editor; `:w` does what Ctrl+S does. Browser `keys.e2e.mjs` 12/12 (with Emmet)
  - ⬜ Emacs key bindings (the `monaco-emacs` package hasn't been updated since 2022), themes (import VS Code theme JSON), settings saved to your account rather than this browser
- ⬜ **Tasks and launch configs** (`.vscode/tasks.json` and `launch.json` understood).
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
  - ⬜ the room owner picks base or full per room; today one setting covers the whole server
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
- ⬜ Later: SQLite in the panel (it needs no server: `sqlite3` is in the full image), DuckDB, ClickHouse, OpenSearch, Neo4j.

### C. Frameworks 🟡
- ✅ **`.codechatter/room.json`** says how to install, run and preview a room: `install` (run when the `installed` path is missing), `dev`, `port`, and the `databases` to start first. Templates and imported projects both use it; a broken one is explained, not run.
- ✅ **The Dev server tab** (bottom panel, when the room has a room.json):
  - **Start** installs if needed (through the package proxy), starts the room's databases, then runs the dev server in one terminal everyone in the room shares
  - **Restart** and **Stop**; **Open preview** once its port listens (on its own origin)
  - when the first start must install packages and installs are off, the owner gets one button, **Allow installs and start**; others are told to ask the owner
  - starting and stopping need terminal rights and go in the audit log
- 🟡 **Templates that start in one click:**
  - ✅ frontend: React, Vue and Svelte, each on Vite with live reload in the preview
  - ✅ backend: Express with the room's PostgreSQL (started with it), FastAPI, Flask and Django; the Node.js API template has a room.json too
  - ⬜ frontend: Next.js, Nuxt, SvelteKit, Angular, Astro, Solid
  - ⬜ backend: NestJS, Fastify, Hono, Spring Boot, Laravel, Rails, Gin, Axum, ASP.NET Core (the JVM, PHP, Ruby, Go, Rust and .NET ones need their build tools in the image)
- ⬜ **Pre-warmed caches** for the templates, so a new React or Django room starts in seconds (today the first start downloads its packages, about a minute).
- ✅ **Tests:**
  - `apps/runner/test/dev.e2e.mjs` (8/8): reads room.json; installs first and skips it on restart; starts its databases; answers through the preview; explains a broken room.json; stops
  - `apps/web/test/templates.e2e.mjs`: as a person would, for all seven: a room from the template, allow installs, Start, then the app works in the preview (the front ends' counters count). Real downloads, 15 to 60 seconds each; each room is deleted after. `TEMPLATES=react,flask` runs some

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
  - ⬜ `kubeconform` with offline schemas, so manifests can be checked without a cluster
- ⬜ **Kubernetes panel** (like Lens or VS Code's Kubernetes extension):
  - namespaces, workloads, services and events; YAML and describe for anything
  - apply the open file in one click; logs and port-forward once workloads are real
- ⬜ **Kubernetes-aware editor:** YAML completions and checks from the Kubernetes schemas (monaco-yaml, which needs a new package; kubeconform as the fallback in the sandbox).
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
- ⬜ **Import a repo into a room**, public or private (your token is encrypted).
  - The API downloads it through the GitHub API, so the sandbox still needs no internet.
  - An "Open in CodeChatter" link: `/new?repo=owner/name`.
- ⬜ **Source Control panel:**
  - changes since the last sync, diffs, and commit and push to a branch
  - commits are made through the GitHub API from the room's files
  - pull, which arrives as a normal edit everyone sees
  - switch branches
- ⬜ **Pull requests:** open a PR from the room, and review a PR's diff in the room with comments synced to GitHub.
- ⬜ **Webhooks:** pushes, PRs and Actions results posted to room chat.
- ⬜ **Export:** a room to a new repo in one click; a file as a gist.

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
