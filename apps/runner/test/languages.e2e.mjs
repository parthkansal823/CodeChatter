// Every language in the full sandbox image (pnpm sandbox:build:full, SANDBOX_IMAGE=codechatter-sandbox:full):
// a hello world per language runs and prints its answer, compilers leave nothing in the room, and the
// judge works for a compiled language.
//   node --env-file=../../.env test/languages.e2e.mjs      (from apps/runner, with `pnpm dev` running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");
const ONLY = process.env.ONLY?.split(",");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const dir = `lang-${Date.now().toString(36)}`;
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

async function ndjson(res, onEvent) {
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      onEvent(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  }
}
async function run(path) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(180_000),
  });
  let output = "";
  let exit = null;
  let error = null;
  await ndjson(res, (event) => {
    if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    if (event.type === "exit") exit = event.exit;
    if (event.type === "error") error = event.message;
  });
  return { output, exit, error };
}

// file name → [source, what the output must contain]
const PROGRAMS = {
  "hello.go": ['package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("go", 6*7) }\n', "go 42"],
  "hello.rs": ['fn main() { println!("rust {}", 6 * 7); }\n', "rust 42"],
  "hello.rb": ['puts "ruby #{6 * 7}"\n', "ruby 42"],
  "hello.php": ['<?php echo "php ", 6 * 7, "\\n";\n', "php 42"],
  "hello.pl": ['print "perl ", 6 * 7, "\\n";\n', "perl 42"],
  "hello.lua": ['print("lua " .. 6 * 7)\n', "lua 42"],
  "hello.r": ['cat("r", 6 * 7, "\\n")\n', "r 42"],
  "hello.kt": ['fun main() { println("kotlin ${6 * 7}") }\n', "kotlin 42"],
  "hello.cs": ['class P { static void Main() { System.Console.WriteLine("csharp " + 6 * 7); } }\n', "csharp 42"],
  "hello.hs": ['main = putStrLn ("haskell " ++ show (6 * 7))\n', "haskell 42"],
  "hello.ml": ['print_endline ("ocaml " ^ string_of_int (6 * 7));;\n', "ocaml 42"],
  "hello.exs": ['IO.puts("elixir #{6 * 7}")\n', "elixir 42"],
  "hello.rkt": ['#lang racket\n(displayln (format "racket ~a" (* 6 7)))\n', "racket 42"],
  "hello.clj": ['(println "clojure" (* 6 7))\n', "clojure 42"],
  "hello.groovy": ['println "groovy ${6 * 7}"\n', "groovy 42"],
  "hello.f90": ['program hello\n  print "(A,I0)", "fortran ", 6 * 7\nend program hello\n', "fortran 42"],
  "hello.pas": ["program Hello;\nbegin\n  writeln('pascal ', 6 * 7);\nend.\n", "pascal 42"],
  "hello.adb": [`with Ada.Text_IO; use Ada.Text_IO;\nprocedure Hello is\nbegin\n   Put_Line ("ada" & Integer'Image (6 * 7));\nend Hello;\n`, "ada 42"],
  "hello.cob": ['IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\nPROCEDURE DIVISION.\n    DISPLAY "cobol 42".\n    STOP RUN.\n', "cobol 42"],
  "hello.d": ['import std.stdio;\nvoid main() { writeln("d ", 6 * 7); }\n', "d 42"],
  "hello.cr": ['puts "crystal #{6 * 7}"\n', "crystal 42"],
  "hello.pro": ["main :- X is 6 * 7, format('prolog ~w~n', [X]).\n", "prolog 42"],
  "hello.sql": ["SELECT 'sql' AS lang, 6 * 7 AS answer;\n", "42"],
  "hello.asm": ['section .data\nmsg db "asm 42", 10\nlen equ $ - msg\nsection .text\nglobal _start\n_start:\n  mov rax, 1\n  mov rdi, 1\n  mov rsi, msg\n  mov rdx, len\n  syscall\n  mov rax, 60\n  xor rdi, rdi\n  syscall\n', "asm 42"],
};

try {
  for (const [name, [source, expected]] of Object.entries(PROGRAMS)) {
    if (ONLY && !ONLY.some((ext) => name.endsWith(`.${ext}`))) continue;
    createFileAtPath(doc, `${dir}/${name}`, source, null);
    const t0 = Date.now();
    const { output, exit, error } = await run(`${dir}/${name}`);
    record(`runs ${name}`, output.includes(expected) && exit?.code === 0, `${Date.now() - t0}ms ${error ?? ""} ${output.slice(-160)}`);
  }

  // Compilers write to /tmp, never next to the source.
  await new Promise((r) => setTimeout(r, 1500));
  const folder = findByPath(doc, dir);
  const inFolder = flatten(listTree(doc)).filter((n) => n.path.startsWith(`${dir}/`)).map((n) => n.path.slice(dir.length + 1));
  const extra = inFolder.filter((p) => !(p in PROGRAMS));
  record("noBuildFilesInRoom", Boolean(folder) && extra.length === 0, extra.join(", "));

  // The judge, for a compiled language from the full image.
  if (!ONLY || ONLY.includes("rs")) {
    createFileAtPath(doc, `${dir}/sum.rs`, 'use std::io::Read;\nfn main() { let mut s = String::new(); std::io::stdin().read_to_string(&mut s).unwrap(); let t: i64 = s.split_whitespace().map(|x| x.parse::<i64>().unwrap()).sum(); println!("{}", t); }\n', null);
    const res = await fetch(`${RUNNER}/rooms/${ROOM}/judge`, {
      method: "POST",
      headers: { authorization: token(), "content-type": "application/json" },
      body: JSON.stringify({ path: `${dir}/sum.rs`, stateVector: stateVector(), timeLimitMs: 5000, cases: [{ input: "3 4\n", expected: "7" }, { input: "10 -2 5\n", expected: "13" }] }),
      signal: AbortSignal.timeout(180_000),
    });
    let done = null;
    await ndjson(res, (event) => event.type === "done" && (done = event));
    record("judgesRust", done?.passed === 2 && done?.total === 2, JSON.stringify(done));
  }
} finally {
  // The test room stays tidy: this run's folder goes to the trash.
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((r) => setTimeout(r, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
