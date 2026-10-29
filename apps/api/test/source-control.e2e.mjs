// Source Control against a mock GitHub (test/mock-github.mjs, real git objects in memory): a room made from the
// repository, its base files, commits pushed through the Git Data API (modes kept, deletions, a new branch), and
// what's refused: no token, a token that can't push, a stale view, a branch that moved on GitHub, a branch name
// that's taken, keys found by the secret scan (unless the sender goes ahead). Then pull (and up to date), branches and switching back. Starts its own API on :4011 pointed at
// the mock, from the dev watcher's build (dist), so the shared stack is untouched. Signs in as test2; the room
// and test2's GitHub token are removed at the end.
//   node test/source-control.e2e.mjs        (from apps/api, with the dev stack running)
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { mockGithub } from "./mock-github.mjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const API = "http://127.0.0.1:4011";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};

const github = mockGithub({
  files: { "README.md": "# Demo\n", "run.sh": "#!/bin/sh\necho hi\n", "old.txt": "remove me\n", "src/app.py": "print('one')\n" },
  modes: { "run.sh": "100755" },
});
const mockUrl = `http://127.0.0.1:${await github.listen()}`;
const api = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  env: { ...process.env, API_PORT: "4011", GITHUB_API_URL: mockUrl, LOG_LEVEL: "warn" },
  stdio: ["ignore", "ignore", "pipe"],
});
let apiErrors = "";
api.stderr.on("data", (chunk) => (apiErrors += chunk));

const jar = new Map();
async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined && { "content-type": "application/json" }),
      ...(jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, value] = pair.split("=");
    if (value) jar.set(name, value);
  }
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text, headers: response.headers };
}

let roomId = null;
let publishedRoom = null;
try {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${API}/api/healthz`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  const signIn = await call("/api/auth/sign-in/email", { method: "POST", body: { email: "test2@codechatter.local", password: "codechatter123" } });
  check("signIn", signIn.status === 200, signIn.status);
  await call("/api/me/github", { method: "DELETE" });

  const created = await call("/api/rooms", { method: "POST", body: { name: "Source control e2e", repo: { owner: "cc-test", name: "demo" } } });
  roomId = created.json?.id ?? null;
  const first = github.refs.get("main");
  check("imported", created.status === 201 && created.json?.imported?.files === 4 && created.json.imported.commit === first, created.text);
  const repo = `/api/rooms/${roomId}/repo`;

  const info = await call(repo);
  check("info", info.json?.branch === "main" && info.json.commit === first && info.json.login === null, info.text);
  const base = await call(`${repo}/files`);
  const baseFiles = Object.fromEntries((base.json ?? []).map((f) => [f.path, f.content]));
  check("baseFiles", base.headers.get("x-repo-commit") === first && baseFiles["src/app.py"] === "print('one')\n" && Object.keys(baseFiles).length === 4, base.text.slice(0, 120));

  const changes = [
    { path: "README.md", content: "# Demo\n\nEdited in the room.\n" },
    { path: "run.sh", content: "#!/bin/sh\necho hello\n" },
    { path: "src/new.py", content: "print('new')\n" },
    { path: "old.txt", content: null },
  ];
  const noToken = await call(`${repo}/commit`, { method: "POST", body: { since: first, message: "Edit", changes } });
  check("commitNeedsToken", noToken.status === 400 && /Add a GitHub token in Settings to commit/.test(noToken.json?.detail), noToken.text);

  const reader = await call("/api/me/github", { method: "PUT", body: { token: `ghp_mockreader${"r".repeat(26)}` } });
  check("readerTokenSaved", reader.json?.login === "cc-reader", reader.text);
  const cantPush = await call(`${repo}/commit`, { method: "POST", body: { since: first, message: "Edit", changes } });
  check("readOnlyTokenRefused", cantPush.status === 403 && /can't write to cc-test\/demo/.test(cantPush.json?.detail), cantPush.text);

  const writer = await call("/api/me/github", { method: "PUT", body: { token: `ghp_mockwriter${"w".repeat(26)}` } });
  check("writerTokenSaved", writer.json?.login === "cc-writer" && (await call(repo)).json?.login === "cc-writer", writer.text);

  // The secret scan: a commit with a key in it is refused with where it is, and nothing reaches GitHub.
  const awsKey = ["AKIA", "Z7QK2M4XW9PLR3TB"].join("");
  const leaky = await call(`${repo}/commit`, {
    method: "POST",
    body: { since: first, message: "Oops", changes: [...changes, { path: "src/keys.py", content: `REGION = "eu"\nKEY = "${awsKey}"\n` }] },
  });
  const finding = leaky.json?.secrets?.[0];
  check(
    "secretRefused",
    leaky.status === 422 && /has a key or password in it/.test(leaky.json?.detail) && finding?.path === "src/keys.py" && finding.line === 2 && finding.kind === "AWS access key ID" && finding.preview === "AKIA…R3TB" && !leaky.text.includes(awsKey) && github.refs.get("main") === first,
    leaky.text,
  );

  // A commit: on main, after the base; files changed, added and deleted; run.sh stays executable.
  const committed = await call(`${repo}/commit`, { method: "POST", body: { since: first, message: "Edit in the room", changes } });
  const second = committed.json?.commit;
  const onGithub = github.filesAt("main");
  check(
    "committed",
    committed.status === 200 && github.refs.get("main") === second && github.commits.get(second)?.parents[0] === first && github.commits.get(second)?.message === "Edit in the room",
    committed.text,
  );
  check("treeOnGithub", onGithub["README.md"] === changes[0].content && onGithub["src/new.py"] === "print('new')\n" && !("old.txt" in onGithub) && onGithub["src/app.py"] === "print('one')\n", JSON.stringify(onGithub));
  check("modeKept", github.modeOf("main", "run.sh") === "100755", github.modeOf("main", "run.sh"));
  const after = await call(`${repo}/files`);
  const afterFiles = Object.fromEntries(after.json.map((f) => [f.path, f.content]));
  check("baseMovedOn", after.headers.get("x-repo-commit") === second && afterFiles["src/new.py"] === "print('new')\n" && !("old.txt" in afterFiles), Object.keys(afterFiles).join(","));

  const stale = await call(`${repo}/commit`, { method: "POST", body: { since: first, message: "Again", changes: [{ path: "README.md", content: "x\n" }] } });
  check("staleViewRefused", stale.status === 409 && /synced with GitHub a moment ago/.test(stale.json?.detail), stale.text);

  // Someone pushes on GitHub: the room's commit would overwrite it, so it's refused until a pull.
  const third = github.pushDirect("main", [{ path: "src/app.py", content: "print('two')\n" }]);
  const behind = await call(`${repo}/commit`, { method: "POST", body: { since: second, message: "Behind", changes: [{ path: "README.md", content: "y\n" }] } });
  check("behindRefused", behind.status === 409 && /main has commits on GitHub that the room doesn't/.test(behind.json?.detail) && github.refs.get("main") === third, behind.text);

  const pulled = await call(`${repo}/pull`, { method: "POST", body: { since: second } });
  const pulledFiles = Object.fromEntries((pulled.json?.files ?? []).map((f) => [f.path, f.content]));
  check("pulled", pulled.json?.upToDate === false && pulled.json.commit === third && pulledFiles["src/app.py"] === "print('two')\n" && (await call(repo)).json?.commit === third, pulled.text.slice(0, 200));
  const again = await call(`${repo}/pull`, { method: "POST", body: { since: third } });
  check("upToDate", again.json?.upToDate === true && again.json.commit === third, again.text);

  // A new branch from the room, which the room then follows; a name that's taken is refused.
  const branched = await call(`${repo}/commit`, { method: "POST", body: { since: third, message: "On a branch", newBranch: "feature/x", changes: [{ path: "README.md", content: "# Branch\n" }] } });
  check("newBranch", branched.json?.branch === "feature/x" && github.refs.get("feature/x") === branched.json.commit && github.refs.get("main") === third && (await call(repo)).json?.branch === "feature/x", branched.text);
  const taken = await call(`${repo}/commit`, { method: "POST", body: { since: branched.json?.commit, message: "Taken", newBranch: "main", changes: [{ path: "README.md", content: "z\n" }] } });
  check("branchNameTaken", taken.status === 409 && /A branch called main is already on GitHub/.test(taken.json?.detail), taken.text);

  // A pull request from the room's branch, then review comments on its diff.
  check("defaultBranch", (await call(repo)).json?.defaultBranch === "main");
  const opened = await call(`${repo}/pulls`, { method: "POST", body: { title: "From the room", body: "Made in CodeChatter" } });
  check("pullOpened", opened.status === 201 && opened.json?.number === 1 && opened.json.head === "feature/x" && opened.json.base === "main", opened.text);
  const twice = await call(`${repo}/pulls`, { method: "POST", body: { title: "Again" } });
  check("pullExists", twice.status === 409 && /A pull request already exists/.test(twice.json?.detail), twice.text);
  const listed = await call(`${repo}/pulls`);
  check("pullsListed", listed.json?.pulls?.[0]?.title === "From the room", listed.text);
  const detail = (await call(`${repo}/pulls/1`)).json;
  const readmePatch = detail?.files?.find((f) => f.path === "README.md")?.patch ?? "";
  check("pullDetail", detail?.headSha === github.refs.get("feature/x") && readmePatch.includes("+# Branch") && detail.body === "Made in CodeChatter", JSON.stringify(detail?.files));
  const commented = await call(`${repo}/pulls/1/comments`, { method: "POST", body: { body: "Nice heading", path: "README.md", line: 1, side: "RIGHT", commitId: detail?.headSha } });
  check("lineComment", commented.status === 201 && commented.json?.line === 1 && commented.json.side === "RIGHT" && commented.json.author === "cc-writer", commented.text);
  const replied = await call(`${repo}/pulls/1/comments`, { method: "POST", body: { body: "Thanks", inReplyTo: commented.json?.id } });
  check("reply", replied.status === 201 && replied.json?.inReplyTo === commented.json?.id, replied.text);
  const offDiff = await call(`${repo}/pulls/1/comments`, { method: "POST", body: { body: "Where?", path: "README.md", line: 99, side: "RIGHT", commitId: detail?.headSha } });
  check("badLineRefused", offDiff.status === 400 && /Line could not be resolved/.test(offDiff.json?.detail), offDiff.text);
  check("commentsBack", (await call(`${repo}/pulls/1`)).json?.comments?.length === 2);
  check("noPull404", (await call(`${repo}/pulls/99`)).status === 404);

  // GitHub activity in chat: the webhook made with the token, then signed deliveries.
  const deliver = (event, payload, secret) => {
    const raw = JSON.stringify(payload);
    const signature = secret ? `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` : null;
    return fetch(`${API}/api/github/webhooks/${roomId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": event, ...(signature && { "x-hub-signature-256": signature }) },
      body: raw,
    }).then((r) => r.status);
  };
  const lastMessage = async () => (await call(`/api/rooms/${roomId}/messages?limit=1`)).json?.[0];
  const repository = { full_name: "cc-test/demo" };
  const push = { repository, ref: "refs/heads/main", pusher: { name: "cc-writer" }, commits: [{ id: "a".repeat(40), message: "Fix it\n\nBecause" }] };

  const connected = await call(`${repo}/webhook`, { method: "POST" });
  const [hookId, hook] = [...github.hooks][0] ?? [];
  check(
    "webhookMade",
    connected.json?.made === "github" && hook?.config?.url === `${ORIGIN}/api/github/webhooks/${roomId}` && hook.events.includes("workflow_run") && (await call(repo)).json?.webhook === true,
    connected.text,
  );
  const secret = hook?.config?.secret;
  check("pingPosted", (await deliver("ping", { repository }, secret)) === 204 && /^GitHub is connected/.test((await lastMessage())?.body ?? ""));
  const pushed = (await deliver("push", push, secret)) === 204 ? await lastMessage() : null;
  check("pushPosted", pushed?.kind === "github" && pushed.author === null && pushed.body === "cc-writer pushed 1 commit to main:\n`aaaaaaa` Fix it", JSON.stringify(pushed));
  check("badSignatureRefused", (await deliver("push", push, "not-the-secret")) === 401 && (await deliver("push", push, null)) === 401);
  const latest = (await lastMessage())?.id;
  check("otherRepoIgnored", (await deliver("push", { ...push, repository: { full_name: "someone/else" } }, secret)) === 204 && (await lastMessage())?.id === latest);
  check("quietEventIgnored", (await deliver("pull_request", { repository, action: "labeled", pull_request: { number: 1, title: "x", html_url: "u" } }, secret)) === 204 && (await lastMessage())?.id === latest);

  const reconnected = await call(`${repo}/webhook`, { method: "POST" });
  check("reconnectReplaces", reconnected.json?.made === "github" && github.hooks.size === 1 && !github.hooks.has(hookId) && (await deliver("ping", { repository }, secret)) === 401);
  const newSecret = [...github.hooks.values()][0]?.config?.secret;
  const off = await call(`${repo}/webhook`, { method: "DELETE" });
  check("disconnect", off.status === 204 && github.hooks.size === 0 && (await deliver("ping", { repository }, newSecret)) === 404 && (await call(repo)).json?.webhook === false, off.text);

  // Without a token it's added by hand on GitHub: the address and secret come back once.
  await call("/api/me/github", { method: "DELETE" });
  const manual = await call(`${repo}/webhook`, { method: "POST" });
  check("manualSetup", manual.json?.made === "manual" && manual.json.url === `${ORIGIN}/api/github/webhooks/${roomId}` && (await deliver("ping", { repository }, manual.json.secret)) === 204, manual.text);
  await call("/api/me/github", { method: "PUT", body: { token: `ghp_mockwriter${"w".repeat(26)}` } });

  const branches = await call(`${repo}/branches`);
  check("branches", JSON.stringify(branches.json?.branches?.sort()) === JSON.stringify(["feature/x", "main"]), branches.text);
  const switched = await call(`${repo}/pull`, { method: "POST", body: { since: branched.json?.commit, branch: "main" } });
  check("switchBranch", switched.json?.upToDate === false && switched.json.branch === "main" && switched.json.commit === third && (await call(repo)).json?.branch === "main", switched.text.slice(0, 160));

  const fromDefault = await call(`${repo}/pulls`, { method: "POST", body: { title: "From main" } });
  check("noPullFromDefault", fromDefault.status === 400 && /The room is on main, the default branch/.test(fromDefault.json?.detail), fromDefault.text);

  const bad = await call(`${repo}/commit`, { method: "POST", body: { since: third, message: "Escape", changes: [{ path: "../outside", content: "x" }] } });
  check("badPathRefused", bad.status === 400, bad.text);
  // A room that isn't on GitHub, published as a new repository, then linked to it; and a file as a gist.
  const plain = await call("/api/rooms", { method: "POST", body: { name: "Publish e2e" } });
  publishedRoom = plain.json?.id ?? null;
  const publishFiles = [
    { path: "main.py", content: "print('published')\n" },
    { path: "docs/notes.md", content: "# Notes\n" },
  ];
  const repoName = `published-${Date.now().toString(36)}`;
  await call("/api/me/github", { method: "DELETE" });
  const noTokenPublish = await call(`/api/rooms/${publishedRoom}/repo/publish`, { method: "POST", body: { name: repoName, files: publishFiles } });
  check("publishNeedsToken", noTokenPublish.status === 400 && /Add a GitHub token in Settings to publish/.test(noTokenPublish.json?.detail), noTokenPublish.text);
  await call("/api/me/github", { method: "PUT", body: { token: `ghp_mockwriter${"w".repeat(26)}` } });
  const leakyPublish = await call(`/api/rooms/${publishedRoom}/repo/publish`, {
    method: "POST",
    body: { name: repoName, files: [...publishFiles, { path: ".env", content: "DB_PASSWORD=Zq8!vR2#mK9pL4\n" }] },
  });
  check("publishSecretRefused", leakyPublish.status === 422 && leakyPublish.json?.secrets?.[0]?.path === ".env" && !github.repos.has(`cc-writer/${repoName}`), leakyPublish.text);
  const published = await call(`/api/rooms/${publishedRoom}/repo/publish`, { method: "POST", body: { name: repoName, description: "From a room", files: publishFiles } });
  const onGithubNow = github.filesOf(`cc-writer/${repoName}`, "main");
  check(
    "published",
    published.status === 201 && published.json?.repo === `cc-writer/${repoName}` && published.json.branch === "main" && github.repos.get(`cc-writer/${repoName}`)?.private === true,
    published.text,
  );
  check("exactlyTheRoomsFiles", JSON.stringify(onGithubNow) === JSON.stringify({ "docs/notes.md": "# Notes\n", "main.py": "print('published')\n" }), JSON.stringify(onGithubNow));
  const linked = (await call(`/api/rooms/${publishedRoom}/repo`)).json;
  check("roomLinked", linked?.owner === "cc-writer" && linked.name === repoName && linked.commit === published.json?.commit && linked.defaultBranch === "main", JSON.stringify(linked));
  const publishedTwice = await call(`/api/rooms/${publishedRoom}/repo/publish`, { method: "POST", body: { name: `${repoName}-2`, files: publishFiles } });
  check("alreadyLinked", publishedTwice.status === 409 && /already linked to cc-writer\//.test(publishedTwice.json?.detail), publishedTwice.text);
  const linkedPublish = await call(`/api/rooms/${roomId}/repo/publish`, { method: "POST", body: { name: "demo", files: publishFiles } });
  check("linkedRoomRefused", linkedPublish.status === 409, linkedPublish.text);

  const gist = await call(`/api/rooms/${roomId}/repo/gist`, { method: "POST", body: { name: "app.py", content: "print('gist')\n", description: "A snippet" } });
  const made = github.gists.at(-1);
  check("gist", gist.status === 201 && /^https:\/\/gist\.github\.com\//.test(gist.json?.url) && made?.files?.["app.py"]?.content === "print('gist')\n" && made.public === false, gist.text);
  // A gist with a key: refused, then made when the sender goes ahead.
  const keyGist = { name: "keys.py", content: `KEY = "${awsKey}"\n` };
  const gistRefused = await call(`/api/rooms/${roomId}/repo/gist`, { method: "POST", body: keyGist });
  const gistsBefore = github.gists.length;
  const gistAnyway = await call(`/api/rooms/${roomId}/repo/gist`, { method: "POST", body: { ...keyGist, allowSecrets: true } });
  check(
    "gistSecretGoesAhead",
    gistRefused.status === 422 && gistRefused.json?.secrets?.[0]?.path === "keys.py" && gistAnyway.status === 201 && github.gists.length === gistsBefore + 1,
    `${gistRefused.status} ${gistAnyway.text}`,
  );
  await call("/api/me/github", { method: "DELETE" });
  const noTokenGist = await call(`/api/rooms/${roomId}/repo/gist`, { method: "POST", body: { name: "a.py", content: "x" } });
  check("gistNeedsToken", noTokenGist.status === 400 && /to make gists/.test(noTokenGist.json?.detail), noTokenGist.text);

  const blank = await call(`/api/rooms/E2ETST/repo`);
  check("notLinked", blank.status === 404 || blank.status === 403, blank.text);
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  if (roomId) check("roomDeleted", (await call(`/api/rooms/${roomId}`, { method: "DELETE" })).status === 204);
  if (publishedRoom) check("publishedRoomDeleted", (await call(`/api/rooms/${publishedRoom}`, { method: "DELETE" })).status === 204);
  await call("/api/me/github", { method: "DELETE" }).catch(() => {});
  api.kill();
  await github.close();
}
if (results.some((r) => !r) && apiErrors) console.log(apiErrors.slice(-2000));
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
