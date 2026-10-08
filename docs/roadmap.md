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
| 4 | AI copilot and AI agent | The most impressive feature in a demo |
| 5 | Collaboration tools | Whiteboard, notes, video: what makes it a *room*, not just an editor |
| 6 | Pro editing | What professional users expect: LSP, history, comments, git |
| 7 | Interview mode | A complete product use case (hiring) |
| 8 | Teams and admin | Organisations, roles, audit: "industry use" |
| 9 | Automations and platform | n8n-style workflows, webhooks, API, CLI, MCP |
| 10 | Hardening and launch | Security, performance, observability, CI |
| 11 | Advanced features | Features most IDEs don't have. The headline ones are pulled forward (below) |
| 12 | Workspace suite (section 13) | Notion, Obsidian, Postman, Figma and Slack features built in. Runs after phase 4 (AI), in the order given in section 13 |

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

## 4. AI copilot and AI agent ⬜

**Copilot:**
- ⬜ **Provider router:** Claude, OpenAI-compatible, Gemini and Ollama. Keys are per organisation and encrypted at rest.
- ⬜ **AI panel:** chat about the code with context chips (file, selection, errors, terminal output) and slash commands. Streamed replies are saved per room.
- ⬜ **Inline completions:** ghost text as you type, with debounce and rate limits.
- ⬜ **AI edit:** select code and describe the change, then review the diff and accept it. A checkpoint is taken first, so it can be undone.
- ⬜ **Explain this error:** one click from failed Run output.
- ⬜ **AI diagram:** a Mermaid flowchart generated from code or a description.

**AI coding agent:**
- ⬜ It plans, edits several files, runs commands and tests in the sandbox, reads the errors, and tries again.
- ⬜ Every step appears in an Agent panel with approve, reject and undo. You can turn on auto-approve for safe steps.
- ⬜ Agent-written code is shown in its own typeface (Monaspace Krypton).

**Also:**
- ⬜ AI session summaries posted to chat.
- ⬜ Usage metering and quotas per organisation.

## 5. Collaboration tools ⬜

- ⬜ **Whiteboard:** Excalidraw, synced live through Yjs.
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

### API studio (like Postman)

- ⬜ **Collections:** folders and requests saved in the room and edited together live.
- ⬜ **Request builder:**
  - methods, parameters, headers, and bodies (JSON, form, multipart, raw, GraphQL)
  - auth helpers: Bearer, Basic, API key, OAuth 2.0
- ⬜ **Environments and variables** (`{{baseUrl}}`). Secret values are encrypted and hidden from viewers.
- ⬜ **Send from the sandbox** (reaches the room's own server) or through the server (public APIs), with timing and size.
- ⬜ **Response viewer:** pretty JSON with folding and search, headers, cookies, and HTML preview.
- ⬜ **Tests:** assertions on the response (status, JSON path, schema), a collection runner, run history.
- ⬜ **Import and export:** OpenAPI, Postman collections, cURL. Code snippets for fetch, axios, requests, curl and Go.
- ⬜ **Mock server:** example responses served at a room URL, so the frontend can start before the backend.
- ⬜ **WebSocket and Server-Sent Events** tester.

### Design canvas (like Figma)

- ⬜ **Multiplayer vector canvas:** frames, rectangles, ellipses, lines, pen paths, text and images, with live cursors.
- ⬜ **Layers and properties:**
  - a layers panel with groups
  - a properties panel: position, size, fill, stroke, radius, effects, typography
  - alignment and snapping
- ⬜ **Components and styles:**
  - reusable components with instances and variants
  - colour and text styles, exported as CSS variables or Tailwind tokens
- ⬜ **Auto layout** (stack direction, gap, padding) for frames.
- ⬜ **Prototype mode:** link frames with click-through transitions and a present view.
- ⬜ **Dev handoff:** inspect generated CSS and export PNG, SVG or PDF. "Turn this frame into code" with the AI.
- ⬜ **Comments** pinned on the canvas.

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
