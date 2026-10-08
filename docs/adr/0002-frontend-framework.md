# ADR 0002: Frontend framework is Vite 8 + TanStack Router

- **Status:** Superseded by [ADR 0004](0004-typescript-stack.md) (2026-09-24). The user chose Next.js 16.

## Context

The app is an IDE-style single-page app (Monaco, Yjs, xterm, WebRTC/LiveKit, Excalidraw). Every one of those runs only in the browser. The backend is FastAPI (Python), which already serves the built client.

v1 uses react-router-dom 7. It has untyped params, and each route builds its own `Layout`, so page transitions never run. The package is also a major version behind (React Router is at 8.4).

## Options considered

| Option | Verdict |
|---|---|
| **Vite 8.3 + TanStack Router 1.170** | **Chosen.** Routes and search params are typed end to end, which matters for dashboard, admin and audit filters kept in the URL. Route loaders call `queryClient.ensureQueryData`, so data prefetches before render without a second cache. File-based routes give automatic code splitting, which matters because Monaco alone is over 500 kB. The result is still a static SPA with no extra server. |
| Vite + React Router 8 (framework mode) | Solid, and the smallest migration. It gives weaker typing of search params and has no built-in pairing with Query. Prerendering the landing page, its main extra, is not worth the difference. |
| Next.js 16 | Rejected. SSR needs a Node tier in front of FastAPI: another service to deploy, scale and secure. Every heavy dependency would need `"use client"` / `ssr:false`, so SSR would render almost nothing useful. |

## Decision

- **Router:** `@tanstack/react-router` with `@tanstack/router-plugin/vite` (file-based, `autoCodeSplitting: true`). Routes live in `client/src/routes/`, and the generated `routeTree.gen.ts` is committed.
- **Route structure:**
  - `__root.tsx`: providers, toaster, error and not-found boundaries.
  - `_auth/*`: signed-out layout.
  - `_app/*`: authenticated layout that stays mounted, so the shell no longer remounts between pages.
  - `_app/rooms/$roomId`: the IDE, lazy-loaded.
- **Auth guard:** `beforeLoad` redirects to `/auth?returnTo=…`. This fixes v1 losing invite links on sign-in.
- **Server data:** TanStack Query v5, with route loaders prefetching via `ensureQueryData`.
