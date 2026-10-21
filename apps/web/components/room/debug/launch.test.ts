// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readLaunch, STARTER_LAUNCH } from "./launch";

const context = { activePath: "app/main.py" };

describe("readLaunch", () => {
  it("reads Python configurations by program or module, with args, folder and environment filled in", () => {
    const { configs, skipped } = readLaunch(
      `{
        // As VS Code writes it.
        "version": "0.2.0",
        "configurations": [
          { "name": "Current file", "type": "debugpy", "request": "launch", "program": "\${file}", "args": ["--size", "\${fileBasenameNoExtension}"], "cwd": "\${fileDirname}", "env": { "MODE": "dev", "bad name": "x" }, "stopOnEntry": true },
          { "name": "Module", "type": "python", "request": "launch", "module": "app.cli", "args": "serve --port 8000", "justMyCode": false },
        ],
      }`,
      context,
    );
    assert.deepEqual(skipped, []);
    assert.deepEqual(configs, [
      {
        name: "Current file",
        language: "python",
        program: "app/main.py",
        module: null,
        args: ["--size", "main"],
        cwd: "app",
        env: { MODE: "dev" },
        stopOnEntry: true,
        justMyCode: true,
      },
      {
        name: "Module",
        language: "python",
        program: null,
        module: "app.cli",
        args: ["serve", "--port", "8000"],
        cwd: null,
        env: {},
        stopOnEntry: false,
        justMyCode: false,
      },
    ]);
  });

  it("takes C and C++ by their source file, and says why it skips the rest", () => {
    const { configs, skipped } = readLaunch(
      JSON.stringify({
        configurations: [
          {
            name: "C",
            type: "cppdbg",
            request: "launch",
            program: "${workspaceFolder}/src/prog.c",
            stopAtEntry: true,
          },
          { name: "C++", type: "gdb", request: "launch", program: "src/a.cpp" },
          { name: "Binary", type: "cppdbg", request: "launch", program: "${workspaceFolder}/a.out" },
          { name: "Attach", type: "debugpy", request: "attach" },
          { name: "Node", type: "node", request: "launch", program: "${file}" },
          { name: "Outside", type: "debugpy", request: "launch", program: "../../etc/passwd" },
        ],
      }),
      context,
    );
    assert.deepEqual(
      configs.map((c) => [c.name, c.language, c.program, c.stopOnEntry]),
      [
        ["C", "c", "src/prog.c", true],
        ["C++", "cpp", "src/a.cpp", false],
      ],
    );
    assert.deepEqual(
      skipped.map((s) => s.name),
      ["Binary", "Attach", "Node", "Outside"],
    );
    assert.match(skipped[0]!.reason, /set program to the .c or .cpp file/);
  });

  it("says when the file isn't JSON, and reads the starter file", () => {
    assert.deepEqual(readLaunch("{ nope", context).skipped[0]?.reason, "It isn't valid JSON.");
    const starter = readLaunch(STARTER_LAUNCH, { activePath: "prog.cpp" });
    assert.deepEqual(
      starter.configs.map((c) => [c.name, c.language, c.program]),
      [["C/C++: current file", "cpp", "prog.cpp"]],
    );
    assert.equal(starter.skipped.length, 1);
  });
});
