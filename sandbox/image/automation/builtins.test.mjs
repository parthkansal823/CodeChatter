// The built-in steps (builtins.mjs), on their own: node --test sandbox/image/automation/builtins.test.mjs. They also run on the real engine in apps/runner/test/automations.e2e.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILTINS, commandEnv, doorOf, folderOf, icsOf, listOf, read, run, TESTS, workspaceRoot } from "./builtins.mjs";

const tests = [
  { name: "login", status: "failed", ms: 120, suite: { name: "auth" }, tags: ["slow", "ui"] },
  { name: "search", status: "passed", ms: 900, suite: { name: "web" }, tags: ["ui"] },
  { name: "save", status: "failed", ms: 40, suite: { name: "web" }, tags: [] },
  { name: "search", status: "passed", ms: 900, suite: { name: "web" }, tags: ["ui"] },
];

test("paths and lists", () => {
  assert.equal(read(tests[0], "suite.name"), "auth");
  assert.equal(read(tests[0], "tags[1]"), "ui");
  assert.equal(read(tests[0], ""), tests[0]);
  assert.deepEqual(listOf('[{"a":1}]'), [{ a: 1 }], "JSON text is read");
  assert.deepEqual(listOf({ a: 1 }), [{ a: 1 }], "one item is a list of one");
  assert.deepEqual(listOf(""), []);
  assert.deepEqual(listOf(null), []);
});

test("Edit Fields sets, keeps and removes, and reads from the item", () => {
  const set = BUILTINS.edit_fields({ items: tests.slice(0, 1), mode: "set", fields: { "result.ok": false, label: "$item.suite.name", fixed: 1 } });
  assert.deepEqual(set[0].result, { ok: false });
  assert.equal(set[0].label, "auth");
  assert.equal(set[0].name, "login", "the rest stays");
  assert.equal(tests[0].result, undefined, "what it was given isn't changed");
  assert.deepEqual(BUILTINS.edit_fields({ items: tests.slice(0, 1), mode: "keep", fields: "name, suite.name" }), [{ name: "login", suite: { name: "auth" } }]);
  assert.deepEqual(Object.keys(BUILTINS.edit_fields({ items: tests.slice(0, 1), mode: "remove", fields: ["ms", "tags"] })[0]), ["name", "status", "suite"]);
  assert.deepEqual(BUILTINS.edit_fields({ items: undefined, fields: '{"hello":"world"}' }), [{ hello: "world" }], "with no items, it makes one");
  assert.throws(() => BUILTINS.edit_fields({ items: [{}], fields: "[1]" }), /object of names and values/);
});

test("Filter keeps what passes, or what doesn't", () => {
  assert.deepEqual(BUILTINS.filter({ items: tests, field: "status", test: "equals", value: "failed" }).map((item) => item.name), ["login", "save"]);
  assert.equal(BUILTINS.filter({ items: tests, field: "status", test: "equals", value: "failed", keep: "failing" }).length, 2);
  assert.equal(BUILTINS.filter({ items: tests, field: "ms", test: "greater", value: "100" }).length, 3);
  assert.equal(BUILTINS.filter({ items: tests, field: "tags", test: "contains", value: "slow" }).length, 1, "contains looks in a list");
  assert.equal(BUILTINS.filter({ items: tests, field: "tags", test: "empty" }).length, 1);
  assert.equal(BUILTINS.filter({ items: tests, field: "name", test: "matches", value: "^s" }).length, 3);
  assert.throws(() => BUILTINS.filter({ items: tests, test: "nope" }), /no test called/);
  assert.ok(Object.keys(TESTS).length >= 19);
});

test("Sort by text, numbers or dates, either way, with nothing last", () => {
  assert.deepEqual(BUILTINS.sort({ items: tests, field: "ms", compare_as: "number", direction: "descending" }).map((item) => item.ms), [900, 900, 120, 40]);
  assert.deepEqual(BUILTINS.sort({ items: [{ v: "b" }, { v: "a10" }, { v: "a2" }, {}], field: "v" }).map((item) => item.v), ["a2", "a10", "b", undefined], "numbers inside text sort as people expect");
  assert.deepEqual(BUILTINS.sort({ items: [{ d: "2026-02-01" }, { d: "2026-01-01" }], field: "d", compare_as: "date" }).map((item) => item.d), ["2026-01-01", "2026-02-01"]);
});

test("Limit from the start or the end", () => {
  assert.equal(BUILTINS.limit({ items: tests, max: 2 }).length, 2);
  assert.deepEqual(BUILTINS.limit({ items: tests, max: "1", from: "end" }), [tests[3]]);
  assert.deepEqual(BUILTINS.limit({ items: tests, max: 0 }), []);
});

test("Aggregate gathers a field, or every item", () => {
  assert.deepEqual(BUILTINS.aggregate({ items: tests, fields: "ms" }), { count: 4, ms: [120, 900, 40, 900] });
  assert.deepEqual(BUILTINS.aggregate({ items: tests, fields: "name, suite.name" }), { count: 4, name: ["login", "search", "save", "search"], "suite.name": ["auth", "web", "web", "web"] }, "two fields that would share a name keep their whole paths");
  assert.deepEqual(BUILTINS.aggregate({ items: [{ a: 1 }, { a: null }, { b: 2 }], fields: "a" }), { count: 3, a: [1] }, "empty values are skipped");
  assert.deepEqual(BUILTINS.aggregate({ items: [{ a: 1 }] }), { items: [{ a: 1 }], count: 1 });
});

test("Summarize, overall and in groups", () => {
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "count" }), { count: 4 });
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "sum", field: "ms", group_by: "status" }), [
    { status: "failed", sum_ms: 160 },
    { status: "passed", sum_ms: 1800 },
  ]);
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "average", field: "ms" }), { average_ms: 490 });
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "count_unique", field: "name" }), { count_unique_name: 3 });
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "max", field: "ms", group_by: "suite.name" }), [
    { name: "auth", max_ms: 120 },
    { name: "web", max_ms: 900 },
  ]);
  assert.deepEqual(BUILTINS.summarize({ items: tests.slice(0, 2), operation: "join", field: "name", separator: " | " }), { join_name: "login | search" });
  assert.deepEqual(BUILTINS.summarize({ items: [], operation: "min", field: "ms" }), { min_ms: null });
});

test("Remove Duplicates, by everything or by some fields, keeping the first or the last", () => {
  assert.equal(BUILTINS.remove_duplicates({ items: tests }).length, 3);
  assert.deepEqual(BUILTINS.remove_duplicates({ items: tests, fields: "status" }).map((item) => item.name), ["login", "search"]);
  assert.deepEqual(BUILTINS.remove_duplicates({ items: tests, fields: "status", keep: "last" }).map((item) => item.name), ["save", "search"]);
});

test("Split Out turns a list inside each item into items", () => {
  assert.deepEqual(BUILTINS.split_out({ items: tests.slice(0, 2), field: "tags" }), [{ tags: "slow" }, { tags: "ui" }, { tags: "ui" }]);
  const kept = BUILTINS.split_out({ items: [{ id: 1, files: [{ path: "a" }, { path: "b" }] }], field: "files", keep_other_fields: true });
  assert.deepEqual(kept, [{ id: 1, path: "a" }, { id: 1, path: "b" }]);
});

test("Rename Keys", () => {
  assert.deepEqual(BUILTINS.rename_keys({ items: [{ a: 1, b: { c: 2 } }], renames: { a: "x", "b.c": "y" } }), [{ x: 1, b: {}, y: 2 }]);
});

test("Merge: one after the other, matched by a field, side by side, or every pairing", () => {
  const issues = [{ id: 1, title: "Bug" }, { id: 2, title: "Idea" }];
  const owners = [{ issue: 1, owner: "Asha" }, { issue: 3, owner: "Ben" }];
  assert.equal(BUILTINS.merge({ first: issues, second: owners }).length, 4);
  assert.deepEqual(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue" }), [{ id: 1, title: "Bug", issue: 1, owner: "Asha" }]);
  assert.equal(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue", keep: "all_first" }).length, 2);
  assert.equal(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue", keep: "all" }).length, 3);
  assert.deepEqual(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue", keep: "unmatched" }), [{ id: 2, title: "Idea" }]);
  assert.deepEqual(BUILTINS.merge({ first: [{ a: 1 }], second: [{ b: 2 }, { b: 3 }], mode: "position" }), [{ a: 1, b: 2 }, { b: 3 }]);
  assert.equal(BUILTINS.merge({ first: issues, second: owners, mode: "every_pair" }).length, 4);
  assert.throws(() => BUILTINS.merge({ first: issues, second: owners, mode: "match" }), /needs a field/);
});

test("Compare Datasets", () => {
  const before = [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }];
  const after = [{ id: 1, v: "a" }, { id: 2, v: "B" }, { id: 4, v: "d" }];
  const result = BUILTINS.compare_datasets({ first: before, second: after, first_key: "id" });
  assert.deepEqual(result.same, [{ id: 1, v: "a" }]);
  assert.deepEqual(result.different, [{ key: 2, first: { id: 2, v: "b" }, second: { id: 2, v: "B" }, fields: ["v"] }]);
  assert.deepEqual(result.only_in_first, [{ id: 3, v: "c" }]);
  assert.deepEqual(result.only_in_second, [{ id: 4, v: "d" }]);
});

test("Stop and Error, and a step that isn't there", async () => {
  assert.throws(() => BUILTINS.stop_and_error({ message: "Coverage dropped" }), /Coverage dropped/);
  await assert.rejects(run("nope", {}), /no built-in step called "nope"/);
  assert.deepEqual(await run("limit", { items: [1, 2, 3], max: 1 }), [1]);
});

test("Call a flow: asks the worker on its own port, and gives back what it answers", async () => {
  const { createServer } = await import("node:http");
  const heard = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const call = JSON.parse(body);
      heard.push({ path: req.url, call });
      res.setHeader("content-type", "application/json");
      if (call.flowId === "flow_broken") return res.writeHead(409).end(JSON.stringify({ error: "Doubler failed: no number" }));
      if (!call.wait) return res.end(JSON.stringify({ runId: "20261118-100000-abcd1234", queued: true }));
      res.end(JSON.stringify({ output: { doubled: call.data.n * 2 }, runId: "20261118-100000-0000ffff" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const before = process.env.AP_SANDBOX_WS_PORT;
  process.env.AP_SANDBOX_WS_PORT = String(server.address().port);
  try {
    assert.deepEqual(await run("call_flow", { flow: "flow_doubler", data: { n: 21 } }), { doubled: 42 });
    assert.deepEqual(heard[0], { path: "/v1/codechatter/call-flow", call: { flowId: "flow_doubler", data: { n: 21 }, wait: true } });
    // What to send typed as JSON text, and not waiting.
    assert.deepEqual(await run("call_flow", { flow: "flow_doubler", data: '{"n": 1}', wait: false }), { runId: "20261118-100000-abcd1234", queued: true });
    assert.deepEqual(heard[1].call, { flowId: "flow_doubler", data: { n: 1 }, wait: false });
    await assert.rejects(run("call_flow", { flow: "flow_broken", data: {} }), /Doubler failed: no number/);
    await assert.rejects(run("call_flow", { flow: "flow_doubler", data: "{ not json" }), /isn't valid JSON/);
    delete process.env.AP_SANDBOX_WS_PORT;
    await assert.rejects(run("call_flow", { flow: "flow_doubler" }), /only works in a run/);
  } finally {
    if (before === undefined) delete process.env.AP_SANDBOX_WS_PORT;
    else process.env.AP_SANDBOX_WS_PORT = before;
    server.close();
  }
});

test("Approval links: one for each choice, at the address the wait after them will have", async () => {
  const { createServer } = await import("node:http");
  let asked = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      asked += 1;
      res.setHeader("content-type", "application/json");
      if (req.url !== "/v1/codechatter/approval-links") return res.writeHead(404).end("{}");
      res.end(JSON.stringify({ url: "https://code.example/api/hooks/automations/resume/ROOM01/20261118-100000-abcd1234/TOKENTOKENTOKENTOKEN" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const before = process.env.AP_SANDBOX_WS_PORT;
  process.env.AP_SANDBOX_WS_PORT = String(server.address().port);
  try {
    const base = "https://code.example/api/hooks/automations/resume/ROOM01/20261118-100000-abcd1234/TOKENTOKENTOKENTOKEN";
    const links = await run("approval_links", {});
    assert.deepEqual(links, { approve: `${base}?action=approve`, reject: `${base}?action=reject`, links: { approve: `${base}?action=approve`, reject: `${base}?action=reject` }, url: base });
    const own = await run("approval_links", { choices: "ship it, wait a day" });
    assert.deepEqual(Object.keys(own.links), ["ship it", "wait a day"]);
    assert.equal(own.links["ship it"], `${base}?action=ship%20it`);
    await assert.rejects(run("approval_links", { choices: " , " }), /at least one choice/);
    assert.equal(asked, 2);
  } finally {
    if (before === undefined) delete process.env.AP_SANDBOX_WS_PORT;
    else process.env.AP_SANDBOX_WS_PORT = before;
    server.close();
  }
});

test("CodeChatter's own steps: where they reach, and what a command gets", () => {
  assert.equal(doorOf({ OPENAI_BASE_URL: "http://127.0.0.1:3129/v1" }), "http://127.0.0.1:3129");
  assert.equal(doorOf({ OPENAI_BASE_URL: "http://127.0.0.1:3129/v1/" }), "http://127.0.0.1:3129");
  assert.equal(doorOf({}), "http://127.0.0.1:3129");
  assert.equal(folderOf(""), workspaceRoot());
  assert.equal(folderOf("tests/unit"), `${workspaceRoot()}/tests/unit`);
  assert.throws(() => folderOf("../etc"), /folder in the room/);
  assert.throws(() => folderOf("/etc"), /folder in the room/);
  assert.throws(() => folderOf("src/../../x"), /folder in the room/);
  // The engine's worker port and token stay with the engine.
  assert.deepEqual(commandEnv({ PATH: "/usr/bin", OPENAI_BASE_URL: "x", AP_SANDBOX_WS_TOKEN: "secret", AP_SANDBOX_WS_PORT: "1", SANDBOX_ID: "room" }), { PATH: "/usr/bin", OPENAI_BASE_URL: "x" });
});

test("Ask the room's AI and Post to the room's chat, through a stand-in door", async () => {
  const { createServer } = await import("node:http");
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const asked = JSON.parse(body || "{}");
      seen.push({ path: req.url, asked });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/chat/completions") {
        const wantsJson = asked.messages.some((message) => message.role === "system" && /JSON only/.test(message.content));
        if (asked.messages.at(-1).content === "refuse") {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: { message: "AI help is off during this interview." } }));
        }
        return res.end(JSON.stringify({ model: "gemma", choices: [{ message: { content: wantsJson ? '```json\n{"verdict":"flaky"}\n```' : "It divided by zero." } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }));
      }
      if (req.url === "/codechatter/chat") {
        if (asked.text === "too many") {
          res.statusCode = 429;
          return res.end(JSON.stringify({ title: "too many requests", detail: "This room's automations have posted 20 messages in a minute." }));
        }
        return res.end(JSON.stringify({ id: "msg-1", createdAt: "2026-11-18T10:00:00.000Z" }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const before = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const plain = await run("ask_ai", { prompt: "Why did it fail?", instructions: "Two sentences." });
    assert.deepEqual(plain, { text: "It divided by zero.", model: "gemma", usage: { inputTokens: 12, outputTokens: 5 } });
    assert.deepEqual(seen[0].asked.messages, [{ role: "system", content: "Two sentences." }, { role: "user", content: "Why did it fail?" }]);
    assert.equal(seen[0].asked.model, "default");
    const parsed = await run("ask_ai", { prompt: "Is it flaky?", json: true });
    assert.deepEqual(parsed.json, { verdict: "flaky" });
    await assert.rejects(run("ask_ai", { prompt: "refuse" }), /AI help is off during this interview/);
    await assert.rejects(run("ask_ai", { prompt: " " }), /Say what to ask/);

    assert.deepEqual(await run("post_to_chat", { text: "  Deployed staging.  " }), { id: "msg-1", text: "Deployed staging.", postedAt: "2026-11-18T10:00:00.000Z" });
    assert.deepEqual(seen.at(-1), { path: "/codechatter/chat", asked: { text: "Deployed staging." } });
    await assert.rejects(run("post_to_chat", { text: "too many" }), /posted 20 messages in a minute/);
    await assert.rejects(run("post_to_chat", { text: "x".repeat(4001) }), /up to 4,000 characters/);
  } finally {
    if (before === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = before;
    server.close();
  }
});

test("Run a command: its output, its exit code, failing, and a time limit", { skip: process.platform === "win32" ? "needs bash and a Unix folder: it runs for real in apps/runner/test/automation-codechatter.e2e.mjs" : false }, async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const here = mkdtempSync(`${tmpdir()}/cc-command-`);
  const previous = process.env.CC_WORKSPACE;
  process.env.CC_WORKSPACE = here;
  const { mkdirSync } = await import("node:fs");
  mkdirSync(`${here}/sub`);
  const ran = await run("run_command", { command: "pwd && echo out && echo err >&2", folder: "sub", fail_on_error: true });
  assert.equal(ran.exitCode, 0);
  assert.equal(ran.stdout.trim().split("\n")[0], `${here}/sub`);
  assert.equal(ran.stdout.trim().split("\n")[1], "out");
  assert.equal(ran.stderr.trim(), "err");
  await assert.rejects(run("run_command", { command: "echo broken >&2 && exit 3" }), /ended with 3: broken/);
  const kept = await run("run_command", { command: "exit 4", fail_on_error: false });
  assert.equal(kept.exitCode, 4);
  await assert.rejects(run("run_command", { command: "sleep 5", seconds: 1 }), /longer than 1 second,/);
  await assert.rejects(run("run_command", { command: " " }), /Say which command/);
  if (previous === undefined) delete process.env.CC_WORKSPACE;
  else process.env.CC_WORKSPACE = previous;
});

test("Read files and Write a file: the room's files, through a stand-in worker that keeps step files", async () => {
  const { createServer } = await import("node:http");
  const { mkdtempSync, mkdirSync: makeFolder, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const kept = new Map();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/v1/codechatter/files") {
        const { name, data } = JSON.parse(Buffer.concat(chunks).toString());
        const id = `f${kept.size + 1}`;
        kept.set(id, Buffer.from(data, "base64"));
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/v1/step-files/run1/${id}/${encodeURIComponent(name)}` }));
      }
      const found = kept.get(req.url.split("/")[4] ?? "");
      if (req.method === "GET" && found) return res.end(found);
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = mkdtempSync(join(tmpdir(), "cc-files-"));
  const before = { port: process.env.AP_SANDBOX_WS_PORT, workspace: process.env.CC_WORKSPACE };
  process.env.AP_SANDBOX_WS_PORT = String(server.address().port);
  process.env.CC_WORKSPACE = root;
  try {
    makeFolder(join(root, "reports", "old"), { recursive: true });
    writeFileSync(join(root, "reports", "b.csv"), "name,n\nb,2\n");
    writeFileSync(join(root, "reports", "a.csv"), "name,n\na,1\n");
    writeFileSync(join(root, "reports", "old", "z.csv"), "z");
    const read = await run("read_files", { paths: "reports/*.csv", as_text: true });
    assert.deepEqual(
      read.map(({ path, fileName, size, mimeType, text }) => ({ path, fileName, size, mimeType, text })),
      [
        { path: "reports/a.csv", fileName: "a.csv", size: 11, mimeType: "text/csv", text: "name,n\na,1\n" },
        { path: "reports/b.csv", fileName: "b.csv", size: 11, mimeType: "text/csv", text: "name,n\nb,2\n" },
      ],
    );
    assert.match(read[0].file, /\/v1\/step-files\/run1\/f1\/a\.csv$/, "each is a step's file");
    const both = await run("read_files", { paths: "reports/a.csv\nreports/**/*.csv" });
    assert.deepEqual(both.map((item) => item.path), ["reports/a.csv", "reports/b.csv", "reports/old/z.csv"], "each once, in the order named");
    assert.equal(both[0].text, undefined, "text only when asked");
    assert.deepEqual(await run("read_files", { paths: "nothing/*.csv" }), [], "a pattern can find none");
    await assert.rejects(run("read_files", { paths: "reports/missing.csv" }), /no file reports\/missing\.csv in the room/);
    await assert.rejects(run("read_files", { paths: "../outside.txt" }), /should be a path in the room/);
    await assert.rejects(run("read_files", { paths: "reports/**/*.csv", max: 2 }), /More than 2 files match/);
    await assert.rejects(run("read_files", { paths: " " }), /Say which files/);

    // Text, JSON, and a step's file, into the room.
    assert.deepEqual(await run("write_file", { path: "out/summary.txt", content: "hello" }), { path: "out/summary.txt", size: 5, written: 5, action: "created" });
    assert.equal((await run("write_file", { path: "out/summary.txt", content: " world", mode: "append" })).action, "added to");
    assert.equal(readFileSync(join(root, "out", "summary.txt"), "utf8"), "hello world");
    await run("write_file", { path: "out/data.json", content: { ok: true } });
    assert.equal(readFileSync(join(root, "out", "data.json"), "utf8"), '{\n  "ok": true\n}\n');
    assert.equal((await run("write_file", { path: "out/copy.csv", content: read[1].file, content_is: "file" })).action, "created");
    assert.equal(readFileSync(join(root, "out", "copy.csv"), "utf8"), "name,n\nb,2\n");
    assert.equal((await run("write_file", { path: "out/copy2.csv", content: read[0], content_is: "file" })).written, 11, "an item with a file is taken");
    assert.equal((await run("write_file", { path: "out/copy3.csv", content: { fileName: "b.csv", url: read[1].file }, content_is: "file" })).written, 11, "and one with a url, as File Helper's Create File gives");
    await run("write_file", { path: "out/data.txt", content: "data:text/plain;base64,aGk=", content_is: "file" });
    assert.equal(readFileSync(join(root, "out", "data.txt"), "utf8"), "hi");
    assert.equal(readFileSync(join(root, "out", "summary.txt"), "utf8"), "hello world");
    await run("write_file", { path: "out/link.txt", content: "https://example.com is ours" });
    assert.equal(readFileSync(join(root, "out", "link.txt"), "utf8"), "https://example.com is ours", "text that starts with an address is text");
    await assert.rejects(run("write_file", { path: "out/summary.txt", content: "x", mode: "new" }), /already in the room/);
    assert.equal((await run("write_file", { path: "out/summary.txt", content: "new" })).action, "replaced");
    await assert.rejects(run("write_file", { path: "out", content: "x" }), /is a folder/);
    await assert.rejects(run("write_file", { path: "/etc/passwd", content: "x" }), /should be a path in the room/);
    await assert.rejects(run("write_file", { path: "out/x.txt", content: "not an address", content_is: "file" }), /Give a file's address/);
    await assert.rejects(run("write_file", { path: "out/x.txt", content: "x", mode: "sideways" }), /doesn't know how to "sideways"/);
  } finally {
    for (const [name, value] of [["AP_SANDBOX_WS_PORT", before.port], ["CC_WORKSPACE", before.workspace]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Save run data: what a run keeps to be found by, through a stand-in worker", async () => {
  const { createServer } = await import("node:http");
  let kept = {};
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      kept = { ...kept, ...JSON.parse(body).data };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: kept }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const before = process.env.AP_SANDBOX_WS_PORT;
  process.env.AP_SANDBOX_WS_PORT = String(server.address().port);
  try {
    assert.deepEqual(await run("run_data", { data: { order: "A-17", total: 42, customer: { id: 3 } } }), { saved: { order: "A-17", total: "42", customer: '{"id":3}' } }, "values are kept as text");
    assert.deepEqual((await run("run_data", { data: '{"status": "paid"}' })).saved, { order: "A-17", total: "42", customer: '{"id":3}', status: "paid" }, "a later step adds to it; JSON text is read");
    await assert.rejects(run("run_data", { data: { ["x".repeat(51)]: "y" } }), /over 50 characters/);
    await assert.rejects(run("run_data", { data: { long: "y".repeat(513) } }), /over 512 characters/);
    await assert.rejects(run("run_data", { data: {} }), /Say what to keep/);
    delete process.env.AP_SANDBOX_WS_PORT;
    await assert.rejects(run("run_data", { data: { a: "b" } }), /only works in a run/);
  } finally {
    if (before === undefined) delete process.env.AP_SANDBOX_WS_PORT;
    else process.env.AP_SANDBOX_WS_PORT = before;
    server.close();
  }
});

test("iCalendar: an event's text, in UTC, escaped and folded, with the people asked", () => {
  const now = new Date("2026-11-20T08:00:00Z");
  const { uid, text } = icsOf({ title: "Release review; v2, final", start: "2026-12-01T10:00:00+05:30", end: "2026-12-01T11:30:00+05:30", description: "Line one\nLine two, with a \\ backslash", location: "Room 4", url: "https://example.com/r", organizer: "lead@example.com", attendees: "a@example.com, b@example.com", uid: "fixed-1" }, now);
  assert.equal(uid, "fixed-1");
  const lines = text.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.ok(lines.includes("DTSTART:20261201T043000Z"), "the start in UTC");
  assert.ok(lines.includes("DTEND:20261201T060000Z"));
  assert.ok(lines.includes("DTSTAMP:20261120T080000Z"));
  assert.ok(lines.includes("SUMMARY:Release review\\; v2\\, final"), "semicolons and commas escaped");
  assert.ok(lines.includes("DESCRIPTION:Line one\\nLine two\\, with a \\\\ backslash"), "new lines and backslashes escaped");
  assert.ok(lines.includes("ORGANIZER:mailto:lead@example.com"));
  assert.equal(lines.filter((line) => line.startsWith("ATTENDEE;")).length, 2);
  for (const line of lines) assert.ok(Buffer.byteLength(line) <= 75, `folded: ${line}`);
});

test("iCalendar: a whole day ends the day after, an hour by default, and long lines fold", () => {
  const day = icsOf({ title: "Offsite", start: "2026-12-24", end: "2026-12-26", all_day: true }).text.split("\r\n");
  assert.ok(day.includes("DTSTART;VALUE=DATE:20261224"));
  assert.ok(day.includes("DTEND;VALUE=DATE:20261227"), "the day after the last, as iCalendar has it");
  const hour = icsOf({ title: "Call", start: "2026-12-01T10:00:00Z" }).text;
  assert.match(hour, /DTEND:20261201T110000Z/);
  const long = icsOf({ title: "Planning", start: "2026-12-01T10:00:00Z", description: "é".repeat(100) }).text;
  assert.match(long, /\r\n /, "a long line goes on, folded");
  assert.equal(long.replace(/\r\n /g, "").match(/DESCRIPTION:(é+)/)[1].length, 100, "unfolded, nothing is lost");
});

test("iCalendar: what's wrong is said", () => {
  assert.throws(() => icsOf({ start: "2026-12-01T10:00:00Z" }), /a title/);
  assert.throws(() => icsOf({ title: "x", start: "next week" }), /start as a date/);
  assert.throws(() => icsOf({ title: "x", start: "2026-12-01T10:00:00Z", end: "2026-12-01T09:00:00Z" }), /end after it starts/);
  assert.throws(() => icsOf({ title: "x", start: "2026-12-01T10:00:00Z", attendees: "not-an-email" }), /isn't an email address/);
});
