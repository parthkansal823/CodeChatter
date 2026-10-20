// node:test, run with tsx (see CLAUDE.md "Unit tests").
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { outlineFor, siblingsOf, symbolsAt, type SymbolItem } from "./outline";

const brief = (symbols: SymbolItem[] | null) => symbols?.map((s) => `${"  ".repeat(s.depth)}${s.kind} ${s.name}`);
const at = (text: string, needle: string) => text.indexOf(needle);

describe("python", () => {
  const code = [
    "import os",
    "",
    "class Greeter:",
    '    """Says hello.',
    "",
    "def not_a_function_in_a_docstring():",
    '    """',
    "",
    "    def __init__(self, name):",
    "        self.name = name",
    "",
    "    async def hello(self):",
    "        def inner():",
    "            return 1",
    "        return f'hi {self.name}'",
    "",
    "def main():",
    "    # a comment at column 0 does not close main",
    "# like this",
    "    print(Greeter('x'))",
    "",
    "x = main()",
  ].join("\n");
  const symbols = outlineFor("python", code)!;

  it("finds classes, methods and nested functions", () => {
    assert.deepEqual(brief(symbols), ["class Greeter", "  method __init__", "  method hello", "    function inner", "function main"]);
  });
  it("blocks end where the indentation does", () => {
    const main = symbols.find((s) => s.name === "main")!;
    assert.equal(code.slice(main.start, main.end).trimEnd().split("\n").at(-1), "    print(Greeter('x'))");
    assert.deepEqual(symbolsAt(symbols, at(code, "return 1")).map((s) => s.name), ["Greeter", "hello", "inner"]);
    assert.deepEqual(symbolsAt(symbols, at(code, "x = main")), []);
  });
  it("siblings share a parent", () => {
    const hello = symbols.find((s) => s.name === "hello")!;
    assert.deepEqual(siblingsOf(symbols, hello).map((s) => s.name), ["__init__", "hello"]);
    assert.deepEqual(siblingsOf(symbols, symbols[0]!).map((s) => s.name), ["Greeter", "main"]);
  });
});

describe("markdown", () => {
  const doc = ["# Title", "intro", "## Setup", "```sh", "# not a heading", "```", "### Details ###", "## Usage", "# Appendix"].join("\n");
  const symbols = outlineFor("markdown", doc)!;
  it("headings nest by level, and code fences are skipped", () => {
    assert.deepEqual(brief(symbols), ["h1 Title", "  h2 Setup", "    h3 Details", "  h2 Usage", "h1 Appendix"]);
  });
  it("a section runs to the next heading as high", () => {
    assert.deepEqual(symbolsAt(symbols, at(doc, "# not a heading")).map((s) => s.name), ["Title", "Setup"]);
    assert.deepEqual(symbolsAt(symbols, at(doc, "# Appendix") + 2).map((s) => s.name), ["Appendix"]);
  });
});

describe("go", () => {
  const code = [
    "package main",
    "",
    "type ID int",
    "",
    "type Server struct {",
    '\tname string // "{" in a comment',
    "}",
    "",
    "func (s *Server) Start(port int) error {",
    '\tif s.name == "}" {',
    "\t\treturn nil",
    "\t}",
    "\treturn nil",
    "}",
    "",
    "func main() {",
    "\tvar s Server",
    "\ts.Start(8080)",
    "}",
  ].join("\n");
  const symbols = outlineFor("go", code)!;
  it("types, methods and functions", () => {
    assert.deepEqual(brief(symbols), ["type ID", "struct Server", "method (Server).Start", "function main"]);
  });
  it("bodies end at their brace, ignoring braces in strings and comments", () => {
    const start = symbols.find((s) => s.kind === "method")!;
    assert.equal(code.slice(start.end - 1, start.end), "}");
    assert.ok(code.slice(start.start, start.end).endsWith("\treturn nil\n}"));
    const id = symbols[0]!;
    assert.equal(code.slice(id.start, id.end), "type ID int");
  });
});

describe("rust", () => {
  const code = [
    "pub struct Unit;",
    "#[derive(Debug)]",
    "pub(crate) struct Point { x: i32, y: i32 }",
    "trait Shape {",
    "    fn area(&self) -> f64;",
    "}",
    "impl<'a> Shape for Point {",
    "    pub async fn area(&self) -> f64 {",
    "        let c = '{';",
    "        0.0",
    "    }",
    "}",
    "fn main() {}",
  ].join("\n");
  const symbols = outlineFor("rust", code)!;
  it("items, impls and methods", () => {
    assert.deepEqual(brief(symbols), ["struct Unit", "struct Point", "trait Shape", "  method area", "impl impl Shape for Point", "  method area", "function main"]);
  });
  it("a char literal brace doesn't end the method early", () => {
    const method = symbols.filter((s) => s.name === "area")[1]!;
    assert.ok(code.slice(method.start, method.end).endsWith("0.0\n    }"));
    assert.equal(code.slice(symbols[0]!.start, symbols[0]!.end), "pub struct Unit;");
  });
});

describe("shell", () => {
  const code = ["#!/bin/bash", "greet() {", "  awk '{print $1}' file  # } in a comment", '  echo "${#name}"', "}", "function build {", "  make", "}", "", "greet"].join("\n");
  it("both function forms, with quotes and comments ignored", () => {
    const symbols = outlineFor("shell", code)!;
    assert.deepEqual(brief(symbols), ["function greet", "function build"]);
    assert.ok(code.slice(symbols[0]!.start, symbols[0]!.end).endsWith('"${#name}"\n}'));
  });
});

it("languages without a reader give null", () => {
  assert.equal(outlineFor("java", "class A {}"), null);
});
