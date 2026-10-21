// A small GitHub for tests (source-control.e2e.mjs): repositories with real git objects in memory, served through
// the parts of the REST API the API uses: repositories (and making one), branches, commits by ref, tarballs, the
// Git Data API (commits, flat recursive trees, refs that move only forward), webhooks, pull requests with review
// comments, and gists. Tokens: "ghp_mockwriter…" (user cc-writer) can write, "ghp_mockreader…" can only read,
// anything else is refused; reading needs no token.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

const sha1 = (value) => createHash("sha1").update(value).digest("hex");

export function mockGithub({ owner = "cc-test", name = "demo", files = {}, modes = {} } = {}) {
  // Git objects, shared by every repository.
  const blobs = new Map();
  const trees = new Map(); // sha → [{ path, mode, type: "blob", sha }]
  const commits = new Map(); // sha → { tree, parents, message }
  const repos = new Map(); // "owner/name" (lower case) → { owner, name, refs, pulls, hooks, private }
  const gists = [];
  const requests = [];
  let hookIds = 9000;
  let commentIds = 100;

  const putBlob = (content) => {
    const sha = sha1(`blob ${content}`);
    blobs.set(sha, content);
    return sha;
  };
  const putTree = (entries) => {
    const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
    const sha = sha1(`tree ${JSON.stringify(sorted)}`);
    trees.set(sha, sorted);
    return sha;
  };
  const putCommit = (tree, parents, message) => {
    const sha = sha1(`commit ${tree} ${parents.join(",")} ${message} ${commits.size}`);
    commits.set(sha, { tree, parents, message });
    return sha;
  };
  /** A tree from `base` (or nothing) with each change: content to write, null to delete. */
  const changeTree = (base, changes) => {
    const entries = new Map((trees.get(base) ?? []).map((e) => [e.path, e]));
    for (const change of changes) {
      if (change.content === null) entries.delete(change.path);
      else entries.set(change.path, { path: change.path, mode: change.mode ?? entries.get(change.path)?.mode ?? "100644", type: "blob", sha: putBlob(change.content) });
    }
    return putTree([...entries.values()]);
  };
  const isAncestor = (ancestor, of) => {
    const seen = new Set();
    const queue = [of];
    while (queue.length) {
      const sha = queue.shift();
      if (sha === ancestor) return true;
      if (seen.has(sha)) continue;
      seen.add(sha);
      queue.push(...(commits.get(sha)?.parents ?? []));
    }
    return false;
  };

  const makeRepo = (repoOwner, repoName, initial, initialModes = {}, isPrivate = false) => {
    const repo = { owner: repoOwner, name: repoName, refs: new Map(), pulls: new Map(), hooks: new Map(), private: isPrivate };
    const tree = putTree(Object.entries(initial).map(([path, content]) => ({ path, mode: initialModes[path] ?? "100644", type: "blob", sha: putBlob(content) })));
    repo.refs.set("main", putCommit(tree, [], "Initial commit"));
    repos.set(`${repoOwner}/${repoName}`.toLowerCase(), repo);
    return repo;
  };
  const main = makeRepo(owner, name, files, modes);

  const resolve = (repo, ref) => repo.refs.get(ref) ?? (commits.has(ref) ? ref : null);
  /** The files of a commit, { path: content }. */
  const filesAt = (repo, ref) => Object.fromEntries((trees.get(commits.get(resolve(repo, ref))?.tree) ?? []).map((e) => [e.path, blobs.get(e.sha)]));

  const summary = (repo, pull) => ({
    number: pull.number,
    title: pull.title,
    user: { login: "cc-writer" },
    head: { ref: pull.head, sha: repo.refs.get(pull.head) },
    base: { ref: pull.base, sha: repo.refs.get(pull.base) },
    draft: false,
    html_url: `https://github.com/${repo.owner}/${repo.name}/pull/${pull.number}`,
    updated_at: "2026-10-21T00:00:00Z",
  });
  const lineCount = (text) => (text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);
  /** A pull request's files as whole-file patches. */
  const pullFiles = (repo, pull) => {
    const before = filesAt(repo, pull.base);
    const after = filesAt(repo, pull.head);
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .filter((path) => before[path] !== after[path])
      .map((path) => {
        const [a, b] = [before[path] ?? "", after[path] ?? ""];
        const [n, m] = [lineCount(a), lineCount(b)];
        const body = [...(n ? a.replace(/\n$/, "").split("\n").map((l) => `-${l}`) : []), ...(m ? b.replace(/\n$/, "").split("\n").map((l) => `+${l}`) : [])];
        return {
          filename: path,
          status: path in before ? (path in after ? "modified" : "removed") : "added",
          additions: m,
          deletions: n,
          patch: `@@ -${n ? 1 : 0},${n} +${m ? 1 : 0},${m} @@\n${body.join("\n")}`,
        };
      });
  };
  const addComment = (repo, pull, comment) => {
    const made = { id: ++commentIds, ...comment, user: { login: "cc-writer" }, created_at: "2026-10-21T00:00:00Z", html_url: `https://github.com/${repo.owner}/${repo.name}/pull/${pull.number}#discussion_r${commentIds}` };
    pull.comments.push(made);
    return made;
  };

  const tarball = (repo, sha) => {
    const blocks = [];
    const header = (path, size, flag) => {
      const block = Buffer.alloc(512);
      block.write(path, 0);
      block.write("0000644\0", 100);
      block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
      block.write(flag, 156);
      block.write("ustar\0", 257);
      block.write("00", 263);
      block.fill(" ", 148, 156);
      let sum = 0;
      for (const byte of block) sum += byte;
      block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
      return block;
    };
    const add = (path, data, flag) => {
      blocks.push(header(path, data.length, flag), data, Buffer.alloc((512 - (data.length % 512)) % 512));
    };
    const record = ` comment=${sha}\n`;
    // A pax record's length counts its own digits.
    add("pax_global_header", Buffer.from(`${record.length + String(record.length + 2).length}${record}`), "g");
    const root = `${repo.owner}-${repo.name}-${sha.slice(0, 7)}/`;
    add(root, Buffer.alloc(0), "5");
    for (const entry of trees.get(commits.get(sha).tree)) add(root + entry.path, Buffer.from(blobs.get(entry.sha)), "0");
    return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://mock");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;
    requests.push({ method: req.method, path: url.pathname, token });
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
    };
    if (token && !/^ghp_mock(writer|reader)/.test(token)) return send(401, { message: "Bad credentials" });
    const canWrite = Boolean(token?.startsWith("ghp_mockwriter"));
    const login = canWrite ? "cc-writer" : "cc-reader";
    if (url.pathname === "/user") return token ? send(200, { login }) : send(401, { message: "Requires authentication" });
    if (req.method !== "GET" && !canWrite) return send(token ? 403 : 401, { message: "Resource not accessible" });

    if (url.pathname === "/user/repos" && req.method === "POST") {
      if (repos.has(`${login}/${body.name}`.toLowerCase())) return send(422, { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] });
      const made = makeRepo(login, body.name, body.auto_init ? { "README.md": `# ${body.name}\n` } : {}, {}, Boolean(body.private));
      return send(201, { full_name: `${login}/${body.name}`, name: body.name, owner: { login }, default_branch: "main", private: made.private, html_url: `https://github.com/${login}/${body.name}` });
    }
    if (url.pathname === "/gists" && req.method === "POST") {
      const gist = { id: `g${gists.length + 1}`, ...body, html_url: `https://gist.github.com/${login}/g${gists.length + 1}` };
      gists.push(gist);
      return send(201, gist);
    }

    const at = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(url.pathname);
    const repo = at && repos.get(`${at[1]}/${at[2]}`.toLowerCase());
    if (!repo) return send(404, { message: "Not Found" });
    const path = at[3];
    const { refs, pulls, hooks } = repo;

    if (path === "") return send(200, { full_name: `${repo.owner}/${repo.name}`, default_branch: "main", private: repo.private });
    if (path === "/branches") return send(200, [...refs.keys()].map((branch) => ({ name: branch })));
    let match;
    if ((match = /^\/commits\/(.+)$/.exec(path))) {
      const sha = resolve(repo, decodeURIComponent(match[1]));
      return sha ? send(200, sha, { "content-type": "text/plain" }) : send(404, { message: "No commit found" });
    }
    if ((match = /^\/tarball\/(.+)$/.exec(path))) {
      const sha = resolve(repo, decodeURIComponent(match[1]));
      return sha ? send(200, tarball(repo, sha), { "content-type": "application/x-gzip" }) : send(404, { message: "Not Found" });
    }
    if ((match = /^\/git\/commits\/([0-9a-f]{40})$/.exec(path)) && req.method === "GET") {
      const commit = commits.get(match[1]);
      return commit ? send(200, { sha: match[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })) }) : send(404, { message: "Not Found" });
    }
    if ((match = /^\/git\/trees\/([0-9a-f]{40})$/.exec(path))) {
      const tree = trees.get(match[1]);
      return tree ? send(200, { sha: match[1], tree, truncated: false }) : send(404, { message: "Not Found" });
    }
    if (path === "/git/trees" && req.method === "POST") {
      if (body.base_tree !== undefined && !trees.has(body.base_tree)) return send(422, { message: "base_tree not found" });
      const base = trees.get(body.base_tree) ?? [];
      const missing = body.tree.find((e) => e.sha === null && !base.some((t) => t.path === e.path));
      if (missing) return send(422, { message: `${missing.path} isn't in the base tree` });
      return send(201, { sha: changeTree(body.base_tree, body.tree.map((e) => ({ path: e.path, mode: e.mode, content: e.sha === null ? null : e.content }))) });
    }
    if (path === "/git/commits" && req.method === "POST") {
      if (!trees.has(body.tree) || !body.parents.every((p) => commits.has(p))) return send(422, { message: "Bad tree or parent" });
      return send(201, { sha: putCommit(body.tree, body.parents, body.message) });
    }
    if ((match = /^\/git\/refs\/heads\/(.+)$/.exec(path)) && req.method === "PATCH") {
      const branch = decodeURIComponent(match[1]);
      const current = refs.get(branch);
      if (!current) return send(422, { message: "Reference does not exist" });
      if (!body.force && !isAncestor(current, body.sha)) return send(422, { message: "Update is not a fast forward" });
      refs.set(branch, body.sha);
      return send(200, { ref: `refs/heads/${branch}`, object: { sha: body.sha } });
    }
    if (path === "/git/refs" && req.method === "POST") {
      const branch = body.ref.replace(/^refs\/heads\//, "");
      if (refs.has(branch)) return send(422, { message: "Reference already exists" });
      refs.set(branch, body.sha);
      return send(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (path === "/hooks" && req.method === "POST") {
      const id = ++hookIds;
      hooks.set(id, body);
      return send(201, { id, ...body });
    }
    if ((match = /^\/hooks\/(\d+)$/.exec(path)) && req.method === "DELETE") {
      return hooks.delete(Number(match[1])) ? send(204, "") : send(404, { message: "Not Found" });
    }
    if (path === "/pulls" && req.method === "POST") {
      const [head, base] = [refs.get(body.head), refs.get(body.base)];
      if (!head || !base) return send(422, { message: "Validation Failed", errors: [{ message: `No branch called ${head ? body.base : body.head}` }] });
      if (head === base) return send(422, { message: "Validation Failed", errors: [{ message: `No commits between ${body.base} and ${body.head}` }] });
      if ([...pulls.values()].some((p) => p.state === "open" && p.head === body.head)) {
        return send(422, { message: "Validation Failed", errors: [{ message: `A pull request already exists for ${repo.owner}:${body.head}.` }] });
      }
      const pull = { number: pulls.size + 1, title: body.title, body: body.body ?? "", head: body.head, base: body.base, state: "open", comments: [] };
      pulls.set(pull.number, pull);
      return send(201, summary(repo, pull));
    }
    if (path.startsWith("/pulls")) {
      if (path === "/pulls") return send(200, [...pulls.values()].filter((p) => p.state === "open").reverse().map((p) => summary(repo, p)));
      const pull = pulls.get(Number(/^\/pulls\/(\d+)/.exec(path)?.[1]));
      if (!pull) return send(404, { message: "Not Found" });
      const rest = path.replace(/^\/pulls\/\d+/, "");
      if (rest === "") return send(200, { ...summary(repo, pull), body: pull.body, state: pull.state, merged: false });
      if (rest === "/files") return send(200, pullFiles(repo, pull));
      if (rest === "/comments" && req.method === "GET") return send(200, pull.comments);
      if (rest === "/comments" && req.method === "POST") {
        const file = pullFiles(repo, pull).find((f) => f.filename === body.path);
        const lines = (filesAt(repo, body.side === "LEFT" ? pull.base : pull.head)[body.path] ?? "").split("\n").length - 1;
        if (!file || body.line < 1 || body.line > lines) return send(422, { message: "Validation Failed", errors: [{ message: "Line could not be resolved" }] });
        return send(201, addComment(repo, pull, { path: body.path, line: body.line, side: body.side, body: body.body }));
      }
      const reply = /^\/comments\/(\d+)\/replies$/.exec(rest);
      const parent = reply && pull.comments.find((c) => c.id === Number(reply[1]));
      if (parent && req.method === "POST") return send(201, addComment(repo, pull, { path: parent.path, line: parent.line, side: parent.side, body: body.body, in_reply_to_id: parent.id }));
      return send(404, { message: "Not Found" });
    }
    send(404, { message: "Not Found" });
  });

  return {
    server,
    // The first repository's state, as the tests read it.
    refs: main.refs,
    hooks: main.hooks,
    commits,
    repos,
    gists,
    requests,
    filesAt: (ref) => filesAt(main, ref),
    /** A repository's files at a ref, by "owner/name". */
    filesOf: (fullName, ref) => filesAt(repos.get(fullName.toLowerCase()), ref),
    modeOf: (ref, path) => trees.get(commits.get(resolve(main, ref)).tree).find((e) => e.path === path)?.mode,
    /** Someone pushes to a branch of the first repository on GitHub directly. */
    pushDirect: (branch, changes, message = "Pushed on GitHub") => {
      const parent = main.refs.get(branch);
      const sha = putCommit(changeTree(commits.get(parent).tree, changes), [parent], message);
      main.refs.set(branch, sha);
      return sha;
    },
    listen: (port = 0) => new Promise((done) => server.listen(port, "127.0.0.1", () => done(server.address().port))),
    close: () => new Promise((done) => server.close(done)),
  };
}
