/** Exercise API imports with two browser users, a read-only shared-document observer, and disposable sandbox fixtures. */
// From apps/web with the shared dev stack running: node test/api-studio-import.e2e.mjs
import { createRequire } from "node:module";

import { BASE, ROOM, check, finish, launch } from "./browser.mjs";

const requireWeb = createRequire(new URL("../package.json", import.meta.url));
const { HocuspocusProvider, HocuspocusProviderWebsocket } = requireWeb("@hocuspocus/provider");
const Y = requireWeb("yjs");
const WebSocket = createRequire(new URL("../../collab/package.json", import.meta.url))("ws");
const stamp = Date.now().toString(36);
const apiName = `Import API ${stamp}`;
const postmanName = `Import Postman ${stamp}`;
const requestName = `Imported echo ${stamp}`;
const serverFile = `api_import_${stamp}.js`;
const port = 4000 + Math.floor(Math.random() * 900);
// These are invented canaries, never credentials. Never print them or raw exceptions.
const discarded = `discarded-fixture-value-${stamp}`;
const script = `throw new Error("discarded-fixture-script-${stamp}")`;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, ms = 15_000) {
  const end = Date.now() + ms;
  do {
    if (await probe()) return;
    await pause(50);
  } while (Date.now() < end);
  throw new Error("A fixture condition did not become true");
}

/** Observe the actual room data without writing a Yjs map or relying on React internals. */
async function observe(context) {
  const cookie = (await context.cookies(BASE)).map((item) => `${item.name}=${item.value}`).join("; ");
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: new URL(BASE).origin } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${BASE.replace(/^http/, "ws")}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 3 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${ROOM}:api`, document: doc, token: "session" });
  const close = () => { provider.destroy(); socket.destroy(); doc.destroy(); };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Observer did not sync")), 20_000);
      provider.on("synced", () => { clearTimeout(timer); resolve(); });
      provider.on("authenticationFailed", () => { clearTimeout(timer); reject(new Error("Observer was refused")); });
      provider.attach();
    });
  } catch (error) { close(); throw error; }
  const nodes = doc.getMap("nodes");
  const environments = doc.getMap("environments");
  return {
    doc, close,
    counts: () => [nodes.size, environments.size],
    fixture() {
      const all = [...nodes.values()].map((node) => node.toJSON());
      const roots = all.filter((node) => node.kind === "folder" && node.parentId === null && [apiName, postmanName].includes(node.name));
      const ids = new Set(roots.map((node) => node.id));
      for (let pass = 0; pass < 202; pass++) {
        const before = ids.size;
        for (const node of all) if (ids.has(node.parentId)) ids.add(node.id);
        if (before === ids.size) break;
      }
      return {
        roots,
        nodes: all.filter((node) => ids.has(node.id)),
        environments: [...environments.values()].map((env) => env.toJSON()).filter((env) => [apiName, postmanName].includes(env.name)),
      };
    },
  };
}

const openApi = JSON.stringify({
  openapi: "3.1.0", info: { title: apiName, version: "1.0" },
  servers: [{ url: `http://localhost:${port}` }],
  components: {
    securitySchemes: { Bearer: { type: "http", scheme: "bearer" } },
    schemas: { Remote: { $ref: "https://never-fetch.invalid/import-schema.json" } },
  },
  paths: {
    "/import-probe/{id}": { post: {
      summary: requestName, tags: [`Echo ${stamp}`], security: [], preScript: script, testScript: script,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string", example: stamp } },
        { name: "marker", in: "query", required: true, schema: { type: "string", example: stamp } },
        { name: "optional", in: "query", required: false, schema: { type: "string", example: "off" } },
      ],
      requestBody: { content: { "application/json": { example: { message: stamp } } } }, responses: { 200: { description: "Echo" } },
    } },
    "/protected": { get: {
      summary: `Protected ${stamp}`, tags: [`Echo ${stamp}`], security: [{ Bearer: [] }],
      parameters: [{ name: "X-API-Key", in: "header", required: true, schema: { type: "string", example: discarded } }],
      responses: { 200: { description: "Protected" } },
    } },
  },
});
const postman = JSON.stringify({
  info: { name: postmanName, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "apiToken", value: discarded }, { key: "baseUrl", value: `http://localhost:${port}` }],
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiToken}}", type: "string" }] },
  item: [{ name: `Nested ${stamp}`, item: [{
    name: `Scriptless ${stamp}`, event: [{ listen: "prerequest", script: { exec: [script] } }, { listen: "test", script: { exec: [script] } }],
    request: { method: "GET", url: "{{baseUrl}}/not-sent" },
  }] }],
});

if (ROOM !== "E2ETST") throw new Error("This suite only writes to the seeded E2ETST room");
const { browser, errors, signIn } = await launch();
let a, b, observer;
let stage = "sign in";
let runIssued = false;
let sends = 0;
let remoteFetches = 0;

async function openStudio(page) {
  if (!await page.getByRole("button", { name: "Close API Studio", exact: true }).count()) {
    await page.getByRole("button", { name: "API", exact: true }).click();
  }
  await page.getByRole("tree", { name: "Requests", exact: true }).waitFor();
}

async function preview(text, { file = false } = {}) {
  await a.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = a.getByRole("dialog", { name: "Import", exact: true });
  if (file) await dialog.getByLabel("Choose an API file").setInputFiles({ name: "api.json", mimeType: "application/json", buffer: Buffer.from(text) });
  else await dialog.getByRole("textbox", { name: "cURL command or API document", exact: true }).fill(text);
  await dialog.getByRole("region", { name: "Import preview", exact: true }).waitFor();
  return dialog;
}

async function importPreview(dialog) {
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

try {
  const first = await signIn("test1@codechatter.local");
  a = first.page;
  b = (await signIn("test2@codechatter.local")).page;
  for (const page of [a, b]) {
    page.setDefaultTimeout(15_000);
    page.on("request", (request) => {
      if (request.url().includes(`/api/rooms/${ROOM}/http/send`)) sends++;
      if (request.url().includes("never-fetch.invalid")) remoteFetches++;
    });
    await openStudio(page);
  }
  observer = await observe(first.context);

  stage = "preview without writes";
  const before = observer.counts();
  let dialog = await preview(openApi);
  const previewRegion = dialog.getByRole("region", { name: "Import preview", exact: true });
  check("OpenAPI format, requests and secret placeholders are previewed", /Detected OpenAPI/.test(await previewRegion.textContent()) && await previewRegion.getByText(requestName, { exact: false }).count() === 1 && /token \(secret\)/.test(await previewRegion.textContent()));
  check("preview does not reveal discarded credential values", !(await previewRegion.textContent()).includes(discarded));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await pause(400);
  check("cancelled preview changes no shared nodes or environments", JSON.stringify(before) === JSON.stringify(observer.counts()) && observer.fixture().roots.length === 0);
  check("preview sends no HTTP request and fetches no remote reference", sends === 0 && remoteFetches === 0);

  stage = "OpenAPI import and duplicate isolation";
  const arrivals = [];
  const watch = () => {
    const fixture = observer.fixture();
    if (fixture.roots.length === 1) arrivals.push([fixture.nodes.filter((node) => node.kind === "request").length, fixture.environments.length]);
  };
  observer.doc.on("afterTransaction", watch);
  dialog = await preview(openApi, { file: true });
  await importPreview(dialog);
  await until(() => observer.fixture().roots.length === 1 && observer.fixture().environments.length === 1);
  observer.doc.off("afterTransaction", watch);
  check("first import arrives as one complete shared collection", arrivals.length > 0 && arrivals.every(([requests, environments]) => requests === 2 && environments === 1));
  const initial = observer.fixture();
  const firstRoot = initial.roots[0].id;
  const firstRequest = initial.nodes.find((node) => node.name === requestName);
  await b.getByRole("tree", { name: "Requests", exact: true }).locator(`[data-id="${firstRequest.id}"]`).waitFor();
  check("second user sees the imported folder and its request live", await b.getByRole("tree", { name: "Requests", exact: true }).locator(`[data-id="${firstRoot}"]`).count() === 1);
  await a.getByRole("textbox", { name: "Request name", exact: true }).fill(`${requestName} changed`);
  await a.getByRole("textbox", { name: "Request name", exact: true }).press("Enter");
  await until(() => observer.fixture().nodes.some((node) => node.id === firstRequest.id && node.name === `${requestName} changed`));
  await importPreview(await preview(openApi));
  await until(() => observer.fixture().roots.length === 2 && observer.fixture().environments.length === 2);
  const duplicate = observer.fixture();
  check("duplicate import has fresh folders and environments without overwriting edits", duplicate.roots[0].id !== duplicate.roots[1].id && duplicate.environments[0].id !== duplicate.environments[1].id && duplicate.nodes.some((node) => node.id === firstRequest.id && node.name === `${requestName} changed`) && duplicate.nodes.some((node) => node.name === requestName && node.id !== firstRequest.id));

  stage = "Postman scripts and credentials";
  dialog = await preview(postman);
  check("Postman preview counts excluded scripts", /1 requests with scripts/.test(await dialog.getByRole("region", { name: "Import preview", exact: true }).textContent()));
  await importPreview(dialog);
  await until(() => observer.fixture().roots.length === 3 && observer.fixture().environments.length === 3);
  const imported = observer.fixture();
  const allRequests = imported.nodes.filter((node) => node.kind === "request");
  const secrets = imported.environments.flatMap((env) => env.variables).filter((variable) => variable.secret);
  check("shared imported requests contain no scripts or credential canaries", allRequests.every((request) => request.preScript === "" && request.testScript === "") && !JSON.stringify(imported).includes(discarded) && !JSON.stringify(imported).includes(script));
  check("credentials become empty secret environment variables", secrets.length >= 5 && secrets.every((variable) => variable.value === ""));
  await b.getByRole("button", { name: "Manage environments", exact: true }).click();
  const envDialog = b.getByRole("dialog", { name: "Environments", exact: true });
  await envDialog.getByRole("navigation", { name: "Environments", exact: true }).getByText(postmanName, { exact: true }).click();
  check("other user has no shared or local imported token", await envDialog.getByLabel("Shared value of apiToken", { exact: true }).inputValue() === "" && await envDialog.getByLabel("Your value of apiToken", { exact: true }).inputValue() === "");
  await b.keyboard.press("Escape");
  check("all imports remain passive until Send", sends === 0 && remoteFetches === 0);

  stage = "sandbox echo server";
  await a.getByRole("button", { name: "Close API Studio", exact: true }).click();
  await a.getByRole("button", { name: "New file", exact: true }).click();
  await a.getByPlaceholder("name.ext", { exact: true }).fill(serverFile);
  await a.getByPlaceholder("name.ext", { exact: true }).press("Enter");
  await a.getByRole("tab", { name: new RegExp(escapeRegex(serverFile)) }).waitFor();
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.type(`require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{s.setHeader("content-type","application/json");s.end(JSON.stringify({ok:true,method:q.method,url:q.url,body:b}))})}).listen(${port},()=>console.log("import listening ${port}"))`);
  runIssued = true;
  await a.keyboard.press("Control+Enter");
  await a.locator(".xterm-rows").getByText(`import listening ${port}`, { exact: false }).first().waitFor({ timeout: 60_000 });
  check("disposable server starts inside the room sandbox", true);

  stage = "second user sends imported request";
  await b.getByRole("combobox", { name: "Environment", exact: true }).click();
  await b.getByRole("option", { name: apiName, exact: true }).first().click();
  await b.getByRole("tree", { name: "Requests", exact: true }).locator(`[data-id="${firstRequest.id}"]`).click();
  await b.getByRole("button", { name: "Send", exact: true }).click();
  const response = b.getByRole("region", { name: "Response", exact: true });
  await response.getByText("200 OK", { exact: true }).waitFor({ timeout: 30_000 });
  const body = await response.textContent();
  check("second user sends imported path, query and JSON body to sandbox", body.includes('"method": "POST"') && body.includes(`/import-probe/${stamp}?marker=${stamp}`) && body.includes(stamp) && !body.includes("optional=off"));
  await b.getByRole("button", { name: "Code", exact: true }).click();
  await b.getByRole("radio", { name: "JavaScript axios", exact: true }).click();
  const code = await b.getByLabel("axios code", { exact: true }).textContent();
  check("imported request offers an axios snippet", code.includes('import axios from "axios"') && code.includes("await axios(") && code.includes(`/import-probe/${stamp}`));
  await b.keyboard.press("Escape");
} catch (error) {
  // Playwright errors can contain an input's value; keep diagnostics credential-free.
  check(`completed import workflow (${stage})`, false, error?.name ?? "Error");
} finally {
  if (a) {
    // Every cleanup is independent, so a failed assertion cannot strand another fixture.
    try {
      await a.keyboard.press("Escape");
      if (await a.getByRole("button", { name: "Close API Studio", exact: true }).count()) await a.getByRole("button", { name: "Close API Studio", exact: true }).click();
      if (runIssued) {
        const stop = a.getByRole("button", { name: "Stop", exact: true });
        if (await stop.count()) { await stop.click(); await stop.waitFor({ state: "hidden" }); }
      }
      check("fixture sandbox run is stopped", true);
    } catch { check("fixture sandbox run is stopped", false); }
    try {
      if (!await a.getByRole("tree", { name: "Files", exact: true }).count()) await a.getByRole("button", { name: "Files", exact: true }).click();
      const file = a.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name: serverFile, exact: true });
      if (await file.count()) { await file.press("Delete"); await file.waitFor({ state: "hidden" }); }
      check("fixture server file is removed", await file.count() === 0);
    } catch { check("fixture server file is removed", false); }
    try {
      await openStudio(a);
      for (const name of [apiName, postmanName]) {
        for (let attempts = 0; attempts < 4; attempts++) {
          const root = a.getByRole("tree", { name: "Requests", exact: true }).locator('[role="treeitem"][aria-level="1"]').filter({ hasText: new RegExp(`^${escapeRegex(name)}$`) }).first();
          if (!await root.count()) break;
          await root.press("Delete");
          await a.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
        }
      }
      if (observer) await until(() => observer.fixture().nodes.length === 0);
      check("all fixture collection nodes are removed", true);
    } catch { check("all fixture collection nodes are removed", false); }
    try {
      await a.keyboard.press("Escape");
      await openStudio(a);
      await a.getByRole("button", { name: "Manage environments", exact: true }).click();
      const dialog = a.getByRole("dialog", { name: "Environments", exact: true });
      for (const name of [apiName, postmanName]) {
        for (let attempts = 0; attempts < 4; attempts++) {
          const item = dialog.getByRole("navigation", { name: "Environments", exact: true }).getByText(name, { exact: true }).first();
          if (!await item.count()) break;
          await item.click();
          await dialog.getByRole("button", { name: "Delete environment", exact: true }).click();
        }
      }
      await a.keyboard.press("Escape");
      if (observer) await until(() => observer.fixture().environments.length === 0);
      check("all fixture environments are removed", true);
    } catch { check("all fixture environments are removed", false); }
  }
  observer?.close();
  await browser.close();
}
check("no browser page errors", errors.length === 0);
finish();
