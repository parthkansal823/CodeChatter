import assert from "node:assert/strict";
import { test } from "node:test";

import { isPaperName, isTexName, rootTexOf } from "./model";

const ROOT = "\\documentclass{article}\n\\begin{document}\n\\end{document}\n";
const CHAPTER = "\\section{One}\nSome words.\n";

test("a file with a documentclass is its own paper", () => {
  assert.equal(rootTexOf([{ path: "a.tex", text: ROOT }, { path: "b.tex", text: ROOT }], "b.tex"), "b.tex");
});

test("a chapter is built through the paper nearest it", () => {
  const files = [
    { path: "paper/main.tex", text: ROOT },
    { path: "paper/chapters/one.tex", text: CHAPTER },
    { path: "other/main.tex", text: ROOT },
  ];
  assert.equal(rootTexOf(files, "paper/chapters/one.tex"), "paper/main.tex");
});

test("a comment saying which file to build wins, as in other editors", () => {
  const files = [
    { path: "main.tex", text: ROOT },
    { path: "thesis/thesis.tex", text: ROOT },
    { path: "thesis/ch/one.tex", text: `% !TEX root = ../thesis.tex\n${CHAPTER}` },
    { path: "thesis/ch/two.tex", text: `%!TEX root=../../main.tex\n${ROOT}` },
  ];
  assert.equal(rootTexOf(files, "thesis/ch/one.tex"), "thesis/thesis.tex");
  assert.equal(rootTexOf(files, "thesis/ch/two.tex"), "main.tex");
});

test("a comment pointing nowhere, or out of the room, is ignored", () => {
  const files = [{ path: "main.tex", text: ROOT }, { path: "a.tex", text: `% !TEX root = ../../etc/passwd.tex\n${CHAPTER}` }, { path: "b.tex", text: `% !TEX root = gone.tex\n${CHAPTER}` }];
  assert.equal(rootTexOf(files, "a.tex"), "main.tex");
  assert.equal(rootTexOf(files, "b.tex"), "main.tex");
});

test("a commented-out documentclass doesn't count", () => {
  assert.equal(rootTexOf([{ path: "a.tex", text: "% \\documentclass{article}\n" }], "a.tex"), null);
});

test("a .bib file goes with the paper beside it", () => {
  const files = [{ path: "x/main.tex", text: ROOT }, { path: "paper/p.tex", text: ROOT }, { path: "paper/refs.bib", text: "@book{a,}" }];
  assert.equal(rootTexOf(files, "paper/refs.bib"), "paper/p.tex");
});

test("with nothing open it prefers main.tex, then the shortest path", () => {
  assert.equal(rootTexOf([{ path: "aa/b.tex", text: ROOT }, { path: "c/main.tex", text: ROOT }, { path: "d.tex", text: ROOT }], null), "c/main.tex");
  assert.equal(rootTexOf([{ path: "a/b.tex", text: ROOT }, { path: "c/main.tex", text: ROOT }], "z.md"), "c/main.tex");
  assert.equal(rootTexOf([{ path: "z/long-name.tex", text: ROOT }, { path: "a/b.tex", text: ROOT }], null), "a/b.tex");
});

test("a room without a paper has none", () => {
  assert.equal(rootTexOf([], null), null);
  assert.equal(rootTexOf([{ path: "a.md", text: ROOT }, { path: "ch.tex", text: CHAPTER }], "ch.tex"), null);
});

test("what counts as part of a paper", () => {
  assert.equal(isTexName("a/B.TEX"), true);
  assert.equal(isTexName("a.bib"), false);
  assert.equal(isPaperName("a.bib"), true);
  assert.equal(isPaperName("a.tex"), true);
  assert.equal(isPaperName("a.texture"), false);
});
