import { describe, expect, it } from "vitest";

import { forClient, forServer, frame, LspFrames } from "./lsp.js";

describe("forClient", () => {
  it("drops the server's formatting (the room formats with the same tools)", () => {
    const answer = { jsonrpc: "2.0", id: 1, result: { capabilities: { hoverProvider: true, documentFormattingProvider: true, documentRangeFormattingProvider: true, documentOnTypeFormattingProvider: { firstTriggerCharacter: "}" } } } };
    expect(JSON.parse(forClient(JSON.stringify(answer))).result.capabilities).toEqual({ hoverProvider: true });
  });

  it("leaves everything else alone", () => {
    const other = JSON.stringify({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { diagnostics: [] } });
    expect(forClient(other)).toBe(other);
  });
});

describe("forServer", () => {
  it("adjusts initialize: the room's one folder, and no folder-change offer", () => {
    const out = JSON.parse(
      forServer(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: "file:///elsewhere", capabilities: { workspace: { workspaceFolders: true, configuration: true } } } }), "python"),
    );
    expect(out.params.capabilities.workspace).toEqual({ workspaceFolders: false, configuration: true });
    expect(out.params.workspaceFolders).toEqual([{ uri: "file:///workspace", name: "workspace" }]);
    expect(out.params.rootUri).toBe("file:///workspace");
  });

  it("adds the server's own options: clangd's flags for C++", () => {
    const out = JSON.parse(forServer(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { initializationOptions: { keep: 1 } } }), "cpp"));
    expect(out.params.initializationOptions).toEqual({ keep: 1, fallbackFlags: ["-std=c++20"] });
  });

  it("leaves everything else alone", () => {
    const other = JSON.stringify({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { text: '"initialize"' } });
    expect(forServer(other, "python")).toBe(other);
    expect(forServer("not json initialize", "python")).toBe("not json initialize");
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
