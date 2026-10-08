import { describe, expect, it } from "vitest";

import { runnableLanguage, WorkspacePath } from "./run.js";

describe("runnableLanguage", () => {
  it("knows the sandbox languages by extension, case-insensitively", () => {
    expect(runnableLanguage("main.py")?.label).toBe("Python");
    expect(runnableLanguage("src/server.js")?.label).toBe("Node.js");
    expect(runnableLanguage("a/b/Solution.JAVA")?.label).toBe("Java");
    expect(runnableLanguage("two_sum.cpp")?.language).toBe("cpp");
  });

  it("returns null for files it can't run", () => {
    for (const path of ["README.md", "index.html", "Makefile", ".env", "data.json", "go.mod"]) {
      expect(runnableLanguage(path)).toBeNull();
    }
  });
});

describe("WorkspacePath", () => {
  it("accepts workspace-relative paths", () => {
    expect(WorkspacePath.safeParse("src/app/main.py").success).toBe(true);
  });

  it("rejects absolute paths and traversal", () => {
    for (const path of ["/etc/passwd", "../secret", "a/../../b", "a//b", "./main.py", ""]) {
      expect(WorkspacePath.safeParse(path).success, path).toBe(false);
    }
  });
});
