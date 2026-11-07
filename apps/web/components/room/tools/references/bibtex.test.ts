import assert from "node:assert/strict";
import { test } from "node:test";

import { entryToAdd, matchesSearch, parseBibtex, placeOf, plainBibText, shortAuthors } from "./bibtex";

const BOOK = `@book{knuth1984,
  title = {The {TeX}book},
  author = {Knuth, Donald E.},
  year = 1984,
  publisher = "Addison-Wesley",
}`;

test("it reads an entry's key, type, fields and where it starts", () => {
  const [entry] = parseBibtex(`% a comment\n\n${BOOK}`);
  assert.equal(entry!.key, "knuth1984");
  assert.equal(entry!.type, "book");
  assert.equal(entry!.line, 3);
  assert.equal(entry!.fields.title, "The TeXbook");
  assert.equal(entry!.fields.year, "1984");
  assert.equal(entry!.fields.publisher, "Addison-Wesley");
});

test("braces inside braces, quotes and parentheses", () => {
  const [a, b] = parseBibtex(`@article{a, title = {One {Two {Three}} Four}, note="say {"}hi{"}" }
@misc(b, title = {In parens})`);
  assert.equal(a!.fields.title, "One Two Three Four");
  assert.equal(a!.fields.note, 'say "hi"');
  assert.equal(b!.key, "b");
  assert.equal(b!.fields.title, "In parens");
});

test("@string names and # joins", () => {
  const [entry] = parseBibtex(`@string{nat = "Nature"}\n@article{a, journal = nat, note = "Vol. " # 5 # {!}}`);
  assert.equal(entry!.fields.journal, "Nature");
  assert.equal(entry!.fields.note, "Vol. 5!");
});

test("comments and preambles aren't entries", () => {
  assert.deepEqual(parseBibtex(`@comment{not, an = {entry}}\n@preamble{"\\\\newcommand{\\\\x}{y}"}`), []);
});

test("it never throws on a half-typed file, and keeps what it can read", () => {
  for (const text of ["@", "@book", "@book{", "@book{a", "@book{a,", "@book{a, title", "@book{a, title =", "@book{a, title = {unfinished", '@book{a, title = "unfinished', "@{}", "no entries here", "@book{a, title={x}\n@book{b, title={y}}"]) {
    assert.doesNotThrow(() => parseBibtex(text), text);
  }
  assert.equal(parseBibtex("@book{a, title = {unfinished")[0]!.fields.title, "unfinished");
  assert.deepEqual(parseBibtex("@book{a, title={x}\n@book{b, title={y}}").map((entry) => entry.key), ["a", "b"], "a missing brace doesn't lose the next entry");
  assert.deepEqual(parseBibtex("@book{a, oops, title={x}}")[0]!.fields.title, "x", "a typo costs one field");
});

test("a field called __proto__ changes nothing", () => {
  const [entry] = parseBibtex("@book{a, __proto__ = {polluted}, constructor = {x}}");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(entry!.fields.__proto__, "polluted");
  assert.equal(Object.getPrototypeOf(entry!.fields), null);
});

test("huge files stay bounded", () => {
  const many = "@misc{a, title={x}}\n".repeat(20_000);
  const started = Date.now();
  assert.equal(parseBibtex(many).length, 5000);
  assert.ok(Date.now() - started < 5000, "took too long");
  assert.ok(parseBibtex(`@book{a, title={${"x".repeat(3 * 1024 * 1024)}`)[0]!.fields.title!.length <= 2 * 1024 * 1024);
});

test("titles read as they would in print", () => {
  assert.equal(plainBibText("The {TeX}book \\& more, pp. 1--5 --- 100\\%"), "The TeXbook & more, pp. 1–5 — 100%");
  assert.equal(plainBibText("Erd{\\H o}s and G\\\"odel, Caf\\'{e}"), "Erd\\H os and Godel, Cafe");
});

test("authors are named as people cite them", () => {
  assert.equal(shortAuthors({ fields: { author: "Knuth, Donald E." } }), "Knuth");
  assert.equal(shortAuthors({ fields: { author: "Donald E. Knuth" } }), "Knuth");
  assert.equal(shortAuthors({ fields: { author: "Vaswani, Ashish and Shazeer, Noam" } }), "Vaswani and Shazeer");
  assert.equal(shortAuthors({ fields: { author: "LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey" } }), "LeCun et al.");
  assert.equal(shortAuthors({ fields: { editor: "Someone, An" } }), "Someone");
  assert.equal(shortAuthors({ fields: {} }), "");
});

test("where it was published", () => {
  assert.equal(placeOf({ fields: { journal: "Nature", publisher: "x" } }), "Nature");
  assert.equal(placeOf({ fields: { booktitle: "NeurIPS" } }), "NeurIPS");
  assert.equal(placeOf({ fields: {} }), "");
});

test("search looks at every word, across the entry", () => {
  const [entry] = parseBibtex(BOOK);
  assert.equal(matchesSearch(entry!, ""), true);
  assert.equal(matchesSearch(entry!, "knuth 1984"), true);
  assert.equal(matchesSearch(entry!, "TEXBOOK addison"), true);
  assert.equal(matchesSearch(entry!, "knuth 1999"), false);
});

const HAVE = parseBibtex(`@article{LeCun_2015, title={Deep learning}, doi={10.1038/nature14539}}`);

test("a new reference gets a key nothing else has", () => {
  const added = entryToAdd("@article{LeCun_2015, title={Another}, doi={10.1/other}}", HAVE);
  assert.ok("text" in added);
  assert.equal(added.key, "LeCun_2015_2");
  assert.match(added.text, /^@article\{LeCun_2015_2,/);
  const fresh = entryToAdd("@article{New, title={New}}", HAVE);
  assert.ok("text" in fresh);
  assert.equal(fresh.key, "New");
});

test("one already there, by its DOI, isn't added again", () => {
  assert.deepEqual(entryToAdd("@article{Other_Key, doi={10.1038/NATURE14539}}", HAVE), { duplicateOf: "LeCun_2015" });
});

test("a DOI written as a link is the same DOI", () => {
  assert.deepEqual(entryToAdd("@misc{Other, doi={https://doi.org/10.1038/nature14539}}", HAVE), { duplicateOf: "LeCun_2015" });
  assert.deepEqual(entryToAdd("@misc{Other, doi={http://dx.doi.org/10.1038/nature14539}}", HAVE), { duplicateOf: "LeCun_2015" });
});

test("what isn't a reference is refused", () => {
  assert.ok("error" in entryToAdd("<html>", HAVE));
});
