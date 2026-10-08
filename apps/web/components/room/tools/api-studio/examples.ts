import type { NewRequest } from "./model";

/** Where the example server goes in the room's files. */
export const EXAMPLE_SERVER_PATH = "api-example/server.mjs";

/** A tiny notes API (node:http only, so it runs in any room's sandbox). */
export const EXAMPLE_SERVER = `// A tiny notes API for trying out API Studio.
// Press Run on this file, then send the requests in the "Sandbox example" folder.
import { createServer } from "node:http";

const notes = [{ id: 1, text: "Try API Studio" }];
let nextId = 2;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const noteId = /^\\/api\\/notes\\/(\\d+)$/.exec(url.pathname)?.[1];

  if (url.pathname === "/") return send(res, 200, { hello: "from this room's sandbox" });
  if (url.pathname === "/api/notes" && req.method === "GET") return send(res, 200, { notes });
  if (url.pathname === "/api/notes" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        const { text } = JSON.parse(raw || "{}");
        if (typeof text !== "string" || !text) return send(res, 400, { error: "text is required" });
        const note = { id: nextId++, text };
        notes.push(note);
        send(res, 201, note);
      } catch {
        send(res, 400, { error: "the body must be JSON" });
      }
    });
    return;
  }
  if (noteId && req.method === "GET") {
    const note = notes.find((n) => n.id === Number(noteId));
    return note ? send(res, 200, note) : send(res, 404, { error: "no such note" });
  }
  send(res, 404, { error: "not found" });
}).listen(3000, () => console.log("Notes API listening on port 3000"));
`;

const json = { "Content-Type": "application/json" };

/** Requests that call the example server through the sandbox target (http://localhost:<port>). */
export const EXAMPLE_REQUESTS: NewRequest[] = [
  {
    name: "Hello",
    url: "http://localhost:3000/",
    assertions: [
      { enabled: true, kind: "status", target: "", op: "equals", expected: "200" },
      { enabled: true, kind: "json", target: "$.hello", op: "exists", expected: "" },
    ],
  },
  {
    name: "List notes",
    url: "http://localhost:3000/api/notes",
    assertions: [
      { enabled: true, kind: "status", target: "", op: "equals", expected: "200" },
      { enabled: true, kind: "json", target: "$.notes.length", op: "above", expected: "0" },
      { enabled: true, kind: "time", target: "", op: "below", expected: "1000" },
    ],
  },
  {
    name: "Add a note",
    method: "POST",
    url: "http://localhost:3000/api/notes",
    headers: Object.entries(json).map(([key, value]) => ({ key, value, enabled: true })),
    body: { mode: "json", text: '{\n  "text": "Written from API Studio"\n}' },
    assertions: [
      { enabled: true, kind: "status", target: "", op: "equals", expected: "201" },
      { enabled: true, kind: "json", target: "$.text", op: "equals", expected: "Written from API Studio" },
    ],
    extracts: [{ enabled: true, variable: "noteId", source: "json", path: "$.id" }],
  },
  {
    name: "Get the note you added",
    url: "http://localhost:3000/api/notes/{{noteId}}",
    assertions: [{ enabled: true, kind: "status", target: "", op: "equals", expected: "200" }],
  },
];
