/** Verify private cookies with two sandbox clients, scripts and a collection; remove owned fixtures even on failure. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { createFile, getNode, randomId, trash } from "@codechatter/workspace-model";
import * as Y from "yjs";
import { BASE, ROOM, check, finish, launch, openApp } from "./browser.mjs";

const WebSocket = createRequire(new URL("../../collab/package.json", import.meta.url))("ws");
const stamp = Date.now().toString(36), serverFile = `api_cookies_${stamp}.js`;
const port = 20_000 + Math.floor(Math.random() * 10_000);
const sessionName = `session_${stamp}`, preferenceName = `preference_${stamp}`;
const ephemeralName = `ephemeral_${stamp}`;
const folderName = `Cookie sequence ${stamp}`, environmentNames = [`Cookie A ${stamp}`, `Cookie B ${stamp}`];
const privateVariable = `manualCookie_${stamp}`, manualValue = randomUUID();
const owned = { folder: randomId(), login: randomId(), me: randomId(), runnerMe: randomId(), short: randomId(), borrowed: randomId(), envA: randomId(), envB: randomId() };
const ownedNodeIds = [owned.folder, owned.login, owned.me, owned.runnerMe, owned.short, owned.borrowed];
const privateValues = new Set([manualValue]);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  do { if (await probe()) return; await pause(70); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}

/** Same-origin fixture peers never print their session header. */
async function connect(context, kind) {
  const cookie = (await context.cookies(BASE)).map((item) => `${item.name}=${item.value}`).join("; ");
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: new URL(BASE).origin } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${BASE.replace(/^http/, "ws")}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 2 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${ROOM}:${kind}`, document: doc, token: "session" });
  const close = () => { provider.destroy(); socket.destroy(); doc.destroy(); };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture peer did not sync")), 20_000);
      provider.on("synced", () => { clearTimeout(timer); resolve(); });
      provider.on("authenticationFailed", () => { clearTimeout(timer); reject(new Error("Fixture peer refused")); });
      provider.attach();
    });
  } catch (error) { close(); throw error; }
  return { doc, provider, close };
}
function requestNode(id, name, path, parentId = null, order = 1, scripts = {}) {
  return new Y.Map(Object.entries({
    id, kind: "request", name, parentId, order, protocol: "http", method: "GET", useCookieJar: true,
    url: new Y.Text(`http://localhost:${port}${path}`), params: new Y.Array(), headers: new Y.Array(),
    assertions: new Y.Array(), extracts: new Y.Array(), messages: new Y.Array(), example: null,
    preScript: new Y.Text(scripts.pre ?? ""), testScript: new Y.Text(scripts.after ?? ""),
  }));
}

// Cookie values are generated at runtime in the sandbox, never embedded in the shared file.
const serverSource = `const http=require("http"),crypto=require("crypto");
const session=crypto.randomBytes(24).toString("hex"),preference=crypto.randomBytes(18).toString("hex"),ephemeral=crypto.randomBytes(18).toString("hex");
http.createServer((q,s)=>{const u=new URL(q.url,"http://localhost");s.setHeader("Content-Type","application/json");
if(u.pathname==="/short"){s.setHeader("Set-Cookie",${JSON.stringify(ephemeralName)}+"="+ephemeral+"; Path=/; Max-Age=3");s.end(JSON.stringify({short:true}));return;}
if(u.pathname==="/login"){s.setHeader("Set-Cookie",[${JSON.stringify(sessionName)}+"="+session+"; Path=/; HttpOnly; SameSite=Lax",${JSON.stringify(preferenceName)}+"="+preference+"; Path=/; Max-Age=3600; Secure; SameSite=Strict"]);s.end(JSON.stringify({login:true}));return;}
const cookies=Object.create(null);for(const part of(q.headers.cookie||"").split(";")){const at=part.indexOf("=");if(at>0)cookies[part.slice(0,at).trim()]=part.slice(at+1).trim();}
s.end(JSON.stringify({cookies,projection:u.searchParams.get("cookieProjection")}));}).listen(${port},()=>console.log(${JSON.stringify(`cookie fixture ready ${stamp}`)}));`;
const projectionScript = `pm.request.url += "?cookieProjection=" + (pm.cookies.has(${JSON.stringify(sessionName)}) ? "yes" : "no");`;
const matchingScript = `pm.test("cookies are read only",()=>pm.expect(typeof pm.cookies.set).to.equal("undefined"));
pm.test("projection matches sent session",()=>pm.expect(pm.cookies.get(${JSON.stringify(sessionName)})).to.equal(pm.response.json().cookies[${JSON.stringify(sessionName)}]));
globalThis.console.log("private cookie projection",pm.cookies.get(${JSON.stringify(sessionName)}));
Promise.reject(pm.cookies.get(${JSON.stringify(sessionName)})); await new Promise(resolve=>setTimeout(resolve,50));`;
const runnerScript = `${matchingScript}\npm.test("previous request filled jar",()=>pm.expect(pm.cookies.has(${JSON.stringify(sessionName)})&&pm.cookies.has(${JSON.stringify(preferenceName)})).to.equal(true));`;

if (ROOM !== "E2ETST") throw new Error("This suite only changes the seeded E2ETST room");
const { browser, errors, signIn } = await launch();
const peers = [], observedResults = [];
let first, second, apiPeer, filesPeer, fileId;
let ownedRunId = null, ownedRunExit = null, activeRunId = null;
let consoleLeak = false, stage = "sign in";
const responsePane = (page) => page.getByRole("region", { name: "Response", exact: true });
const requestTree = (page) => page.getByRole("tree", { name: "Requests", exact: true });
const newContext = browser.newContext.bind(browser);
browser.newContext = async (...options) => {
  const context = await newContext(...options);
  context.on("page", (page) => {
    page.on("console", (message) => { if ([...privateValues].some((value) => message.text().includes(value))) consoleLeak = true; });
    page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
      const event = /^42\d*(\[.*\])$/.exec(String(payload));
      if (!event) return;
      try {
        const [name, data] = JSON.parse(event[1]);
        if (name === "run:started") { activeRunId = data.id; if (data.path === serverFile) ownedRunId = data.id; }
        if (name === "run:exit") { if (data.runId === activeRunId) activeRunId = null; if (data.runId === ownedRunId) ownedRunExit = data.reason; }
      } catch { /* Unrelated socket frame. */ }
    }));
    page.on("response", async (response) => {
      if (!response.url().includes(`/api/rooms/${ROOM}/http/send`) || response.request().method() !== "POST") return;
      try {
        const result = await response.json(); observedResults.push(result);
        if (result.ok) for (const [name, value] of result.headers) {
          if (name.toLowerCase() !== "set-cookie") continue;
          const match = new RegExp(`^(?:${sessionName}|${preferenceName}|${ephemeralName})=([^;]*)`).exec(value);
          if (match?.[1]) privateValues.add(match[1]);
        }
      } catch { /* The owning send checks its failure. */ }
    });
  });
  return context;
};
async function openStudio(page) {
  if (!await page.getByRole("button", { name: "Close API Studio", exact: true }).count()) await openApp(page, "API");
  await requestTree(page).waitFor();
}
async function selectRequest(page, id) {
  await requestTree(page).locator(`[data-id="${id}"]`).click();
  await page.getByRole("textbox", { name: "Request name", exact: true }).waitFor();
}
async function send(page, id) {
  await selectRequest(page, id);
  const [reply] = await Promise.all([
    page.waitForResponse((response) => response.url().includes(`/api/rooms/${ROOM}/http/send`) && response.request().method() === "POST", { timeout: 40_000 }),
    page.getByRole("button", { name: "Send", exact: true }).click(),
  ]);
  const result = await reply.json();
  if (!result.ok) throw new Error("Cookie fixture HTTP send failed");
  await responsePane(page).getByText("200 OK", { exact: true }).waitFor();
  return { result, body: JSON.parse(result.body) };
}
async function environment(page, name) {
  await page.getByRole("combobox", { name: "Environment", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function jar(page) {
  await page.getByRole("button", { name: "Manage cookies", exact: true }).click();
  return page.getByRole("dialog", { name: "Cookies", exact: true });
}
const noPrivateValues = (value) => [...privateValues].every((secret) => !String(value).includes(secret));

try {
  first = await signIn("test1@codechatter.local"); second = await signIn("test2@codechatter.local");
  for (const user of [first, second]) user.page.setDefaultTimeout(15_000);
  apiPeer = await connect(first.context, "api"); peers.push(apiPeer);
  filesPeer = await connect(first.context, "files"); peers.push(filesPeer);
  const nodes = apiPeer.doc.getMap("nodes"), environments = apiPeer.doc.getMap("environments");
  stage = "known request fixtures";
  apiPeer.doc.transact(() => {
    nodes.set(owned.folder, new Y.Map(Object.entries({ id: owned.folder, kind: "folder", name: folderName, parentId: null, order: 1 })));
    nodes.set(owned.login, requestNode(owned.login, `Cookie login ${stamp}`, "/login", owned.folder, 1));
    nodes.set(owned.runnerMe, requestNode(owned.runnerMe, `Cookie runner me ${stamp}`, "/me", owned.folder, 2, { pre: projectionScript, after: runnerScript }));
    nodes.set(owned.me, requestNode(owned.me, `Cookie me ${stamp}`, "/me", null, 2, { pre: projectionScript, after: matchingScript }));
    nodes.set(owned.short, requestNode(owned.short, `Short cookie ${stamp}`, "/short", null, 3));
    nodes.set(owned.borrowed, requestNode(owned.borrowed, `Borrowed cookie ${stamp}`, "/me", null, 4, { pre: `const value=pm.cookies.get(${JSON.stringify(ephemeralName)}); await new Promise(resolve=>setTimeout(resolve,3500)); pm.request.url+="?cookieProjection="+encodeURIComponent(value);` }));
    for (const [index, id] of [owned.envA, owned.envB].entries()) {
      const variables = new Y.Array();
      if (!index) variables.push([new Y.Map(Object.entries({ id: randomId(), key: privateVariable, value: "", enabled: true, secret: true }))]);
      environments.set(id, new Y.Map(Object.entries({ id, name: environmentNames[index], order: index + 1, variables })));
    }
  });
  fileId = createFile(filesPeer.doc, { name: serverFile, content: serverSource });
  await until(() => peers.every((peer) => !peer.provider.hasUnsyncedChanges), "fixture acknowledgement");
  stage = "sandbox server";
  await first.page.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name: serverFile, exact: true }).dblclick();
  await first.page.getByRole("tab", { name: new RegExp(serverFile.replace(".", "\\.")) }).waitFor();
  if (await first.page.getByRole("button", { name: "Stop", exact: true }).count()) throw new Error("Seeded room already has an active run");
  await first.page.getByRole("button", { name: "Run", exact: true }).click();
  await until(() => ownedRunId !== null, "owned run identity", 40_000);
  await first.page.locator(".xterm-rows").getByText(`cookie fixture ready ${stamp}`, { exact: false }).first().waitFor({ timeout: 60_000 });
  check("cookie server starts in the sandbox", true);
  for (const user of [first, second]) { await openStudio(user.page); await environment(user.page, environmentNames[0]); }
  stage = "login Cookies tab";
  const login = await send(first.page, owned.login);
  check("login returns two separate Set-Cookie headers", login.result.headers.filter(([name]) => name.toLowerCase() === "set-cookie").length === 2);
  await responsePane(first.page).getByRole("tab", { name: /^Cookies/ }).click();
  const tab = responsePane(first.page), tabText = await tab.textContent();
  check("Cookies tab shows both names and attributes", await tab.getByText(sessionName, { exact: true }).count() > 0 && await tab.getByText(preferenceName, { exact: true }).count() > 0 && /HttpOnly/.test(tabText) && /Secure/.test(tabText) && /Lax/.test(tabText) && /Strict/.test(tabText));
  check("session cookie expiry is explained", /when the session ends/i.test(tabText));
  stage = "round trip and scripts";
  let answer = await send(first.page, owned.me);
  check("jar sends both cookies including Secure on localhost", Object.keys(answer.body.cookies).length === 2 && !!answer.body.cookies[sessionName] && !!answer.body.cookies[preferenceName]);
  check("before-script sees sent cookies", answer.body.projection === "yes");
  await responsePane(first.page).getByRole("tab", { name: /^Tests/ }).click();
  const tests = responsePane(first.page).getByRole("list", { name: "Test results", exact: true });
  check("after-script reads cookies without mutation APIs", await tests.getByLabel("Passed", { exact: true }).count() === 2 && await tests.getByLabel("Failed", { exact: true }).count() === 0);
  const consoleText = await responsePane(first.page).getByRole("region", { name: "Console", exact: true }).textContent();
  check("script logs redact cookie values", /private cookie projection/.test(consoleText) && noPrivateValues(consoleText));
  const example = responsePane(first.page).getByRole("button", { name: "Save example", exact: true });
  if (await example.isEnabled()) { await example.click(); await until(() => nodes.get(owned.me)?.get("example") !== null, "example arrival"); }
  check("response examples cannot share cookie values", noPrivateValues(JSON.stringify(apiPeer.doc.toJSON())));
  stage = "person isolation";
  answer = await send(second.page, owned.me);
  check("peer does not inherit another person's cookies", Object.keys(answer.body.cookies).length === 0 && answer.body.projection === "no");
  let dialog = await jar(second.page);
  check("peer cookie dialog is empty", await dialog.locator("[data-cookie-name]").count() === 0);
  await second.page.keyboard.press("Escape");
  stage = "delete one";
  dialog = await jar(first.page);
  check("jar lists both cookies under localhost", await dialog.getByText("localhost", { exact: true }).count() > 0 && await dialog.locator(`[data-cookie-name="${sessionName}"]`).count() === 1 && await dialog.locator(`[data-cookie-name="${preferenceName}"]`).count() === 1);
  await dialog.getByRole("button", { name: `Delete cookie ${preferenceName}`, exact: true }).click();
  await dialog.locator(`[data-cookie-name="${preferenceName}"]`).waitFor({ state: "hidden" });
  await first.page.keyboard.press("Escape"); answer = await send(first.page, owned.me);
  check("deleting one cookie stops sending it", Object.keys(answer.body.cookies).length === 1 && !!answer.body.cookies[sessionName] && !answer.body.cookies[preferenceName]);
  stage = "environment isolation";
  await environment(first.page, environmentNames[1]); answer = await send(first.page, owned.me);
  check("same host has an isolated jar in another environment", Object.keys(answer.body.cookies).length === 0 && answer.body.projection === "no");
  await environment(first.page, environmentNames[0]); answer = await send(first.page, owned.me);
  check("original environment retains its cookie", Object.keys(answer.body.cookies).length === 1 && !!answer.body.cookies[sessionName]);
  stage = "request jar switch";
  const toggle = first.page.getByRole("switch", { name: "Use cookie jar", exact: true });
  await toggle.click(); await until(() => nodes.get(owned.me)?.get("useCookieJar") === false, "jar switch saved");
  answer = await send(first.page, owned.me);
  check("jar off sends no cookie and no script projection", Object.keys(answer.body.cookies).length === 0 && answer.body.projection === "no");
  await toggle.click(); await until(() => nodes.get(owned.me)?.get("useCookieJar") === true, "jar switch restored");
  stage = "manual header";
  await first.page.getByRole("button", { name: "Manage environments", exact: true }).click();
  const envDialog = first.page.getByRole("dialog", { name: "Environments", exact: true });
  await envDialog.getByRole("navigation", { name: "Environments", exact: true }).getByText(environmentNames[0], { exact: true }).click();
  await envDialog.getByLabel(`Your value of ${privateVariable}`, { exact: true }).fill(manualValue);
  await first.page.keyboard.press("Escape");
  const headers = nodes.get(owned.me).get("headers");
  headers.push([new Y.Map(Object.entries({ id: randomId(), enabled: true, key: "Cookie", value: `${sessionName}={{${privateVariable}}}` }))]);
  await until(() => !apiPeer.provider.hasUnsyncedChanges, "manual header acknowledgement"); await pause(300);
  answer = await send(first.page, owned.me);
  check("typed Cookie header wins without combining jar cookies", Object.keys(answer.body.cookies).length === 1 && answer.body.cookies[sessionName] === manualValue && !answer.body.cookies[preferenceName]);
  check("manual Cookie precedence is explained", /Cookie.*entered by hand/i.test(await responsePane(first.page).textContent()));
  headers.delete(0, headers.length); await until(() => !apiPeer.provider.hasUnsyncedChanges, "manual header removal");
  stage = "collection sequence";
  dialog = await jar(first.page); await dialog.getByRole("button", { name: "Delete all cookies", exact: true }).click(); await first.page.keyboard.press("Escape");
  const beforeRun = observedResults.length;
  await requestTree(first.page).locator(`[data-id="${owned.folder}"]`).click({ button: "right" });
  await first.page.getByRole("menuitem", { name: "Run folder", exact: true }).click();
  const runner = first.page.getByRole("dialog", { name: `Run ${folderName}`, exact: true });
  await runner.getByRole("button", { name: "Run", exact: true }).click();
  await runner.getByRole("status").filter({ hasText: "2 of 2 sent" }).waitFor({ timeout: 60_000 });
  check("runner carries login cookies into the next request", /All passed\./.test(await runner.textContent()) && observedResults.length >= beforeRun + 2);
  await first.page.keyboard.press("Escape"); answer = await send(first.page, owned.me);
  check("runner cookies remain in the jar", Object.keys(answer.body.cookies).length === 2 && !!answer.body.cookies[sessionName] && !!answer.body.cookies[preferenceName]);
  stage = "domain deletion and privacy";
  dialog = await jar(first.page); await dialog.getByRole("button", { name: "Delete cookies for localhost", exact: true }).click();
  check("domain deletion removes its cookie rows", await dialog.locator("[data-cookie-name]").count() === 0);
  await first.page.keyboard.press("Escape"); answer = await send(first.page, owned.me);
  check("domain deletion stops sending both cookies", Object.keys(answer.body.cookies).length === 0);
  stage = "expired cookie remains private after a pre-script reads it";
  const privateCount = privateValues.size;
  await send(first.page, owned.short);
  await until(() => privateValues.size > privateCount, "short-lived cookie observed privately");
  answer = await send(first.page, owned.borrowed);
  check("expired cookie is not sent as a Cookie header", Object.keys(answer.body.cookies).length === 0);
  check("pre-script read the short-lived credential", privateValues.has(answer.body.projection));
  check("expired credentials cannot enter a shared response example", await responsePane(first.page).getByRole("button", { name: "Save example", exact: true }).isDisabled());
  check("shared request document has no cookie values", noPrivateValues(JSON.stringify(apiPeer.doc.toJSON())));
  for (const [index, user] of [first, second].entries()) {
    const clean = await user.page.evaluate((secrets) => [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).filter((key) => key?.startsWith("cc:api-studio:") && key.endsWith(":history")).every((key) => secrets.every((value) => !localStorage.getItem(key).includes(value))), [...privateValues]);
    check(`person ${index + 1} history has no cookie values`, clean);
  }
  check("browser console has no cookie values", !consoleLeak);
} catch (error) {
  // Errors and screenshots can quote private response values; report categories only.
  check(`cookie browser flow (${stage})`, false, error?.name ?? "Error");
} finally {
  if (first) try {
    await first.page.keyboard.press("Escape");
    const close = first.page.getByRole("button", { name: "Close API Studio", exact: true }); if (await close.count()) await close.click();
    if (ownedRunId && !ownedRunExit) {
      if (activeRunId !== ownedRunId) throw new Error("Another run replaced owned fixture");
      await first.page.getByRole("button", { name: "Stop", exact: true }).first().click();
      await until(() => ownedRunExit !== null, "owned server stops");
    }
    check("owned sandbox server stopped", !ownedRunId || ownedRunExit !== null);
  } catch { check("owned sandbox server stopped", false); }
  try {
    if (filesPeer && fileId) { trash(filesPeer.doc, fileId); await until(() => !filesPeer.provider.hasUnsyncedChanges && getNode(filesPeer.doc, fileId)?.trashedAt != null, "owned file removed"); }
    check("owned sandbox file removed", !fileId || getNode(filesPeer.doc, fileId)?.trashedAt != null);
  } catch { check("owned sandbox file removed", false); }
  try {
    if (apiPeer) {
      apiPeer.doc.transact(() => { for (const id of ownedNodeIds) apiPeer.doc.getMap("nodes").delete(id); for (const id of [owned.envA, owned.envB]) apiPeer.doc.getMap("environments").delete(id); });
      await until(() => !apiPeer.provider.hasUnsyncedChanges, "API fixture deletion acknowledged");
    }
    check("owned requests and environments removed even after failure", !apiPeer || ownedNodeIds.every((id) => !apiPeer.doc.getMap("nodes").has(id)) && [owned.envA, owned.envB].every((id) => !apiPeer.doc.getMap("environments").has(id)));
  } catch { check("owned requests and environments removed even after failure", false); }
  for (const user of [first, second].filter(Boolean)) try {
    // Fresh ephemeral profiles contain only this suite's API Studio state.
    await user.page.evaluate(() => { for (const storage of [localStorage, sessionStorage]) for (const key of [...Array(storage.length).keys()].map((i) => storage.key(i))) if (key?.startsWith("cc:api-studio:")) storage.removeItem(key); });
  } catch { check("owned local API state removed", false); }
  for (const peer of peers.reverse()) peer.close();
  await browser.close();
}
check("no browser page errors", errors.length === 0);
finish();
