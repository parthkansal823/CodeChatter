# What's left

Every unfinished piece of CodeChatter v2, grouped by the steps of the pathway ([roadmap.md](roadmap.md)). It's updated with the pathway after every finished piece. A finished piece leaves this page, and its write-up goes into [roadmap-details.md](roadmap-details.md).

**Who:**
- **Claude:** built in this repository's sessions.
- **ChatGPT N:** a prompt in `docs/handoff/chatgpt-N-*.md`. You paste it in, bring the answer back, and Claude checks it before it counts as done.
- **You:** the owner's own actions.

🟡 means started, ⬜ not started.

## In progress (2026-11-06)

- ✅ Checked: ChatGPT's prompt 11 (nightly backups and the restore drill), prompt 10 (account security: profile, password, two-factor, active sessions), prompt 9 (teams: `/orgs/new`, members, `/invite/<id>`) and prompt 13 (webhook leases and retention, the audit CSV, the load test's `WORKERS`).
- ✅ Just finished by Claude:
  - accessibility: no axe violations on 93 screens, open files reachable by keyboard, and Lighthouse 90+ on the marketing page (`apps/web/test/a11y.e2e.mjs`);
  - signing out a device now ends what it has open, at once: the live document, chat, terminals, language servers and the debugger;
  - the AI's review, further: signals worked out by code, checked quotes, reviewing a whole batch, and a real model (`gemma4:e4b`, in Docker: `pnpm ai:up:gpu`);
  - recording assessments (webcam and screen, with consent) and the AI's review of a sitting, which points and suggests questions and never decides (step 11);
  - interviews and assessments as two modes (step 11): live interviews on video with questions asked on the spot and the AI switch; assessments with a paper drawn for each candidate; multiple choice, short answers and system design; the integrity record; results tables; comparing code (`docs/interviews.md`);
  - managing a room's members (approve, decline, remove, change roles, leave), and the invite link from Share;
  - the browser security policy, checked against a production build (`docs/adr/0010-content-security-policy.md`);
  - access ending when a public room goes private or a room is deleted;
  - the old live-document test working again, in CI (`apps/collab/test/collab.e2e.mjs`);
  - interview mode (step 11), with the interviewer and candidate room roles (`docs/interviews.md`);
  - end-to-end tests in CI, green on GitHub (39 suites in 15 minutes, 2026-11-06);
  - metrics and dashboards checked (ChatGPT 8);
  - real git in the sandbox (step 7);
  - binary files, and deleting a room's stored files with the room.

## Up next, in order

1. **ChatGPT**, one prompt at a time, each checked before the next: **14** (API Studio: OpenAPI and Postman import, axios) → **15** (task board) → **16** (appearance, notifications and connected accounts). **12** (TURN over TLS) can wait: it only matters once it's deployed.
2. **Claude:** gVisor, a final security review and the cutover from v1 (step 10), before launch. The owner's other ideas are under steps 9 and 13, with a verdict on each.
3. **Claude, at the very end:** a video explaining every feature (step 12).

## Your actions

- **Commit and push** what's uncommitted (the new end-to-end suites). I read the result from GitHub, so just tell me when it's pushed.
- **Point dev mail at Mailpit:** `.env` sends through real Gmail, so tests that invite people send real mail to addresses that don't exist. Set `SMTP_HOST=localhost`, `SMTP_PORT=1025` and empty `SMTP_USER`/`SMTP_PASS` unless you're testing real delivery. `org-rules` already does this for itself; `org-members` and the interview suites don't.
- **Untrack the last Codex files:** `git rm -r --cached .codex apps/web/AGENTS.md`, then commit. They stay on your disk.
- **Before deploying:**
  - rotate every v1 secret (`server/.env`);
  - add the Google OAuth callback (`http://localhost:8080/api/auth/callback/google`);
  - choose hosting (`docs/deploy.md`).
- **Later:** `prom-client` was deprecated in August 2026 in favour of `@prometheus-io/client`, so moving to it is a package change for you to approve. (Installing `prom-client` made pnpm keep two copies of drizzle; `@opentelemetry/api` at the root fixed that, with your OK.)

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
  - OpenAPI and Postman import, and axios snippets (**ChatGPT 14**);
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

- ⬜ Git in the sandbox, later:
  - push and pull to a remote (through the API, since the sandbox can't reach GitHub);
  - merges and conflicts in the panel;
  - repositories in subfolders.

## Step 8 · Teams and admin

- ⬜ Teams, later: a guest role, auto-join by email domain, organisation templates and policies
- ⬜ What signing out doesn't end yet: a video call the device is in (LiveKit knows a person, not a sign-in, so removing them would drop their other devices too), and a dev server's preview, whose own cookie lasts 12 hours and is checked against the room, not the sign-in. Both end when the person loses access to the room. Worth closing in the final security review.
- ⬜ A two-factor code can be used again until it expires (about 30 seconds): Better Auth doesn't remember used ones. Someone would need the password and that code at that moment. Worth closing in the final security review.
- 🟡 Account, later: pages for appearance, notifications and connected accounts (**ChatGPT 16**)
- ⬜ Rooms, later: more than one owner, and handing a room to someone else
- ⬜ Usage dashboard: runs, AI tokens and sandbox minutes, with quotas
- ⬜ Instance admin: users, rooms, health

## Step 9 · Automations and platform

- ⬜ Dependencies:
  - a per-person rate limit;
  - a fade that shows the side tabs scroll.
- ⬜ **Automations with Activepieces** (the owner's decision, 2026-11-07, **Claude**, with Pipelines):
  - **Why not n8n:** its licence only lets it be given to others free of charge for non-commercial purposes, so a paid CodeChatter would need n8n's own licence. Activepieces is MIT outside its `ee` folders. Workflows don't move between the two, so this is chosen once.
  - **n8n as the reference** (the owner's request, 2026-11-07): as complete as n8n, A to Z. Its features and how they behave are the checklist: the canvas, each run's history with the data at every step, retries, error handling, sub-flows, webhooks and schedules, expressions, versions, templates. **What's written here is our own code: nothing is copied from n8n's source or workflows**, as that would bring its licence (free and non-commercial only) with it, and undo the reason for choosing Activepieces.
  - **To check first:** what its free edition includes, how far its builder can be embedded, its image's size and memory, and what it needs to run (database, queue).
  - **How:** its official image unmodified, as a room service with the room's sign-in if it allows that, not a copy of its source here.
  - **It needs the internet** for outside services, and rooms have none (ADR 0007): an owner's switch with limits and a security review come before that. Coding automations that stay inside the room work without it.
  - **Shown as a flowchart, like n8n's** (the owner's request, 2026-11-07): boxes and arrows for each automation, what ran and what failed lit up on it, in the room and in the gallery. Activepieces lays steps out one after another, so this is a view of our own over its flows, and whether it can edit them as well as show them is to be checked. One flowchart component, shared with the Flow and Pipelines. React Flow (`@xyflow/react`, MIT) is the likely tool, which needs asking first as a new package, or the room's own canvas engine.
  - **CodeChatter's own steps, as an Activepieces piece:** when a room event happens (a file changes, a test fails, a push), run code or tests in the sandbox, ask the room's AI through the gateway, post in the room's chat, run a prompt's evals, ask the codebase.
  - **100-200 example automations for coding**, written here, as collections found online don't show terms that allow copying them: reviewing a pull request with the AI, writing release notes from commits, triaging issues, running tests on a push, explaining a failed run, dependency alerts, stale branches and so on. A gallery in the room to pick from. **Each is checked to import; each is run for real only where the service is available to try it on, and the gallery says which.**
- ⬜ **Pipelines, Jenkins-style** (the owner's idea, 2026-11-06): stages and steps in a file in the room, run in its sandbox, with live logs and a run history, started by hand, on a schedule or by a push. Our own rather than embedding Jenkins, which is heavy and hard to make safe for many rooms. Together with the terminals, ports, databases and Kubernetes panel, this is what "DevOps online" means here.
- ⬜ Workflow builder (n8n-style): triggers, actions, conditions, run history
- ⬜ Public API with personal access tokens, and a `cc` CLI that syncs a folder with a room
- ⬜ MCP server: Claude Code, Claude Desktop and Cursor open rooms, edit and run
- ⬜ `devcontainer.json` support

## Step 10 · Hardening and launch

- ⏸️ **Deploying: put off by the owner (2026-11-06).** He'd rather not run other people's code on his own laptop, or look after a server, for now. Nothing's on the internet. When it comes back, a rehearsal found:
  - `infra/compose.yaml` doesn't pass the `AI_*` settings to the API, so AI stays off in production;
  - only sign-in and the AI have rate limits: there's none on the API as a whole;
  - a Cloudflare Tunnel carries no UDP, so calls would need LiveKit Cloud, and Caddy would have to pass on `CF-Connecting-IP`, or everyone shares one sign-in limit;
  - docker: `internal` networks publish no ports, and Caddy's image won't start with every capability dropped;
  - a dev server's preview isn't routed in production (`PREVIEW_ORIGIN`, a wildcard host).
- ⬜ Backups, later: `restore --into-live` drops the live database before restoring it. The file has been checked by then, but restoring beside it and renaming would leave nothing at risk. And a backup that fails isn't tried again until the next day.
- ⬜ OpenTelemetry traces
- ⬜ End-to-end tests in CI: `new-room`, the first browser suite, has needed its retry in both runs we've read (it crashes on its first try, then passes). Worth finding out why.
- ⬜ Metrics, later:
  - `METRICS_TOKEN` and scraping in the Helm chart;
  - move from `prom-client` to `@prometheus-io/client`.
- ⬜ Sandbox security: the gVisor runtime
- ⬜ Cutover from v1: move the data from MongoDB, then delete `client/` and `server/`
- ⬜ A final security review

## Bugs to look at

- ⬜ `apps/web/components/room/tools/api-studio/script-worker-source.ts` is dead code: nothing imports it, and the `script-sandbox.ts` it mentions is gone. Delete it, or build the pre-request scripts it was for. Those would need a frame with their own policy, like `/frames/document`.

## Step 11 · Interview mode: after launch (**Claude**)

Interviews and assessments are done (`docs/interviews.md`). What's left:

- ⬜ **Before real candidates: legal advice** on recording and on AI in hiring where they live (**you**: `docs/interviews.md` says what each does)
- ⬜ The AI on real recordings: tried on real-looking stills only. `gemma4:e4b` on this laptop found about half of what was there (16 of 30, 6 false alarms), so stills are notes that say which moment to watch, and finding nothing there means nothing. Try a stronger or cloud model when there's a reason to rely on them
- ⬜ Negative marking, and sections with a time each
- ⬜ Showing Diagrams and Boards in the replay (files only now)
- ⬜ An email reminder before an assessment closes
- ⬜ Hidden tests on the Kubernetes driver (a one-off pod, as the Docker driver's throwaway container); **Run tests** refuses there until then
- ⬜ A scorecard for each interviewer (one is shared now, and the last save wins)
- ⬜ The report as a PDF (Markdown now)

## Step 12 · Recruiter kit

- ⬜ **The very last piece** (**Claude**; the owner's request, 2026-11-06): a good video explaining every feature and how it all fits together, made once the features are done. Recorded from the real app, driven by a script. `docs/demo-script.md` is a starting point, and the README's GIF can come from the same recording.

## Step 13 · Advanced features

- ⬜ **For researchers** (the owner's idea, 2026-11-06): a layout that opens on notebooks, data, documents and PDFs, which all exist already. LaTeX and citations after that, as they need new tools in the sandbox image.
- ⬜ **The AI gateway on Kubernetes:** run `apps/runner/test/gateway.e2e.mjs` on the Kubernetes driver. It hasn't been yet, as Docker Desktop's cluster doesn't have the sandbox images loaded. The agent channel it uses is the same on both drivers.
- ⬜ **Opengrep in the Analysis tool:** only once its rules' licence is checked. Semgrep's rules don't allow SaaS use, so it may need rules of our own.
- 🟡 **AI engineering tools** (the owner's idea, 2026-11-07, **Claude**; the Prompt Playground, AI gateway, Evals and Ask the codebase are done), in this order:
  - MCP Inspector: list and call the tools of an MCP server running in the sandbox;
  - Traces: each AI call's prompt, tokens and time.
- ⬜ **Explain this data** (**Claude**): a button on query results and notebook output, with the numbers worked out by DuckDB's `SUMMARIZE` and pandas, not by the model.
- ⬜ **A lakehouse, as Databricks does it** (the owner's idea, 2026-11-07, **Claude**), before the researcher layout: Databricks itself is a paid cloud service that can't run in a room, so the open-source tools it's built on go in the full sandbox image: Apache Spark (PySpark) and Delta Lake in notebooks, MLflow for experiments. Spark needs Java and a good deal of memory, so check first that it fits a room's limits. Later, once rooms have secrets, a connection to a real Databricks workspace for people who have one.
- ⬜ **A visual Flow, as Dataiku does it** (the owner's idea, 2026-11-07, **Claude**), with the lakehouse: Dataiku is a paid product too, so a tool of our own over open-source ones: a graph of datasets and the recipes that make them (SQL on DuckDB, Python), run in the sandbox, with what depends on what, data quality checks and a profile of each dataset. Candidates, licences and size to be checked first: dbt with DuckDB for the SQL recipes and their tests, FLAML for AutoML. It shares its running with Pipelines, so they're designed together.
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
- 🟡 A task board, with TODO and FIXME comments as cards (**ChatGPT 15**)
- ⬜ Math (KaTeX) and Mermaid inside the Markdown preview
- ⬜ VS Code extension: join a room from VS Code
- ⬜ More interface languages: Hindi first
