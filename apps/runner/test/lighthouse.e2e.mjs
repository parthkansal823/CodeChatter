// Lighthouse in the room's browser, on the runner's side: Google's own, with the image's Chromium, run in E2ETST's sandbox against a server running
// there. A page with problems on purpose (no description, no language, an image without alt text, a heading out of order) gets its scores, its Core Web
// Vitals and what failed, as a phone and as a desktop, and Lighthouse's whole report; a port with nothing on it says so. It stops its server and removes
// its file.
//   node --env-file=../../.env test/lighthouse.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = "E2ETST";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 500)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const post = (path, body, seconds = 60) => fetch(`${RUNNER}/rooms/${ROOM}${path}`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(seconds * 1000) });

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stamp = Date.now().toString(36);
const PORT = 6100 + Math.floor(Math.random() * 800);
const FILE = `lighthouse-${stamp}.js`;
const PAGE = '<!doctype html><html><head><title>Shop</title></head><body><h1>Shop</h1><h3>Skipped a level</h3><img src="/x.png"><a href="/about"></a><p>' + "Words. ".repeat(40) + "</p></body></html>";
createFileAtPath(doc, FILE, `const PAGE = ${JSON.stringify(PAGE)};\nrequire("node:http").createServer((q, s) => { s.setHeader("content-type", q.url === "/x.png" ? "image/png" : "text/html"); s.end(q.url === "/x.png" ? Buffer.alloc(0) : PAGE); }).listen(${PORT}, () => console.log("listening ${PORT}"));\n`, null);
await sleep(1500);

// The server, as a run that stays up until it's stopped.
let output = "";
const started = fetch(`${RUNNER}/rooms/${ROOM}/runs`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ path: FILE, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }) }).then(async (response) => {
  const decoder = new TextDecoder();
  for await (const chunk of response.body) output += decoder.decode(chunk, { stream: true });
});

try {
  for (let i = 0; i < 60 && !output.includes(`listening ${PORT}`); i++) await sleep(1000);
  check("theServerStarts", output.includes(`listening ${PORT}`), output.slice(-300));

  // ---- As a phone, every category ----
  const phone = await post("/lighthouse", { port: PORT, path: "/", device: "mobile" }, 200);
  const report = await phone.json();
  check("lighthouseRuns", phone.status === 200 && report.lighthouseVersion?.startsWith("13.") && report.device === "mobile", { status: phone.status, error: report.error });
  const score = (id) => report.categories?.find((category) => category.id === id);
  check("everyCategoryHasAScore", ["performance", "accessibility", "best-practices", "seo"].every((id) => typeof score(id)?.score === "number" && score(id).score >= 0 && score(id).score <= 100), report.categories?.map((category) => [category.id, category.score]));
  const failing = (id) => (score(id)?.failing ?? []).map((audit) => audit.id);
  check("itFindsTheMissingDescription", failing("seo").includes("meta-description"), failing("seo"));
  check("andTheImageWithoutAlt", failing("accessibility").includes("image-alt"), failing("accessibility"));
  check("andTheMissingLanguage", failing("accessibility").includes("html-has-lang"), failing("accessibility"));
  check("andTheLinkWithoutText", failing("accessibility").includes("link-name"), failing("accessibility"));
  check("eachSaysWhy", score("seo")?.failing.every((audit) => audit.title && audit.description && !audit.description.includes("](")), score("seo")?.failing);
  const metrics = Object.fromEntries((report.metrics ?? []).map((metric) => [metric.id, metric.displayValue]));
  check("theCoreWebVitalsAreMeasured", metrics["first-contentful-paint"] && metrics["largest-contentful-paint"] && metrics["total-blocking-time"] && metrics["cumulative-layout-shift"] !== undefined, metrics);
  check("itsWholeReportComes", typeof report.html === "string" && report.html.includes("<html") && report.html.length > 50_000, report.html?.length);
  check("onThePageAsked", report.url === `http://localhost:${PORT}/`, report.url);

  // ---- As a desktop, one category ----
  const desktop = await post("/lighthouse", { port: PORT, path: "/", device: "desktop", categories: ["seo"] }, 200);
  const seoOnly = await desktop.json();
  check("aDesktopAndOneCategory", desktop.status === 200 && seoOnly.device === "desktop" && seoOnly.categories.length === 1 && seoOnly.categories[0].id === "seo", { status: desktop.status, categories: seoOnly.categories?.map((category) => category.id), error: seoOnly.error });

  // ---- Nothing there ----
  const nothing = await post("/lighthouse", { port: PORT + 1, path: "/", device: "desktop", categories: ["seo"] }, 200);
  const why = await nothing.json();
  check("aPortWithNothingOnItSaysSo", nothing.status === 422 && /couldn't load the page|didn't finish|ERR_CONNECTION_REFUSED|Unable to reliably load/i.test(why.error ?? ""), why);
  const wrong = await post("/lighthouse", { port: PORT, path: "no slash" });
  check("aPathMustBeAPath", wrong.status === 400, wrong.status);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  await post("/runs/stop", {}).catch(() => {});
  await started.catch(() => {});
  const node = findByPath(doc, FILE);
  if (node) trash(doc, node.id);
  await sleep(800);
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
