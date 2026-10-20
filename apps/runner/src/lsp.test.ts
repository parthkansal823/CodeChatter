import { describe, expect, it } from "vitest";

import { forServer, frame, LspFrames } from "./lsp.js";

describe("forServer", () => {
  it("adjusts initialize: the room's one folder, and no folder-change offer", () => {
    const out = JSON.parse(
      forServer(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: "file:///elsewhere", capabilities: { workspace: { workspaceFolders: true, configuration: true } } } })),
    );
    expect(out.params.capabilities.workspace).toEqual({ workspaceFolders: false, configuration: true });
    expect(out.params.workspaceFolders).toEqual([{ uri: "file:///workspace", name: "workspace" }]);
    expect(out.params.rootUri).toBe("file:///workspace");
  });

  it("leaves everything else alone", () => {
    const other = JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { text: '"initialize"' } });
    expect(forServer(other)).toBe(other);
    expect(forServer("not json initialize")).toBe("not json initialize");
  });
});

describe("LspFrames", () => {
  const collect = () => {
    const out: string[] = [];
    return { out, frames: new LspFrames((json) => out.push(json)) };
  };

  it("reads whole messages, however the bytes are split", () => {
    const { out, frames } = collect();
    const bytes = Buffer.concat([frame('{"id":1}'), frame('{"id":2,"text":"héllo"}')]);
    for (let i = 0; i < bytes.length; i += 3) frames.push(bytes.subarray(i, i + 3));
    expect(out).toEqual(['{"id":1}', '{"id":2,"text":"héllo"}']);
  });

  it("counts bytes, not characters", () => {
    const { out, frames } = collect();
    frames.push(frame('{"s":"✓✓"}'));
    expect(out).toEqual(['{"s":"✓✓"}']);
  });

  it("takes other headers and any case", () => {
    const { out, frames } = collect();
    frames.push(Buffer.from('content-length: 2\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}'));
    expect(out).toEqual(["{}"]);
  });

  it("skips something that isn't a frame and goes on", () => {
    const { out, frames } = collect();
    frames.push(Buffer.concat([Buffer.from("a stray line\r\n\r\n"), frame("[]")]));
    expect(out).toEqual(["[]"]);
  });
});
