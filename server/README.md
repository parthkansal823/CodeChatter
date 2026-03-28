# CodeChatter Server

FastAPI backend for CodeChatter. It handles authentication, room management, collaboration websockets, code execution, and Gemini-backed AI requests.

## Prerequisites

- Python 3.11 or newer
- MongoDB

## Setup

```powershell
cd server
python -m venv venv
.\venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env.local
```

The server reads `server/.env.local` first, then `server/.env` if you intentionally keep a fallback file.

## Important Environment Variables

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=codechatter
SECRET_KEY=replace-with-a-long-random-secret
SESSION_SECRET_KEY=replace-with-a-second-long-random-secret
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
```

Optional integrations:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

For local mock validation only:

```env
MONGODB_URI=mongomock://localhost
MONGODB_DB_NAME=codechatter_test
```

## Run

```powershell
cd server
.\venv\Scripts\python -m uvicorn main:app --reload
```

## First Startup Behavior

On first startup, the server will:

1. Create MongoDB indexes for users and rooms.
2. Import legacy data from `server/data/storage.json` if the Mongo database is empty.
3. Seed featured public rooms if no rooms exist yet.

## Notes

- Keep real credentials in `server/.env.local` or your deployment secret manager.
- Do not commit `server/.env.local`, `server/data/`, or virtual environment folders.
