# CodeChatter Client

React + Vite frontend for CodeChatter. It includes authentication flows, live collaboration UI, Monaco-based editing, workspace management, and the in-room AI helper.

## Prerequisites

- Node.js 20 or newer
- npm

## Setup

```powershell
cd client
npm install
Copy-Item .env.example .env.local
```

## Important Environment Variables

```env
VITE_API_URL=http://localhost:8000
VITE_GOOGLE_CLIENT_ID=
```

## Run

```powershell
cd client
npm run dev
```

## Production Build

```powershell
cd client
npm run build
npm run preview
```

## Frontend Layout

```text
src/
  components/
    code-room/
  hooks/
    code-room/
    ui/
  utils/
    room/
```

## Notes

- Keep local secrets and OAuth client IDs in `client/.env.local`.
- Build output goes to `client/dist/` and should not be committed.
- Room page logic is split into feature hooks so `pages/CodeRoom.jsx` stays readable.
