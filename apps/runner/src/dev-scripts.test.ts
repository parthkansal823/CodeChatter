import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEV_SCRIPTS, devScriptMounts } from "./dev-scripts.js";

describe("devScriptMounts", () => {
  it("mounts each of the repo's scripts, read-only, over the image's", () => {
    const mounts = devScriptMounts({ NODE_ENV: "development", SANDBOX_DEV_SCRIPTS: "../../sandbox/image" }, () => true);
    expect(mounts).toHaveLength(DEV_SCRIPTS.length);
    expect(mounts[0]).toEqual({ Type: "bind", Source: join(resolve("../../sandbox/image"), "automation/host.mjs"), Target: "/usr/local/lib/codechatter/automation/host.mjs", ReadOnly: true });
    expect(mounts.at(-1)?.Target).toBe("/usr/local/lib/codechatter/automation.py");
  });

  it("leaves out a script the repo doesn't have", () => {
    const mounts = devScriptMounts({ NODE_ENV: "development", SANDBOX_DEV_SCRIPTS: "/repo/sandbox/image" }, (path) => !path.endsWith("runs.mjs"));
    expect(mounts.map((mount) => mount.Target)).not.toContain("/usr/local/lib/codechatter/automation/runs.mjs");
    expect(mounts).toHaveLength(DEV_SCRIPTS.length - 1);
  });

  it("mounts nothing in production, or turned off", () => {
    expect(devScriptMounts({ NODE_ENV: "production", SANDBOX_DEV_SCRIPTS: "../../sandbox/image" }, () => true)).toEqual([]);
    expect(devScriptMounts({ NODE_ENV: "development", SANDBOX_DEV_SCRIPTS: "off" }, () => true)).toEqual([]);
  });
});
