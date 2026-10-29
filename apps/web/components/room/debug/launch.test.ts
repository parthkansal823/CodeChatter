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

  it("reads Go configurations: a file, a package's folder, the room's top", () => {
    const { configs, skipped } = readLaunch(
      JSON.stringify({
        configurations: [
          { name: "File", type: "go", request: "launch", program: "${file}", args: ["-v"] },
          { name: "Package", type: "go", request: "launch", program: "${fileDirname}", env: { MODE: "dev" } },
          { name: "Top", type: "go", request: "launch", program: "${workspaceFolder}" },
          { name: "Binary", type: "go", request: "launch", program: "bin/app.exe" },
        ],
      }),
      { activePath: "cmd/app/main.go" },
    );
    assert.deepEqual(
      configs.map((c) => [c.name, c.language, c.program]),
      [
        ["File", "go", "cmd/app/main.go"],
        ["Package", "go", "cmd/app"],
        ["Top", "go", "."],
      ],
    );
    assert.deepEqual(configs[0]!.args, ["-v"]);
    assert.deepEqual(configs[1]!.env, { MODE: "dev" });
    assert.deepEqual(
      skipped.map((s) => s.name),
      ["Binary"],
    );
  });

  it("reads Java configurations by their file, and says a class name alone isn't enough", () => {
    const { configs, skipped } = readLaunch(
      JSON.stringify({
        configurations: [
          { name: "Current", type: "java", request: "launch", mainClass: "${file}", args: ["a"] },
          { name: "Named", type: "java", request: "launch", mainClass: "com.example.Main" },
        ],
      }),
      { activePath: "src/app/Main.java" },
    );
    assert.deepEqual(
      configs.map((c) => [c.name, c.language, c.program, c.args]),
      [["Current", "java", "src/app/Main.java", ["a"]]],
    );
    assert.deepEqual(
      skipped.map((s) => s.name),
      ["Named"],
    );
    assert.match(skipped[0]!.reason, /mainClass to \$\{file\}/);
  });

  it("reads Node configurations: a .js or .ts program", () => {
    const { configs, skipped } = readLaunch(
      JSON.stringify({
        configurations: [
          { name: "Current", type: "node", request: "launch", program: "${file}", stopOnEntry: true },
          { name: "Server", type: "pwa-node", request: "launch", program: "${workspaceFolder}/src/server.ts", args: ["--port", "3000"] },
          { name: "Script", type: "node", request: "launch", runtimeExecutable: "npm", runtimeArgs: ["run", "dev"] },
          { name: "Page", type: "node", request: "launch", program: "index.html" },
        ],
      }),
      { activePath: "lib/app.mjs" },
    );
    assert.deepEqual(
      configs.map((c) => [c.name, c.language, c.program, c.stopOnEntry]),
      [
        ["Current", "javascript", "lib/app.mjs", true],
        ["Server", "javascript", "src/server.ts", false],
      ],
    );
    assert.deepEqual(configs[1]!.args, ["--port", "3000"]);
    assert.deepEqual(
      skipped.map((s) => s.name),
      ["Script", "Page"],
    );
    assert.match(skipped[0]!.reason, /\.js or \.ts file/);
  });

  it("says when the file isn't JSON, and reads the starter file", () => {
    assert.deepEqual(readLaunch("{ nope", context).skipped[0]?.reason, "It isn't valid JSON.");
    const starter = readLaunch(STARTER_LAUNCH, { activePath: "prog.cpp" });
    assert.deepEqual(
      starter.configs.map((c) => [c.name, c.language, c.program]),
      [
        ["C/C++: current file", "cpp", "prog.cpp"],
        ["Go: current package", "go", "."],
      ],
    );
    assert.deepEqual(
      readLaunch(STARTER_LAUNCH, { activePath: "web/app.ts" }).configs.map((c) => [c.name, c.program]),
      [
        ["Node: current file", "web/app.ts"],
        ["Go: current package", "web"],
      ],
    );
    // Python's and Node's, which a .cpp file isn't for.
    assert.deepEqual(
      starter.skipped.map((s) => s.name),
      ["Python: current file", "Node: current file", "Java: current file"],
    );
  });
});
