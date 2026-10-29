import { describe, expect, it } from "vitest";

import { asText, isIgnored } from "./rules.js";

describe("isIgnored", () => {
  it("keeps source files", () => {
    for (const path of ["main.py", "src/server.js", "notes/build-plan.md", "docs/distance.txt"]) {
      expect(isIgnored(path), path).toBe(false);
    }
  });

  it("skips what framework dev servers generate", () => {
    for (const path of [".svelte-kit/generated/client/app.js", ".nuxt/nuxt.d.ts", ".output/server/index.mjs", ".angular/cache/x", ".astro/types.d.ts", "apps/web/.next/trace"]) {
      expect(isIgnored(path), path).toBe(true);
    }
    expect(isIgnored("src/astro-notes.md")).toBe(false);
  });

  it("skips dependencies, caches, build output and our temp files", () => {
    for (const path of ["node_modules/x/index.js", "app/__pycache__/m.cpython-313.pyc", ".venv/bin/python", ".git/HEAD", "target/classes/A.class", "vendor/laravel/framework/composer.json", "src/.cc-tmp-12-3", "lib/a.o"]) {
      expect(isIgnored(path), path).toBe(true);
    }
  });
});

describe("asText", () => {
  it("decodes UTF-8 text", () => {
    expect(asText(new TextEncoder().encode("नमस्ते, print('hi')\n"))).toBe("नमस्ते, print('hi')\n");
  });

  it("refuses binary data", () => {
    expect(asText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]))).toBeNull();
    expect(asText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});
