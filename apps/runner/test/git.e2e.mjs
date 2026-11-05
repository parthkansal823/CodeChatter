/**
 * Git in the sandbox through the API, the runner and the sandbox's file sync (dev stack
 * running). In a disposable room (so no `.git` is left in a room tests share):
 *   - who may use it;
 *   - init, stage, commit (by the signed-in person), show, log, branches;
 *   - a branch switch and a discard changing the room's files for everyone;
 *   - and the errors people meet.
 * The room is deleted at the end, its sandbox and repository with it.
 * From apps/runner: node --env-file=../../.env test/git.e2e.mjs
 */
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, setText, textOf } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const APP = process.env.APP_URL ?? "http://localhost:8080";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 170)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function person() {
  const cookies = new Map();
  return async (path, { method = "GET", json } = {}) => {
    const response = await fetch(new URL(path, APP), {
      method,
      signal: AbortSignal.timeout(120_000),
      headers: {
        origin: APP,
        ...(json !== undefined && { "content-type": "application/json" }),
        ...(cookies.size && { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  };
}
async function signIn(email) {
  const call = person();
  const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "codechatter123" } });
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`);
  return call;
}
async function waitFor(check, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await sleep(300);
  }
  return null;
}

const owner = await signIn("test1@codechatter.local");
const outsider = await signIn("test2@codechatter.local");
const me = (await owner("/api/me")).body;
let roomId = null;
let provider = null;
let socket = null;

try {
  const made = await owner("/api/rooms", { method: "POST", json: { name: `Git e2e ${Date.now().toString(36)}` } });
  roomId = made.body?.id;
  record("disposableRoom", made.status === 201 && /^[A-Z0-9]{6}$/.test(roomId ?? ""), made.status);
  const git = (request, who = owner) => who(`/api/rooms/${roomId}/git`, { method: "POST", json: request });

  // The room's files, as a peer, to edit them and to see what git changes.
  const doc = new Y.Doc();
  const name = filesDocName(roomId);
  socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
  provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: name }) });
  provider.attach();
  await new Promise((resolve, reject) => {
    provider.on("synced", resolve);
    setTimeout(() => reject(new Error("collab sync timed out")), 15_000);
  });
  const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

  const denied = await git({ op: "status" }, outsider);
  record("outsiderRefused", denied.status === 403 || denied.status === 404, denied.status);

  const first = await git({ op: "status" });
  record("noRepoAtFirst", first.status === 200 && first.body?.status?.repo === false, JSON.stringify(first.body).slice(0, 120));

  createFileAtPath(doc, "app.py", 'print("v1")\n', null);
  const init = await git({ op: "init" });
  const untracked = init.body?.status?.changes ?? [];
  record("initOnMain", init.status === 200 && init.body.status.repo && init.body.status.branch === "main" && init.body.status.head === null, JSON.stringify(init.body).slice(0, 140));
  const sawApp = (await git({ op: "status", stateVector: stateVector() })).body?.status?.changes?.find((c) => c.path === "app.py");
  record("newFileIsUntracked", sawApp?.unstaged === "?", JSON.stringify(sawApp ?? untracked));

  const staged = await git({ op: "stage", paths: ["app.py"], stateVector: stateVector() });
  record("stageAddsIt", staged.body?.status?.changes?.find((c) => c.path === "app.py")?.staged === "A", JSON.stringify(staged.body).slice(0, 140));

  const commit = await git({ op: "commit", message: "First commit from the panel", stateVector: stateVector() });
  record("commitMade", commit.status === 200 && /^[0-9a-f]{7,}$/.test(commit.body?.commit ?? ""), JSON.stringify(commit.body).slice(0, 140));
  const log = await git({ op: "log" });
  const top = log.body?.commits?.[0];
  record("commitIsBySignedInPerson", top?.subject === "First commit from the panel" && top?.email === me.user.email && top?.author === me.user.name, JSON.stringify(top));

  const shown = await git({ op: "show", path: "app.py" });
  record("showGivesCommittedText", shown.body?.text === 'print("v1")\n' && shown.body?.binary === false, JSON.stringify(shown.body));

  // A branch with a new file, then back to main: the file leaves the room.
  const branch = await git({ op: "checkout", branch: "feature/notes", create: true });
  record("branchMade", branch.body?.status?.branch === "feature/notes", JSON.stringify(branch.body).slice(0, 120));
  createFileAtPath(doc, "notes.txt", "only on the branch\n", null);
  const commitAll = await git({ op: "commit", message: "Add notes", all: true, stateVector: stateVector() });
  record("commitAllTakesNewFiles", commitAll.status === 200 && commitAll.body.status.changes.length === 0, JSON.stringify(commitAll.body).slice(0, 140));
  const branches = await git({ op: "branches" });
  record("branchesListed", branches.body?.branches?.map((b) => b.name).sort().join(",") === "feature/notes,main" && branches.body.current === "feature/notes", JSON.stringify(branches.body));
  const back = await git({ op: "checkout", branch: "main" });
  const gone = await waitFor(() => !findByPath(doc, "notes.txt"));
  record("switchingBranchChangesTheRoom", back.body?.status?.branch === "main" && gone, `notes.txt gone from the room: ${Boolean(gone)}`);

  // A change, discarded: the room's file goes back to the commit.
  setText(textOf(doc, findByPath(doc, "app.py").id), 'print("edited")\n');
  const modified = await git({ op: "status", stateVector: stateVector() });
  record("editShowsAsModified", modified.body?.status?.changes?.find((c) => c.path === "app.py")?.unstaged === "M", JSON.stringify(modified.body).slice(0, 140));
  const discard = await git({ op: "discard", paths: ["app.py"] });
  const restored = await waitFor(() => textOf(doc, findByPath(doc, "app.py")?.id ?? "")?.toString() === 'print("v1")\n');
  record("discardPutsTheRoomBack", discard.status === 200 && restored, JSON.stringify(discard.body).slice(0, 120));

  // The errors people meet.
  const nothing = await git({ op: "commit", message: "Nothing here" });
  record("nothingToCommitSaysSo", nothing.status === 409 && /Nothing to commit/.test(nothing.body?.detail ?? JSON.stringify(nothing.body)), JSON.stringify(nothing.body).slice(0, 140));
  const badName = await git({ op: "checkout", branch: "bad..name", create: true });
  record("badBranchNameRefused", badName.status === 400, badName.status);
  const outside = await git({ op: "stage", paths: ["../etc/passwd"] });
  record("pathOutsideTheRoomRefused", outside.status === 400, outside.status);
  const unknownBranch = await git({ op: "checkout", branch: "does-not-exist" });
  record("unknownBranchExplained", unknownBranch.status === 409, JSON.stringify(unknownBranch.body).slice(0, 140));
} catch (error) {
  record("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  provider?.destroy();
  socket?.destroy();
  if (roomId) {
    const removed = await owner(`/api/rooms/${roomId}`, { method: "DELETE" });
    record("roomDeleted", removed.status === 204, removed.status);
  }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
