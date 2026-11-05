# ADR 0009: Binary room files live in the object store, by content, under their room

- **Status:** Accepted (2026-11-05).
- **Code:**
  - shared: `packages/auth/src/s3.ts` (the object store client), `packages/contracts/src/blobs.ts`, `packages/workspace-model/src/model.ts` (`BlobRef`, `createBinaryFile`, `setBlob`, `setFileText`)
  - api: `apps/api/src/blobs/`
  - runner: `apps/runner/src/doc-sync.ts`, `sandbox/agent/src/workspace.ts`
  - web: `apps/web/lib/blobs.ts`, `components/room/editor/binary-view.tsx`, `components/room/files-transfer.ts`, `components/room/source-control/room-files.ts`
- **Tests:**
  - unit: `packages/auth/src/s3.test.ts`, `packages/workspace-model/src/blobs.test.ts`, `packages/contracts/src/blobs.test.ts`, `apps/api/src/blobs/blob-headers.test.ts`, `apps/web/components/room/source-control/room-files.test.ts`, `files-transfer.test.ts`
  - end to end: `apps/api/test/blobs.e2e.mjs`, `apps/runner/test/blobs.e2e.mjs`, `apps/web/test/binary-files.e2e.mjs`

## Context

A room's files are one Yjs document (ADR 0005), which is right for text that people edit together and wrong for an image, a PDF or a font: bytes don't merge, and megabytes in the document would be sent to every peer and kept in every checkpoint.

## Decision

**The file tree holds a reference, the store holds the bytes.**
- **A binary file** is an ordinary `kind: "file"` node with a `blob`: its SHA-256, size and media type. It has no Y.Text. Rename, move, delete and sibling naming work as for any file, and most code that reads text already treated a missing text as empty or absent.
- **New bytes** replace the whole `blob` value, last writer wins, as a file system would.
- **Where the bytes live:** the S3-compatible store (SeaweedFS in development), at `rooms/<room>/<sha256>`.

**No table of who may read what.** The key names the room, so reading a blob needs only `room.view` on that room, and uploading needs `files.edit`. A blob can't be read through another room, because it isn't under that room's prefix. A fork copies the objects server-side (`POST /rooms/:id/blobs/copy`, which needs view on the source and edit on the target) before writing the file tree. Content addressing means the same bytes are stored once per room, and every response can be cached for good.

**Served by the API, never the bucket.** The bucket stays private and needs no CORS. Responses from `GET /rooms/:id/blobs/:sha256` can never run as a page:
- Only types the editor shows keep their media type; anything else is `application/octet-stream`.
- `nosniff` stops the browser guessing a type.
- A CSP `sandbox` covers an SVG opened straight from the URL.
- Non-images download when visited directly, and the editor fetches PDFs and fonts itself.

**One small client, not the AWS SDK.** Signature V4 with `node:crypto` (`@codechatter/auth/s3`) for six operations on one bucket, checked against AWS's published examples and against SeaweedFS, which enforces signatures. It's shared by the API and the runner, which already shared `@codechatter/auth` for service tokens.

**Through the sandbox:**
- **Room to sandbox:** the runner fetches the bytes and sends them to the agent as a base64 `write`.
- **Sandbox to room:** a binary a program makes, up to 5 MB, comes back as a `blob` event. The runner stores it and points the file tree at it.
- **No echoes:** the agent hashes binary files by their bytes, so its own writes don't come back.
- **Kind changes:** text written over a binary turns the file back into text, and the other way round.
- **Bigger binaries** stay in the sandbox, as text over 256 KB already did.

**History and fork keep their string maps.** A binary file appears there as a marker: a NUL byte, a prefix, then the blob's JSON. No room text holds a NUL, so the marker can't be a real file. Comparisons, restores and fork's `replaceFiles` then work for both kinds unchanged. GitHub's `roomTexts` leaves binary files out, so a marker is never committed.

## Consequences

- **Without an object store** (`S3_*` unset), binary files are simply off. Uploads skip them with a message, and the sandbox keeps what programs make.
- **Objects are never deleted yet**, which is also why History can restore an old image. Deleting a room's prefix with the room, and collecting objects no checkpoint or file refers to, are left for later.
- **The API buffers** a download (up to 20 MB) in memory to serve ranges. A streaming `get` would remove that if it matters.
- **GitHub sync ignores binary files** in both directions for now.
