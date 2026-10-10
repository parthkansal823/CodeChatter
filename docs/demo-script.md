# Recording the 2-minute demo

A shot list for the video the README and the showcase page link to. Each step shows one thing that works today. Times are a guide; cut the waiting (installs, image pulls) when you edit.

## Before you record

- **The app:**
  - The dev stack is running and seeded (`pnpm infra:up`, `pnpm dev`).
  - Ollama is running, for the AI steps.
  - The full sandbox image is built (`pnpm sandbox:build:full`) and `SANDBOX_IMAGE=codechatter-sandbox:full`, so every language works.
- **Two browser windows side by side:**
  - Edge signed in as `test1@codechatter.local` and an InPrivate window signed in as `test2@codechatter.local` (password `codechatter123`).
  - The dark theme, and the windows 1440 × 900 or larger.
- **Warm up once off camera:**
  - Create a React room and start its dev server, so the packages are cached.
  - Start PostgreSQL in the Team playground.
- **Tools:**
  - Record with OBS, or Xbox Game Bar (Win + Alt + R).
  - Trim in Clipchamp, which comes with Windows 11.

## Shots

| Time | Show | Say |
|---|---|---|
| 0:00 | The landing page, then **Start a room** and the React template | "CodeChatter is a collaborative IDE. Every room gets its own sandbox." |
| 0:10 | Both windows in `src/App.jsx`: each person's cursor and colour, then test2 clicks the faces in the top bar and **Follow** next to test1 | "Edit together, live. Follow anyone to see what they see." |
| 0:25 | The **Dev server** tab: **Allow installs and start**, then **Open preview**. Change the heading in `App.jsx`; the preview updates | "Templates install and start their dev server, with a live preview." |
| 0:45 | A Python file, **Run**; then the terminal: `ls`, `python3 --version` | "Run code in 31 languages, in a sandbox per room." |
| 0:55 | **Databases**: PostgreSQL is running; **Open**, run a `select`; then in the terminal `psql "$DATABASE_URL" -c '\dt'` | "One-click databases. Your code finds them by name." |
| 1:10 | **AI**: "add a /health route"; accept the diff. Then type in a file and press Tab on a ghost-text suggestion | "AI that edits as diffs you review, and completes as you type." |
| 1:30 | **Design**: draw a frame, a few shapes and a heading; then **Export** | "Docs, a whiteboard and a design canvas, in the same room." |
| 1:40 | In the terminal, `curl https://example.com` fails. In **Ports**, **Allow for an hour**; `pip install requests` works | "Rooms have no internet. Installs open only when the owner allows them." |
| 1:50 | A terminal on your machine: `kubectl get namespaces` showing `cc-demo-…` rooms; then the GitHub page | "It also runs on Kubernetes, a namespace per room. The code is on GitHub." |

## Afterwards

- Upload it unlisted to YouTube, or to Loom.
- Set `NEXT_PUBLIC_DEMO_VIDEO_URL` for the showcase page (`docs/deploy.md`).
- Put the link near the top of the README.
- Make a GIF of shots 0:10–0:25 (presence and the preview) for the README's first screen. ezgif.com or `ffmpeg -i clip.mp4 -vf "fps=12,scale=960:-1" demo.gif` will do.
