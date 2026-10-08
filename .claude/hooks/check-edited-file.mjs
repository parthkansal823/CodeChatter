// PostToolUse (Edit, Write, MultiEdit): fast checks on the file just edited.
//  - apps/web TS/TSX: no hex colour literals (design rule: colours come from
//    the tokens in app/globals.css; canvas code reads them with cssVar()).
//  - package.json / tsconfig*.json: must still parse.
// Never edits anything. Exit 2 reports the problem back to Claude.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const input = JSON.parse(await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data || "{}"));
}));
const file = String(input?.tool_input?.file_path ?? input?.tool_response?.filePath ?? "");
if (!file) process.exit(0);
const normalized = file.replaceAll("\\", "/");

let text;
try {
  text = readFileSync(file, "utf8");
} catch {
  process.exit(0);
}

const problems = [];

if (/\/apps\/web\//.test(normalized) && /\.(tsx?|mts)$/.test(normalized) && !text.includes("eslint-disable no-restricted-syntax")) {
  const HEX = /(["'`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1/g;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may mention hex values
    for (const match of line.matchAll(HEX)) problems.push(`line ${i + 1}: colour literal ${match[0]}. Use a design token (className like text-brand, or cssVar("--token") for canvas/SVG).`);
  });
}

const name = basename(normalized);
if (name === "package.json" || /^tsconfig.*\.json$/.test(name)) {
  // tsconfig allows comments and trailing commas; package.json doesn't.
  const source = name === "package.json" ? text : text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
  try {
    JSON.parse(source);
  } catch (error) {
    problems.push(`${name} no longer parses: ${error.message}`);
  }
}

if (problems.length) {
  process.stderr.write(`Check failed for ${normalized}:\n${problems.slice(0, 10).join("\n")}\n`);
  process.exit(2);
}
process.exit(0);
