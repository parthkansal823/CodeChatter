import type { HttpSendInput } from "./send.js";

/**
 * Code for the current request in a few languages. The input is the request
 * after variables were filled in (secrets can be left as {{names}}), so what
 * you copy does what Send does.
 */

export const SNIPPET_LANGUAGES = [
  { id: "curl", label: "cURL" },
  { id: "fetch", label: "JavaScript fetch" },
  { id: "python", label: "Python requests" },
  { id: "go", label: "Go net/http" },
] as const;
export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number]["id"];

const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
const isJsonType = (input: HttpSendInput) => input.headers.some((h) => h.name.toLowerCase() === "content-type" && /json/i.test(h.value));

function parsedJson(input: HttpSendInput): unknown {
  if (input.body === null || !isJsonType(input)) return undefined;
  try {
    const value: unknown = JSON.parse(input.body);
    return value !== null && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

const indent = (text: string, pad: string) => text.split("\n").map((line, i) => (i === 0 ? line : pad + line)).join("\n");

function curl(input: HttpSendInput): string {
  const parts = [`curl ${input.method === "HEAD" ? "--head " : input.method === "GET" ? "" : `-X ${input.method} `}${shellQuote(input.url)}`];
  for (const h of input.headers) parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`);
  if (input.body !== null && input.body !== "") parts.push(`--data-raw ${shellQuote(input.body)}`);
  return parts.join(" \\\n  ");
}

function fetchCode(input: HttpSendInput): string {
  const lines = [`method: ${JSON.stringify(input.method)},`];
  if (input.headers.length) {
    lines.push("headers: {", ...input.headers.map((h) => `  ${JSON.stringify(h.name)}: ${JSON.stringify(h.value)},`), "},");
  }
  if (input.body !== null && input.body !== "") {
    const json = parsedJson(input);
    lines.push(json === undefined ? `body: ${JSON.stringify(input.body)},` : `body: JSON.stringify(${JSON.stringify(json, null, 2)}),`);
  }
  return [`const response = await fetch(${JSON.stringify(input.url)}, {`, ...lines.map((l) => `  ${indent(l, "  ")}`), "});", "console.log(response.status, await response.text());"].join("\n");
}

function pyLiteral(value: unknown, depth = 0): string {
  const pad = "    ".repeat(depth + 1);
  const end = "    ".repeat(depth);
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => `${pad}${pyLiteral(v, depth + 1)},`).join("\n")}\n${end}]` : "[]";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pyLiteral(v, depth + 1)},`).join("\n")}\n${end}}` : "{}";
}

function python(input: HttpSendInput): string {
  const args = [JSON.stringify(input.url)];
  if (input.headers.length) args.push(`headers={\n${input.headers.map((h) => `        ${JSON.stringify(h.name)}: ${JSON.stringify(h.value)},`).join("\n")}\n    }`);
  if (input.body !== null && input.body !== "") {
    const json = parsedJson(input);
    args.push(json === undefined ? `data=${JSON.stringify(input.body)}` : `json=${pyLiteral(json, 1)}`);
  }
  return ["import requests", "", `response = requests.${input.method.toLowerCase()}(`, ...args.map((a) => `    ${a},`), ")", "print(response.status_code, response.text)"].join("\n");
}

function go(input: HttpSendInput): string {
  const hasBody = input.body !== null && input.body !== "";
  const lines = [
    "package main",
    "",
    "import (",
    '\t"fmt"',
    '\t"io"',
    '\t"net/http"',
    ...(hasBody ? ['\t"strings"'] : []),
    ")",
    "",
    "func main() {",
    ...(hasBody ? [`\tbody := strings.NewReader(${JSON.stringify(input.body)})`] : []),
    `\treq, err := http.NewRequest(${JSON.stringify(input.method)}, ${JSON.stringify(input.url)}, ${hasBody ? "body" : "nil"})`,
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    ...input.headers.map((h) => `\treq.Header.Add(${JSON.stringify(h.name)}, ${JSON.stringify(h.value)})`),
    "",
    "\tres, err := http.DefaultClient.Do(req)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer res.Body.Close()",
    "",
    "\tdata, _ := io.ReadAll(res.Body)",
    "\tfmt.Println(res.Status, string(data))",
    "}",
  ];
  return lines.join("\n");
}

export function generateSnippet(language: SnippetLanguage, input: HttpSendInput): string {
  switch (language) {
    case "curl":
      return curl(input);
    case "fetch":
      return fetchCode(input);
    case "python":
      return python(input);
    case "go":
      return go(input);
  }
}
