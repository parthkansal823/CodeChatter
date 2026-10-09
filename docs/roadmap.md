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
| 2 | Run and terminal in a sandbox | 🟡 The core promise of a coding room |
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

## 2. Run and terminal in a sandbox 🟡

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
- ⬜ Network switch (owner only, audited, turns itself off after 1 hour, allow-listed package registries).
- ⬜ Python notebooks (.ipynb) with a kernel in the sandbox.

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
- ⬜ A test that rooms can't read each other's files (by design each room has its own volume and container).

## 3. Recruiter kit ⬜

- ✅ **"Try the demo" button** (landing page and sign-in):
  - one click makes a guest account and opens a guided-tour room with runnable examples and pre-filled tests; no sign-up, no email
  - limited to 5 a hour per network; guests are deleted after a day; `DEMO_ENABLED` turns it on in production
  - browser test 4/4
- ⬜ **README:** GIF, 2-minute video link, feature list, architecture diagram, tech stack, "run it in 3 commands".
- ⬜ **Showcase mode:** the landing page deployable on Vercel for free, with buttons that open the video and GitHub.
- ⬜ Demo video script: what to record and in which order.

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
- ⬜ **Inline completions:** ghost text as you type, with debounce and rate limits.
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
5. One-click databases (D).
6. Framework templates (C).
7. GitHub (E). Its import and push go through the GitHub API, so they can start earlier if you want.
8. Kubernetes (F): the playground can come any time (it needs nothing else); real workloads come after the room network and databases; the Helm chart and Kubernetes runner come with production hardening.

### A. Editor at VS Code level 🟡
Monaco is VS Code's editor, and `monaco-vscode-api` brings VS Code's own services, so most of this is wiring, not rebuilding. Browser test: `apps/web/test/editor.e2e.mjs` (12/12, two people).
- 🟡 **Navigation:**
  - ✅ the **command palette**: F1 or Ctrl+Shift+P (Edge keeps Ctrl+Shift+P for InPrivate windows, so F1 is the sure one), with about 150 commands: the room's, the editor's, and Monaco's own editing actions
  - ✅ a **command centre** in the title bar: search files, or type `>` for commands
  - ✅ **Quick Open** (Ctrl+P, fuzzy), **go to line** (Ctrl+G, `line:column` works), **go to symbol** (Ctrl+Shift+O)
  - ⬜ breadcrumbs and an Outline view
- 🟡 **Editing:**
  - ✅ multi-cursor and column selection, folding, sticky scroll, bracket-pair colours and guides, minimap
  - ✅ format document (Shift+Alt+F); Ctrl+S formats when "format on save" is on; every edit saves as you type
  - ⬜ snippets, Emmet for HTML and CSS
- 🟡 **Layout:**
  - ✅ a **split editor** (Ctrl+\\) with any file on the right
  - ✅ **compare two files** in a diff editor; both sides are the live files
  - ✅ **Markdown live preview**, updating as anyone types:
    - beside the file (Ctrl+K V, or the tab bar's Markdown preview button)
    - or on its own to read (Ctrl+Shift+V, or Preview only)
  - ✅ **Zen mode** (Ctrl+K Z) hides everything but the code
  - ⬜ grid splits, an image viewer, CSV as a table
- ✅ **Change language mode** for a file, from the palette or the status bar.
- ✅ **Follow someone:** their file opens for you as they move, with a banner and a Stop button (like Live Share).
- ⬜ **Search:** across all files with regex, case and whole-word options, include and exclude globs, and replace-all.
- ⬜ **IntelliSense for every language:**
  - language servers run inside the room's sandbox (basedpyright, typescript-language-server, clangd, jdtls, gopls, rust-analyzer…), reached over a WebSocket through the API and runner (§5 of the plan)
  - gives completions, hover docs, signature help, go to definition and references, rename, quick fixes, and a Problems panel
- ⬜ **Formatters:** Prettier, Black or Ruff, clang-format, gofmt, rustfmt, google-java-format, run in the sandbox.
- ⬜ **Debugger:** breakpoints, step, variables, watch, call stack and a debug console, over the Debug Adapter Protocol (debugpy, Node inspector, gdb or lldb, Delve) in the sandbox.
- 🟡 **Personal settings:**
  - ✅ font size and ligatures, tab size and indentation, word wrap, minimap, line numbers, whitespace, cursor style, bracket colours, sticky scroll, format on save (Ctrl+,)
  - ⬜ Vim and Emacs keybindings, themes (import VS Code theme JSON), saved to your account
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
- ⬜ **Python data pack:** numpy, pandas, matplotlib (plots shown in Output), Jupyter notebooks (§2).

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

### D. One-click databases
- ⬜ **A Databases panel:** pick PostgreSQL, MySQL, MariaDB, MongoDB, Redis (Valkey) or SQLite.
  - one click starts it for the room, with data on the room's volume and its own memory limit
  - it stops when the sandbox idles
- ⬜ **Connecting from your code:**
  - the connection string is shown in the panel and set as environment variables in Run and terminals (`DATABASE_URL`, `REDIS_URL`, …)
  - your code reaches the database by name (`postgres:5432`) on the room network
- ⬜ **Query console and table browser** in the panel. Queries run through the runner; the browser never connects to the database directly.
- ⬜ **Seed, dump and restore**, reset, delete. Viewers can read; editors can change.
- ⬜ Later: DuckDB, ClickHouse, OpenSearch, Neo4j.

### C. Frameworks
- ⬜ **Templates that start a dev server in one click**, with the preview on its own origin (it exists already):
  - frontend: React (Vite), Next.js, Vue, Nuxt, Svelte/SvelteKit, Angular, Astro, Solid
  - backend: Express, NestJS, Fastify, Hono, Django, Flask, FastAPI, Spring Boot, Laravel, Rails, Gin, Axum, ASP.NET Core
- ⬜ **`.codechatter/room.json`** says how to install, run and preview (command, port, database to start). Templates and imported projects both use it.
- ⬜ **Dependencies:** "Install dependencies" through the package proxy, plus pre-warmed caches for the templates, so a new React or Django room starts in seconds.

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
- ⬜ **Helm chart** (`infra/helm/codechatter`):
  - web, api, collab (several replicas, joined through Valkey), runner, worker
  - Postgres (CloudNativePG) and Valkey; Ingress with cert-manager and the wildcard preview host
- ⬜ **Kubernetes runner driver:** each room's sandbox is a pod instead of a Docker container.
  - gVisor RuntimeClass; non-root, read-only root, no capabilities, seccomp
  - deny-all NetworkPolicy; a PersistentVolumeClaim per room
  - the same agent, runs, terminals and preview tunnel, over the Kubernetes exec and attach API
- ⬜ **Scale and run:**
  - autoscaling (HPA, and KEDA for job queues), Prometheus and OpenTelemetry
  - GitHub Actions building images to GHCR, Argo CD deploying them
- ⬜ **Free demo:** the chart installs on Docker Desktop's built-in Kubernetes or `kind`.

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
