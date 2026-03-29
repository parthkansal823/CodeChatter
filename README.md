# CodeChatter

CodeChatter is a collaborative coding workspace with shared rooms, live presence, Monaco-based editing, in-room terminal access, runnable starter projects, and optional Gemini-backed AI assistance.

## What It Includes

- Real-time room collaboration with presence, typing state, and cursor sharing
- Workspace-based coding with Monaco editor, file tree, tabs, and run output
- Private room invite links, one-time owner approval queues, and owner-only room settings
- JWT auth plus Google and GitHub OAuth support
- Starter templates for blank rooms, Python, web prototyping, and DSA practice
- DSA starter language support for Python, JavaScript, TypeScript, C, C++, Java, Go, Rust, PHP, Ruby, Shell, Lua, Perl, Swift, and Kotlin

## Tech Stack

- Frontend: React, Vite, Tailwind CSS, Framer Motion, Monaco Editor, XTerm
- Backend: FastAPI, WebSockets, Authlib, HTTPX
- Database: MongoDB

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
  core/
  routes/
  services/
  database.py
  main.py
```

## Local Setup

### 1. Frontend

```powershell
cd client
npm install
Copy-Item .env.example .env.local
npm run dev
```

### 2. Backend

```powershell
cd server
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env.local
.\venv\Scripts\python -m uvicorn main:app --reload
```

The backend loads `server/.env.local` first, then `server/.env` if present.
Vite will load `client/.env.local` automatically.

## Docker Deploy

```powershell
Copy-Item server/.env.example server/.env.local
docker compose up --build
```

This starts:

- `app` on `http://localhost:8000`
- `mongo` on `mongodb://localhost:27017`

## Environment Variables

### Frontend

Use [client/.env.example](/D:/Project_With_Niyati/New%20folder/CodeChatterNK/client/.env.example) as the template.

Common values:

```env
VITE_API_URL=https://your-api.example
VITE_GOOGLE_CLIENT_ID=
```

### Backend

Use [server/.env.example](/D:/Project_With_Niyati/New%20folder/CodeChatterNK/server/.env.example) as the template.

Important values:

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

## Production Notes

- Set `FRONTEND_URL` and `ALLOWED_ORIGINS` correctly before deployment.
- Keep all real credentials in `.env.local` or your hosting platform secret manager.
- `CODECHATTER_DATA_DIR` can move runtime workspace snapshots outside the repo when you deploy.
- `server/data/` is now treated as managed runtime storage, with docs in [server/data/README.md](/D:/Project_With_Niyati/New%20folder/CodeChatterNK/server/data/README.md).
- The backend is now split into `core`, `services`, and `routes` folders so auth, runtime, and websocket logic are easier to trace.
- The room UI is split into feature-level hooks/components under `client/src/hooks/code-room/` and `client/src/components/code-room/`.

## GitHub Readiness Checklist

- Local env files should stay untracked
- Secrets should only live in `.env.local`
- Build output and virtual environments should stay ignored
- Add a `LICENSE` file before publishing publicly if you want others to reuse the code

## Verification

The current app has been verified with:

- `npm.cmd run build` in `client`
- Targeted ESLint on the changed frontend files
- Python compile checks for `server/main.py` and `server/database.py`
