import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatJson } from "./json-format";

describe("formatJson", () => {
  it("re-indents compact JSON", () => {
    assert.equal(
      formatJson('{"a":1,"b":[1,2,{"c":null}],"d":{}}', "  "),
      '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    {\n      "c": null\n    }\n  ],\n  "d": {}\n}',
    );
  });

  it("uses tabs when asked and keeps a trailing newline", () => {
    assert.equal(formatJson('{"a":[]}\n', "\t"), '{\n\t"a": []\n}\n');
  });

  it("copies values exactly as written", () => {
    const text = '{"n":1.0,"big":12345678901234567890,"s":"a\\"b, }{ :","e":1e3}';
    const out = formatJson(text, "  ")!;
    for (const piece of ["1.0", "12345678901234567890", '"a\\"b, }{ :"', "1e3"])
      assert.ok(out.includes(piece), piece);
    assert.deepEqual(JSON.parse(out), JSON.parse(text));
  });

  it("handles scalars, nesting and already-formatted input", () => {
    assert.equal(formatJson("  42 ", "  "), "42");
    const pretty = '{\n  "a": [\n    1\n  ]\n}';
    assert.equal(formatJson(pretty, "  "), pretty);
  });

  it("refuses text that is not valid JSON", () => {
    assert.equal(formatJson('{"a": 1,}', "  "), null);
    assert.equal(formatJson("// comment\n{}", "  "), null);
    assert.equal(formatJson("", "  "), null);
  });
});
