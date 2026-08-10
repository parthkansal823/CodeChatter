# CodeChatter

CodeChatter is a collaborative coding workspace with shared rooms, live presence, Monaco-based editing, in-room terminal access, runnable starter projects, and optional Gemini-backed AI assistance.

## What It Includes

- Real-time room collaboration with presence, typing state, and cursor sharing
- Workspace-based coding with Monaco editor, file tree, tabs, and run output
- Private room invite links, one-time owner approval queues, and owner-only room settings
- Room chat with file attachments, plus whiteboard, flowchart, notes, and Pomodoro panels
- In-room video calls and screen sharing over WebRTC
- GitHub import, push, and two-way folder sync
- JWT auth with email one-time codes, plus Google and GitHub OAuth
- Starter templates for blank rooms, Python, web prototyping, Node/Express, and DSA practice
- DSA starter language support for Python, JavaScript, TypeScript, C, C++, Java, Go, Rust, PHP, Ruby, Shell, Lua, Perl, Swift, and Kotlin

## Tech Stack

- Frontend: React 19, Vite 7, Tailwind CSS, Framer Motion, Monaco Editor, XTerm
- Backend: FastAPI, WebSockets, Authlib, HTTPX
- Database: MongoDB (mongomock for tests)

## Repository Structure

```text
client/
  src/
    components/
      code-room/
    hooks/
      code-room/
      ui/
    utils/
      room/
server/
  core/        # settings, security primitives, schemas, middleware
  routes/      # HTTP + WebSocket endpoints
  services/    # AI, email, OAuth, collaboration, code runner
  tests/       # pytest suite
  database.py
  main.py
```

## Local Setup

### 1. Backend

```powershell
cd server
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env.local
.\venv\Scripts\python -m uvicorn main:app --reload
```

The backend loads `server/.env.local` first, then `server/.env` if present.

### 2. Frontend

```powershell
cd client
npm install
Copy-Item .env.example .env.local
npm run dev
```

Vite loads `client/.env.local` automatically.

### 3. Database

The backend expects MongoDB on `mongodb://localhost:27017`. To run without
installing MongoDB, set `MONGODB_URI=mongomock://localhost` for an in-memory
database (data is lost on restart).

## Tests and Checks

```powershell
# Backend suite (no MongoDB or SMTP required)
cd server
.\venv\Scripts\python -m pip install -r requirements-dev.txt
.\venv\Scripts\python -m pytest

# Frontend lint and production build
cd client
npm run lint
npm run build
```

## Docker Deploy

```powershell
Copy-Item server/.env.example server/.env.local
docker compose up --build
```

This starts:

- `app` on `http://localhost:8000`
- `mongo` on `mongodb://localhost:27017`

The runtime image installs Node, Java, Go, PHP, Ruby, and a C/C++ toolchain so
the in-room runner supports more than Python. It runs as an unprivileged user
and stores runtime data in the `app-data` volume.

## Environment Variables

### Frontend

Use [client/.env.example](client/.env.example) as the template. Only
`VITE_`-prefixed values reach the browser, and all of them are public once
built — never put secrets there.

```env
VITE_API_URL=https://your-api.example
```

### Backend

Use [server/.env.example](server/.env.example) as the template.

```env
SECRET_KEY=replace-with-a-long-random-secret
SESSION_SECRET_KEY=replace-with-a-second-long-random-secret
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=codechatter
CODECHATTER_DATA_DIR=/absolute/path/for/runtime-data
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GEMINI_API_KEY=
```

Generate the two secrets with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## Production Notes

- Set `FRONTEND_URL` and `ALLOWED_ORIGINS` correctly before deployment. OAuth
  callback URLs are only built for hosts in that allow-list.
- With `ENVIRONMENT=production` the server refuses to start unless `SECRET_KEY`
  and `SESSION_SECRET_KEY` are set. That is deliberate: a generated key changes
  on every restart and differs per worker, silently invalidating all sessions.
- Without SMTP configured, sign-in codes cannot be delivered. In development
  they are written to the log; in production that fallback is disabled, because
  a one-time code in a log file is a full MFA bypass.
- `CODECHATTER_DATA_DIR` holds workspace snapshots and chat uploads. Point it at
  a persistent volume.
- Keep real credentials in `.env.local` or your platform's secret manager.

## Security Notes

- Chat attachments are restricted to an extension allow-list that excludes
  browser-renderable markup (`.html`, `.svg`), because uploads are served from
  the API origin and would otherwise be stored XSS.
- The `E2EE` badge on room chat is **not** end-to-end encryption. The key is
  derived from the room ID plus a constant compiled into the client bundle, so
  it obscures message text at rest but gives no confidentiality against the
  server or anyone holding a room link. See the note at the top of
  [client/src/utils/crypto.js](client/src/utils/crypto.js).
- The in-room runner executes user-submitted code in a temporary directory with
  a wall-clock timeout, but **without a sandbox**. Do not expose a public
  instance without isolating the runtime (container-per-run, seccomp, or a
  dedicated execution service).

## Before Publishing

- Local env files stay untracked; secrets only in `.env.local`
- Build output and virtual environments stay ignored
- Add a `LICENSE` file if you want others to reuse the code
