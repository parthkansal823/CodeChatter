# What's left

Every unfinished piece of CodeChatter v2, grouped by the steps of the pathway ([roadmap.md](roadmap.md)). It's updated with the pathway after every finished piece. A finished piece leaves this page, and its write-up goes into [roadmap-details.md](roadmap-details.md).

**Who:**
- **Claude:** built in this repository's sessions.
- **ChatGPT N:** a prompt in `docs/handoff/chatgpt-N-*.md`. You paste it in, bring the answer back, and Claude checks it before it counts as done.
- **You:** the owner's own actions.

🟡 means started, ⬜ not started.

## In progress (2026-11-05)

- 🟡 **ChatGPT 8, metrics.**
  - Done: collab and runner `/metrics`, behind `METRICS_TOKEN`, not public; `prom-client` 15.1.3 is installed.
  - Still coming: the API's `/metrics`, the Grafana dashboards, and the docs.
- ✅ Just finished by Claude: binary files, and deleting a room's stored files with the room.

## Up next, in order

1. **Claude:** real git in the sandbox (step 7). It's the last piece of pro editing.
2. **ChatGPT**, one prompt at a time, each checked before the next: **13** (follow-ups) → **9** (teams) → **10** (account security) → **11** (backups) → **12** (TURN over TLS).
3. **Claude:** end-to-end tests in CI (step 10), once CI's first run on GitHub is green.
4. **Claude:** interview mode (step 11), with the interviewer and candidate room roles (step 8).
5. **You:** record the README's GIF and 2-minute video (step 12).
6. Then step 10's security and accessibility passes, and the cutover from v1, before launch.

## Your actions

- **Commit and push** what's uncommitted, then check that CI's run on GitHub is green.
- **Before deploying:**
  - rotate every v1 secret (`server/.env`);
  - add the Google OAuth callback (`http://localhost:8080/api/auth/callback/google`);
  - choose hosting (`docs/deploy.md`).
- **Record** the README's GIF and video. The script is in `docs/demo-script.md`.
- **Later:** `prom-client` was deprecated in August 2026 in favour of `@prometheus-io/client`, so moving to it is a package change for you to approve.

## Step 3 · A full IDE

- ⬜ Emacs key bindings (the `monaco-emacs` package hasn't been updated since 2022)
- ⬜ One Java language server shared by the room's editors, to save memory
- ⬜ Node debugging: `runtimeExecutable`, npm-script configurations, processes a program starts
- ⬜ Extensions from Open VSX through the VS Code extension host. This is the largest piece, so it comes last.
- ⬜ Languages from official releases: Zig, Nim, Julia, Dart, Swift, Scala 3, F#
- ⬜ Databases: ClickHouse, OpenSearch, Neo4j; DuckDB backups
- ⬜ Templates: Rails, ASP.NET Core; warm Go's and Cargo's caches too
- ⬜ Kubernetes:
  - real workloads;
  - then logs and port-forward in the panel.
- ⬜ Helm, later:
  - several replicas;
  - an Ingress with cert-manager and the wildcard preview host;
  - CloudNativePG;
  - NetworkPolicies for the app's namespace.
- ⬜ Scale and run: autoscaling (HPA, KEDA), images built to GHCR, Argo CD

## Step 4 · AI copilot and agent

- ⬜ Per-organisation AI keys, encrypted at rest
- ⬜ AI diagram: a Mermaid flowchart from code or a description (the Mermaid preview is built)
- ⬜ Agent: auto-approve safe steps, and a loop that reads errors and tries again
- ⬜ Agent-written code in its own typeface (Monaspace Krypton)
- ⬜ Post the room summary to chat
- ⬜ AI quotas per organisation

## Step 5 · Workspace suite

- ⬜ **Docs:**
  - toggles, runnable code blocks, images, math, Mermaid, drag to reorder;
  - organisation-wide pages, covers, recent pages;
  - the database view UI;
  - embeds;
  - suggestions;
  - custom slugs and PDF export.
- ⬜ **Knowledge base:**
  - Markdown notes as real `.md` files;
  - line anchors (`#L10`) and hover previews in code links;
  - offline first.
- ⬜ **API studio:**
  - multipart and OAuth 2.0;
  - a cookies tab;
  - OpenAPI and Postman import, and axios snippets;
  - a mock server;
  - a WebSocket and SSE tester.
- ⬜ **Design canvas:**
  - groups;
  - variants and shared colour and text styles;
  - prototype mode;
  - "turn this frame into code" with the AI;
  - comments on the canvas.
- ⬜ **Diagrams:**
  - draw.io in production compose;
  - comments on shapes;
  - diagrams in Docs pages;
  - AI "draw this as a diagram".
- ⬜ **Messaging:**
  - channels and conversations;
  - rich messages and unread tracking;
  - huddles;
  - slash commands and bots;
  - presence and status;
  - search.
- ⬜ **Across the suite:**
  - one command bar (Ctrl+K);
  - one permissions model;
  - AI everywhere.

## Step 6 · Collaboration tools

- 🟡 TURN over TLS on port 443, with tests for a forced relay and for screen sharing (**ChatGPT 12**)
- ⬜ Binary files (**Claude**):
  - collect stored objects that no file or checkpoint uses any more;
  - binary files in GitHub import and commits;
  - a streaming download.

## Step 7 · Pro editing

- ⬜ **Real git in the sandbox** (**Claude**, next): `git` commands and the Source Control panel on the sandbox's own repository, beside today's GitHub API flow

## Step 8 · Teams and admin

- 🟡 Teams: `/orgs/new`, members, invitations (`/invite/<id>`) (**ChatGPT 9**)
  - then a guest role, auto-join by email domain, organisation templates and policies
- 🟡 Account: profile, password, two-factor, active sessions (**ChatGPT 10**)
  - then pages for appearance, notifications and connected accounts
- ⬜ Room roles for interviews: interviewer and candidate (**Claude**, with step 11)
- ⬜ Usage dashboard: runs, AI tokens and sandbox minutes, with quotas
- ⬜ Instance admin: users, rooms, health

## Step 9 · Automations and platform

- 🟡 Webhooks follow-ups (**ChatGPT 13**):
  - a lease instead of one long transaction;
  - delivery retention;
  - expiring deliveries left pending while a webhook was paused.
- ⬜ Dependencies:
  - a per-person rate limit;
  - a fade that shows the side tabs scroll.
- ⬜ Workflow builder (n8n-style): triggers, actions, conditions, run history
- ⬜ Public API with personal access tokens, and a `cc` CLI that syncs a folder with a room
- ⬜ MCP server: Claude Code, Claude Desktop and Cursor open rooms, edit and run
- ⬜ `devcontainer.json` support

## Step 10 · Hardening and launch

- 🟡 Prometheus metrics and Grafana dashboards (**ChatGPT 8**, in progress)
- 🟡 Nightly backups and a restore drill (**ChatGPT 11**)
- ⬜ OpenTelemetry traces
- 🟡 CI:
  - a first green run on GitHub (**you**, push);
  - end-to-end tests in CI (**Claude**).
- 🟡 Follow-ups (**ChatGPT 13**):
  - the audit log's CSV streamed with no silent cap;
  - the filter labels lined up;
  - a `WORKERS` option for the load test.
- ⬜ Sandbox and browser security: gVisor runtime, CSP with nonces, a separate origin for previews
- ⬜ Accessibility: an axe audit with no violations; Lighthouse 90+ on marketing pages
- ⬜ Cutover from v1: move the data from MongoDB, then delete `client/` and `server/`
- ⬜ A final security review

## Step 11 · Interview mode (**Claude**)

- ⬜ Question bank with starter code and test cases, visible and hidden
- ⬜ Schedule an interview, with interviewer and candidate roles and a single-use candidate link
- ⬜ Server-side timer and phases
- ⬜ A tests panel: the judge runs the hidden tests. The candidate sees pass counts, and interviewers see diffs.
- ⬜ Private rubric and scorecards the candidate never sees
- ⬜ Replay: code, runs and chat on one timeline
- ⬜ Report export

## Step 12 · Recruiter kit

- ⬜ The README's GIF and 2-minute video (**you** record them; `docs/demo-script.md`)

## Step 13 · Advanced features

- ⬜ **Together:** suggestion mode, room branches, live authorship, session recording and replay, smarter calls (captions, AI notes)
- ⬜ **Developer tools:**
  - a test explorer with coverage;
  - a profiler (flame graphs);
  - package search and one-click add;
  - room secrets;
  - a public deploy preview.
- ⬜ **AI:**
  - ask the codebase (semantic search with citations);
  - an AI team (builder, reviewer, tester);
  - a natural-language terminal;
  - generated tests and docs;
  - AI code review.
- ⬜ **Learning:** classroom mode, contest and hackathon mode
- ⬜ **Enterprise:** SSO and SCIM, plans and billing, data controls (retention, export, deletion), a plugin SDK
- ⬜ **Reach:** a Hindi and English interface, an installable app (PWA), a mobile layout, embeddable read-only rooms

## Ideas you picked, still open (§12)

- ⬜ In-browser runner (Pyodide and JavaScript with no server), so the free demo site runs code
- ⬜ Public profile and portfolio
- ⬜ Code and algorithm visualizer, with AI narration
- ⬜ Code tours
- ⬜ A task board, with TODO and FIXME comments as cards
- ⬜ Math (KaTeX) and Mermaid inside the Markdown preview
- ⬜ VS Code extension: join a room from VS Code
- ⬜ More interface languages: Hindi first
