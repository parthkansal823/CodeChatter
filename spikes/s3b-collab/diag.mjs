// Where do updates go missing: client→server, or server↔server via Valkey?
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const DOC = `room:DIAG${Date.now().toString(36)}:files`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] ?? "cross"; // "cross" = A on a, B on b; "same" = both on a

function connect(url, doc = new Y.Doc()) {
  const provider = new HocuspocusProvider({ url, name: DOC, document: doc, token: "editor" });
  return { provider, doc, synced: new Promise((r) => provider.on("synced", r)) };
}
const sv = (doc) => Object.fromEntries(Y.decodeStateVector(Y.encodeStateVector(doc)));
const lacks = (have, of) => Object.entries(sv(of)).filter(([c, clock]) => (sv(have)[c] ?? 0) < clock).map(([c, clock]) => `${c}:${sv(have)[c] ?? 0}/${clock}`);

const A = connect("ws://127.0.0.1:8201");
const B = connect(mode === "same" ? "ws://127.0.0.1:8201" : "ws://127.0.0.1:8202");
await Promise.all([A.synced, B.synced]);
console.log("clientIDs A", A.doc.clientID, "B", B.doc.clientID, "mode", mode);

let i = 0;
const edit = async (doc, tag, n) => { for (let k = 0; k < n; k++) { doc.getText("t").insert(0, `${tag}${i++}.`); if (k % 5 === 0) await sleep(1); } };
await Promise.all([edit(A.doc, "a", 300), edit(B.doc, "b", 300)]);
await sleep(4000);

// Fresh observers read what each *server replica* holds.
const RA = connect("ws://127.0.0.1:8201");
const RB = connect("ws://127.0.0.1:8202");
await Promise.all([RA.synced, RB.synced]);
await sleep(500);
const report = { A: A.doc, B: B.doc, "server a": RA.doc, "server b": RB.doc };
for (const [name, doc] of Object.entries(report)) {
  console.log(`${name.padEnd(9)} len=${doc.getText("t").length}  lacks A's: [${lacks(doc, A.doc)}]  lacks B's: [${lacks(doc, B.doc)}]`);
}
for (const x of [A, B, RA, RB]) x.provider.destroy();
process.exit(0);
