import { describe, expect, it } from "vitest";

import { commandFor, JAIL, planFor } from "./plans.js";

describe("run plans", () => {
  it("picks a command per language", () => {
    expect(planFor("main.py")?.display).toBe("python3 main.py");
    expect(planFor("src/server.js")?.display).toBe("node src/server.js");
    expect(planFor("two_sum.cpp")?.script).toContain("g++ -std=c++20");
    expect(planFor("Main.java")?.script).toBe('exec java "$1"');
    expect(planFor("README.md")).toBeNull();
  });

  it("passes the path as an argument, never inside the shell text", () => {
    const path = "weird; rm -rf ~ $(whoami).py";
    const plan = planFor(path)!;
    const cmd = commandFor(plan, path, "abc123");
    expect(cmd.slice(0, 3)).toEqual([JAIL, "sh", "-c"]);
    expect(cmd[3]).not.toContain(path);
    expect(cmd.at(-1)).toBe(path);
    expect(cmd[3]).toContain("/tmp/cc-run-abc123.pid");
  });
});
