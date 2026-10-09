import { describe, expect, it } from "vitest";

import { devScript } from "./dev-server.js";

describe("devScript", () => {
  it("installs only when what it installs is missing, then runs the dev server, then keeps a shell", () => {
    const script = devScript({ install: "npm install", installed: "node_modules/.bin/vite", dev: "npm run dev", port: 5173 });
    const lines = script.split("\n");
    expect(lines[0]).toBe("cd /workspace || exit 1");
    expect(lines).toContain("if [ ! -e 'node_modules/.bin/vite' ]; then");
    expect(lines).toContain("  npm install || { echo; echo \"Installing failed. If it couldn't reach a package registry, the room's owner can allow package installs (Ports panel).\"; exec bash; }");
    expect(lines.indexOf("npm run dev")).toBeGreaterThan(lines.indexOf("fi"));
    expect(lines.at(-1)).toBe("exec bash");
  });

  it("quotes what it shows, single quotes included", () => {
    const script = devScript({ install: "echo 'hi'", installed: "it's here", dev: "node server.js" });
    expect(script).toContain(`if [ ! -e 'it'\\''s here' ]; then`);
    expect(script).toContain(`printf '\\033[2m$ %s\\033[0m\\n' 'echo '\\''hi'\\'''`);
  });

  it("runs the dev server straight away when there's nothing to install", () => {
    const script = devScript({ dev: "npm run dev" });
    expect(script).not.toContain("if [");
    expect(script.split("\n")).toContain("npm run dev");
  });
});
