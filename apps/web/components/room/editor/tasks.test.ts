// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTask, readTasks, shellQuote, substitute, taskInput } from "./tasks";

const TASKS = `{
  // As VS Code writes it.
  "version": "2.0.0",
  "tasks": [
    { "label": "build", "type": "shell", "command": "make", "args": ["-j4", "all files"], "group": { "kind": "build", "isDefault": true } },
    { "label": "run this file", "type": "process", "command": "python3", "args": ["\${file}"], "options": { "cwd": "\${fileDirname}", "env": { "MODE": "dev mode" } } },
    { "type": "npm", "script": "lint", "path": "web" },
    { "label": "tests", "command": "pytest -q", "group": "test", },
    { "label": "broken" },
  ],
}`;

const files = [
  { path: ".vscode/tasks.json", text: TASKS },
  { path: "web/package.json", text: '{ "scripts": { "dev": "vite", "build": "vite build" } }' },
  { path: "package.json", text: '{ "scripts": { "test": "vitest" } }' },
  { path: "web/node_modules/x/package.json", text: '{ "scripts": { "nope": "x" } }' },
];
const tasks = readTasks(files, { activePath: "src/app.py" });

describe("readTasks", () => {
  it("tasks.json first, in its order; broken entries skipped", () => {
    assert.deepEqual(tasks.slice(0, 4).map((t) => t.label), ["build", "run this file", "npm: lint", "tests"]);
  });
  it("shell tasks: command and quoted args, groups", () => {
    assert.equal(tasks[0]!.command, "make -j4 'all files'");
    assert.equal(tasks[0]!.group, "build");
    assert.equal(tasks[0]!.isDefault, true);
    assert.equal(tasks[3]!.group, "test");
  });
  it("process tasks: variables, folder and environment", () => {
    assert.equal(tasks[1]!.command, "env MODE='dev mode' python3 /workspace/src/app.py");
    assert.equal(tasks[1]!.cwd, "src");
  });
  it("npm tasks from tasks.json and from package.json scripts, outside node_modules", () => {
    assert.deepEqual([tasks[2]!.command, tasks[2]!.cwd], ["npm run lint", "web"]);
    assert.deepEqual(tasks.slice(4).map((t) => t.label), ["npm: test", "npm: dev (web)", "npm: build (web)"]);
  });
});

describe("helpers", () => {
  it("quotes only when needed", () => {
    assert.equal(shellQuote("a.py"), "a.py");
    assert.equal(shellQuote("it's here"), `'it'\\''s here'`);
  });
  it("substitutes what it knows and leaves the rest", () => {
    assert.equal(substitute("${fileBasenameNoExtension}-${unknown}", { activePath: "a/b/main.test.ts" }), "main.test-${unknown}");
    assert.equal(substitute("${file}", { activePath: null }), "${file}");
  });
  it("the default build task, else the only one, else ask", () => {
    assert.equal(buildTask(tasks)?.label, "build");
    assert.equal(buildTask(tasks.filter((t) => t.label !== "build"))?.label, "npm: build (web)");
    assert.equal(buildTask([...tasks.slice(1), { ...tasks[0]!, isDefault: false }]), null);
  });
  it("what the Task terminal is sent", () => {
    assert.equal(taskInput(tasks[3]!), "clear && cd /workspace && pytest -q\r");
    assert.equal(taskInput(tasks[2]!), "clear && cd /workspace/web && npm run lint\r");
  });
});
