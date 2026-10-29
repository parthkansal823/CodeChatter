import { describe, expect, it } from "vitest";

import { devScript } from "./dev-server.js";
import { WARM_MOUNT, warmArchive, warmFolder, WarmIndex, warmKey } from "./warm-cache.js";

const npm = { install: "npm install", installed: "node_modules/.bin/vite", dev: "npm run dev", port: 5173 };
const manifests = (json: string) => new Map([["package.json", json]]);

describe("warm cache", () => {
  it("names an install by its command and its dependency files' exact text", () => {
    const key = warmKey("npm install", manifests('{"a":1}'));
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(warmKey("npm install", manifests('{"a":1}'))).toBe(key);
    expect(warmKey("npm install", manifests('{"a":2}'))).not.toBe(key);
    expect(warmKey("npm ci", manifests('{"a":1}'))).not.toBe(key);
    expect(warmKey("npm install", new Map([...manifests('{"a":1}'), ["package-lock.json", "{}"]]))).not.toBe(key);
    // Other files don't change it.
    expect(warmKey("npm install", new Map([...manifests('{"a":1}'), ["README.md", "hi"]]))).toBe(key);
  });

  it("keeps node_modules, .venv and Composer's vendor, and nothing else", () => {
    expect(warmFolder(npm)).toBe("node_modules");
    expect(warmFolder({ ...npm, installed: ".venv/bin/flask" })).toBe(".venv");
    expect(warmFolder({ ...npm, installed: "vendor/autoload.php" })).toBe("vendor");
    expect(warmFolder({ ...npm, installed: "target/classes" })).toBeNull();
    expect(warmArchive({ dev: "x" }, manifests("{}"))).toBeNull();
    expect(warmArchive(npm, manifests("{}"))).toMatch(new RegExp(`^${WARM_MOUNT}/[0-9a-f]{32}\\.tar$`));
  });

  it("unpacks a warmed install before installing, and installs only if that didn't do it", () => {
    const archive = `${WARM_MOUNT}/abc.tar`;
    const script = devScript(npm, archive);
    const unpack = script.indexOf(`tar -xf '${archive}' -C /workspace`);
    const install = script.indexOf("  npm install ||");
    expect(unpack).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(unpack);
    expect(script).toContain(`if [ ! -e 'node_modules/.bin/vite' ] && [ -f '${archive}' ]; then`);
    expect(script).toContain("|| rm -rf 'node_modules'");
    expect(devScript(npm)).not.toContain("tar -xf");
  });

  it("knows the volume's archives without a sandbox, listing once a minute at most", async () => {
    let lists = 0;
    let now = 0;
    const index = new WarmIndex(
      async () => {
        lists += 1;
        return ["abc.tar"];
      },
      60_000,
      () => now,
    );
    const [first, second] = await Promise.all([index.has(`${WARM_MOUNT}/abc.tar`), index.has(`${WARM_MOUNT}/def.tar`)]);
    expect([first, second, lists]).toEqual([true, false, 1]);
    now = 59_000;
    await index.has(`${WARM_MOUNT}/abc.tar`);
    expect(lists).toBe(1);
    now = 61_000;
    await index.has(`${WARM_MOUNT}/abc.tar`);
    expect(lists).toBe(2);
  });

  it("can't tell without a volume, or when listing fails", async () => {
    expect(await new WarmIndex(null).has(`${WARM_MOUNT}/abc.tar`)).toBeNull();
    let fail = true;
    const index = new WarmIndex(async () => {
      if (fail) throw new Error("no docker");
      return ["abc.tar"];
    });
    expect(await index.has(`${WARM_MOUNT}/abc.tar`)).toBeNull();
    fail = false;
    expect(await index.has(`${WARM_MOUNT}/abc.tar`)).toBe(true);
  });
});
