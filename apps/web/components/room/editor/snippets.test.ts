// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SNIPPETS, snippetPreview, snippetsFor } from "./snippets";

describe("snippets", () => {
  it("every language's prefixes are unique", () => {
    for (const [language, list] of Object.entries(SNIPPETS)) {
      const prefixes = list.map((s) => s.prefix);
      assert.equal(new Set(prefixes).size, prefixes.length, `${language}: ${prefixes.join(", ")}`);
    }
  });
  it("every body has balanced placeholders and nothing left over in its preview", () => {
    for (const list of Object.values(SNIPPETS)) {
      for (const snippet of list) {
        const opens = (snippet.body.match(/\$\{/g) ?? []).length;
        assert.ok(opens <= (snippet.body.match(/\}/g) ?? []).length, snippet.prefix);
        assert.doesNotMatch(snippetPreview(snippet.body), /\$\{|\$\d/, snippet.prefix);
      }
    }
  });
  it("previews fill in the defaults", () => {
    assert.equal(snippetPreview("for ${1:item} in ${2:items}:\n    ${0:pass}"), "for item in items:\n    pass");
    assert.equal(snippetPreview("fn ${1:name}(${2:args}) ${3:-> ${4:()} }{"), "fn name(args) -> () {");
    assert.equal(snippetPreview("console.log($1);$0"), "console.log();");
  });
  it("unknown languages have none", () => {
    assert.deepEqual(snippetsFor("plaintext"), []);
    assert.ok(snippetsFor("typescript").some((s) => s.prefix === "interface"));
  });
});
