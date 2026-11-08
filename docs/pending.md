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

1. **ChatGPT**, one prompt at a time, each checked before the next: **17** (more than one owner in a room, and handing a room over).
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

- ⬜ **TURN over TLS on a real server:** it's been rehearsed locally, but not with a public certificate from a network that only allows HTTPS. Try that when deploying, with the check in `docs/deploy.md`.
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
- 🟡 Rooms, later: more than one owner, and handing a room to someone else (**ChatGPT 17**)
- ⬜ Usage dashboard: runs, AI tokens and sandbox minutes, with quotas
- ⬜ Instance admin: users, rooms, health

## Step 9 · Automations and platform

- ⬜ Dependencies:
  - a per-person rate limit;
  - a fade that shows the side tabs scroll.
- 🟡 **Automations on Activepieces' real engine** (the owner's decision, 2026-11-07, with Pipelines; **Claude**). Part one is done (roadmap-details, "Automations, part one"): the engine and 44 pieces in the sandbox, flows as files, the tool and its chart, 179 examples. What's left is below, from step 4, and the n8n list after it.
  - **What was tried, and why it's built this way:**
    - **n8n:** its licence only lets it be given to others free of charge for non-commercial purposes. Its features are the checklist; nothing of it is copied.
    - **Activepieces' builder embedded:** enterprise only, "From $36k a year". The owner doesn't want anything paid.
    - **Its free edition as one service:** works, at 1.4 GB, but it refuses a second team project (402, "Maximum limit of 1 team project(s)"), so every room would share one project, and a flow in one room could reach another's credentials. Not acceptable.
    - **Its engine and pieces, in each room's sandbox:** tried for real on 2026-11-07 and it works. `dist/packages/engine/main.js` from image `activepieces/activepieces:0.92.3-hotfix.2` (MIT, 633 KB), driven by a small host of ours, ran a webhook payload, code steps, a router, a loop and the real HTTP piece, with a failing step continuing, in 1.3 seconds and 176 MB, inside the jail with no network, with no Activepieces server.
  - **How the host works** (the spike is the reference): a socket.io server on `/worker/ws`, checking `auth.connectionToken`; it forks the engine with `AP_SANDBOX_WS_PORT`, `AP_SANDBOX_WS_TOKEN`, `SANDBOX_ID`, `AP_EXECUTION_MODE=UNSANDBOXED` (the room's jail is the sandbox), `AP_BASE_CODE_DIRECTORY`, `AP_CUSTOM_PIECES_PATHS`; it emits `rpc` with `{method: "executeOperation", payload: {operationType: "EXECUTE_FLOW", operation}}`, and serves on loopback `PUT /v1/files/:id` (zstd; replies with `x-ap-file-read-url`), `POST /v1/engine/run-logs`, `POST /v1/engine/run-progress`, `/v1/store-entries`, `/v1/worker/app-connections/:name`. The run's step data comes back through the file. Pieces go in `pieces/<name>-<version>/node_modules/<name>`. Code steps are `codes/<flowVersionId>/<step>/index.js`, a module exporting `code`. Expressions read `{{step_1.output.x}}` and `{{trigger.output.body.x}}` in schema version 27.
  - **To build, in order:**
    1. ✅ The engine, a host, and pieces for coding (GitHub, GitLab, Slack, Discord, HTTP and so on), pinned from a lockfile, in the sandbox images.
    2. ✅ Flows as files in the room, in Activepieces' own format, so they're edited together, versioned, and can leave.
    3. ✅ The Automations tool: n8n-like flowchart (`components/flowchart`), steps edited from each piece's own description of its fields, a test run, and each run's history with the data at every step lit up on the chart.
    4. Triggers: by hand, a webhook URL, a schedule, room events (a push, a failed test), and pieces' polling triggers. Retries and error handling come from the engine.
    5. Secrets for a room, encrypted in the database, given to a run in memory only. A room's connections never leave its own sandbox.
    6. The internet: rooms have none (ADR 0007), so an owner's switch and an allowlist per service, through the room's egress proxy, with limits and a security review first. Automations that stay inside the room work without it.
    7. CodeChatter's own piece: run a command or tests in the sandbox, ask the room's AI through the gateway, post to the room's chat.
    8. ✅ **100-200 example automations for coding**, written here, as collections found online don't show terms that allow copying them: reviewing a pull request with the AI, release notes from commits, triaging issues, running tests on a push, explaining a failed run, dependency alerts, stale branches and so on. A gallery in the tool. **Each is checked to load in the engine; each is run for real only where the service is available to try it on, and the gallery says which.**
  - **Every n8n feature, or better** (the owner's request, 2026-11-07: "n8n ke saare features", our own UI). This list comes from n8n's own source, read for what it does. Its code isn't copied: its licence allows only internal, personal or non-commercial use, its `.ee` files need a paid licence, and either limit would land on CodeChatter. Only its permissively licensed packages may be used directly: `@n8n/tournament` (expressions, Apache-2.0), `@n8n/codemirror-lang`, `-html`, `-sql` (MIT), `@n8n/json-schema-to-zod` (ISC), `@n8n/rules-engine` (MIT). In order:
    1. **The editor.** A + on every arrow; right-click menu and shortcuts (select all, arrows to move between steps, copy, cut, paste, duplicate, delete, rename with F2, N to add, Ctrl+Enter to run, undo and redo); turn a step off; replace a step; sticky notes and groups; search for steps; command bar. Input and output as Table, JSON and Schema; click a field to use it, and expressions that autocomplete and preview real values. And/or conditions and many branches on a router.
    2. **Trying things.** Run one step (the engine's `stepNameToTest`), run from a step, pin a step's output, retry a failed run from where it failed, copy an old run's data in to debug it.
    3. **Built-in steps,** as our own piece (`AP_CUSTOM_PIECES_PATHS`): Edit Fields, Filter, Sort, Limit, Aggregate, Summarize, Remove Duplicates, Split Out, Rename Keys, Merge (append, by key, by position, cross join), Compare Datasets, Stop and Error, Execute Command, Read and Write Files, Convert to File, Extract from File, Compression, iCal, Edit Image, Execution Data, Data Tables. Crypto, Date, HTML, Markdown, XML, HTTP and RSS come from Activepieces' pieces.
    4. **Starting by itself.** Turning a flow on and off; webhooks (test and live URLs, methods, authentication, the response modes, Respond to Webhook); schedules; pieces' polling triggers; room events, including a file changing; an error flow that runs when another fails; sub-flows, called and calling, with who may call them; Wait (a time, a date, a webhook, a form); approvals; forms and a chat trigger with public pages.
    5. **Connections.** Room secrets, encrypted, with each piece's kinds of sign-in, tested on save; OAuth2; allowed domains per secret; variables; the internet switch and allowlist.
    6. **Runs and settings.** Every flow's runs in one list, filters, notes and tags on a run, custom data, redaction, how long runs are kept; each flow's timezone, timeout, what to save, error flow and time saved; tags and favourites; a visual diff between versions, restoring one; the Insights page (runs, failures, failure rate, time saved, average time).
    7. **AI.** An agent step with a model, memory, tools and an output parser; chains (Basic LLM, Q&A, Summarize, Information Extractor, Sentiment, Text Classifier, AI Transform); tools (calculator, code, HTTP, a flow as a tool, a vector store, MCP client, think); memory (window, Postgres, Redis); vector stores, embeddings, document loaders, splitters and retrievers; a flow as an MCP server; guardrails; evaluations with test cases. All able to use the room's AI through the gateway, with no key.
    8. **More.** Import n8n's workflow JSON (its format, converting what we have a step for, and saying what we don't); the rest of Activepieces' MIT pieces for services (n8n has 363 service nodes, we have 44, so measure the image first); a room's own pieces; the public API and a CLI for flows.
    - **Better than n8n:** several people editing one flow live (n8n allows one editor); flows as files, so they get git, review and History; each room's runs sealed in its own sandbox; AI steps that need no key; an AI that writes a flow from a sentence, checked against the real pieces; a flow's own tests.
    - **Already here in other forms, so not rebuilt:** projects and sharing (rooms and roles), SSO, two-factor, users, source control (the room's git), traces. **Not needed:** n8n's queue mode and workers, as each room has its own.
- ⬜ **Pipelines, Jenkins-style** (the owner's idea, 2026-11-06): stages and steps in a file in the room, run in its sandbox, with live logs and a run history, started by hand, on a schedule or by a push. Our own rather than embedding Jenkins, which is heavy and hard to make safe for many rooms. Together with the terminals, ports, databases and Kubernetes panel, this is what "DevOps online" means here. The Flow tool's way of running things is there to build on: a build that carries on after the request, with its progress and history in files that any viewer's tool reads (`sandbox/image/flow.py`), and its chart.
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

- ⬜ **More for researchers:** clicking in the PDF to go to that line of the paper (SyncTeX, which needs a PDF viewer of our own rather than the browser's), other LaTeX engines for Hindi and other scripts (XeLaTeX, chosen with `% !TEX program`), and citation styles to pick from. The layout, LaTeX and references themselves are done.
- ⬜ **The AI gateway on Kubernetes:** run `apps/runner/test/gateway.e2e.mjs` on the Kubernetes driver. It hasn't been yet, as Docker Desktop's cluster doesn't have the sandbox images loaded. The agent channel it uses is the same on both drivers.
- ⬜ **Opengrep in the Analysis tool:** only once its rules' licence is checked. Semgrep's rules don't allow SaaS use, so it may need rules of our own.
- ⬜ **A connection to a real Databricks workspace,** for people who have one, once rooms have secrets. The lakehouse itself is done, with the same open-source tools.
- ⬜ **Using a trained model on new rows** (a scoring recipe, as Dataiku has): an AutoML recipe predicts for the dataset it learned from, and doesn't keep the model. The Flow and AutoML themselves are done.
- ⬜ **dbt v2, when it can:** dbt's new engine says it's the default for new installs. The Flow stays on dbt Core 1.12 (Apache-2.0), as no DuckDB adapter for v2 could be confirmed, and Python recipes need dbt-duckdb. To look at again once v2 has one.
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
- ⬜ Task board, next: rescan only the files that changed (now every keystroke anywhere, and every move, rescans every file, in 5 ms slices); two identical TODOs in one file show as one card; a hand-written card's delete has no undo
- ⬜ Math (KaTeX) and Mermaid inside the Markdown preview
- ⬜ VS Code extension: join a room from VS Code
- ⬜ More interface languages: Hindi first
