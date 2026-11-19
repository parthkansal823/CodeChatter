/** Verify groups through two real canvas users, exports and live component instances; remove owned fixtures even after failure. */
// From apps/web, with the shared dev stack running: node test/canvas-groups.e2e.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";
import { BASE, ROOM, check, finish, launch, openApp } from "./browser.mjs";

const WebSocket = createRequire(new URL("../../collab/package.json", import.meta.url))("ws");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  do { if (await probe()) return; await pause(70); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}

/** A same-origin session peer reads persisted geometry and cleans up only this suite's new document. */
async function connect(context, kind) {
  const cookie = (await context.cookies(BASE)).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: new URL(BASE).origin } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${BASE.replace(/^http/, "ws")}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 2 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${ROOM}:${kind}`, document: doc, token: "session" });
  const close = () => { provider.destroy(); socket.destroy(); doc.destroy(); };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Canvas fixture peer did not sync")), 20_000);
      provider.on("synced", () => { clearTimeout(timer); resolve(); });
      provider.on("authenticationFailed", () => { clearTimeout(timer); reject(new Error("Canvas fixture peer refused")); });
      provider.attach();
    });
  } catch (error) { close(); throw error; }
  return { doc, provider, close };
}

if (ROOM !== "E2ETST") throw new Error("This suite only changes the seeded E2ETST room");
const title = `Groups ${Date.now().toString(36)}`;
const { browser, errors, signIn } = await launch();
const peers = [];
let first, second, list, canvas, designId;
let stage = "sign in";
const surface = (page) => page.locator("[data-canvas]:visible").first();
const shape = (page, id) => surface(page).locator(`[data-shape-id="${id}"]`);
const snapshot = () => canvas.doc.getMap("shapes").toJSON();
const groupOf = () => Object.entries(snapshot()).find(([, entry]) => entry.type === "group")?.[0];
async function centre(page, id) {
  const box = await shape(page, id).boundingBox();
  if (!box) throw new Error("Expected a visible shape");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function select(page, ids) {
  await page.getByRole("button", { name: /^Select/ }).first().click();
  for (let index = 0; index < ids.length; index++) {
    const p = await centre(page, ids[index]);
    if (index) await page.keyboard.down("Shift");
    try { await page.mouse.click(p.x, p.y); } finally { if (index) await page.keyboard.up("Shift"); }
  }
}
async function exportAs(page, format) {
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: format, exact: true }).or(dialog.getByRole("button", { name: format, exact: true })).first().click();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), dialog.getByRole("button", { name: "Export", exact: true }).click()]);
  return readFileSync(await download.path());
}
try {
  first = await signIn("test1@codechatter.local");
  second = await signIn("test2@codechatter.local");
  list = await connect(first.context, "designs"); peers.push(list);
  for (const user of [first, second]) await openApp(user.page, "Design");
  stage = "create disposable design";
  const existing = new Set(list.doc.getMap("items").keys());
  await first.page.getByRole("button", { name: "New design" }).first().click();
  await until(() => { const added = [...list.doc.getMap("items").keys()].filter((id) => !existing.has(id)); if (added.length !== 1) return false; designId = added[0]; return true; }, "new design identity");
  await surface(first.page).waitFor({ timeout: 30_000 });
  await first.page.getByRole("button", { name: "Rename design" }).click();
  const name = first.page.getByRole("textbox", { name: "design name" });
  await name.fill(title); await name.press("Enter");
  await until(() => Object.entries(list.doc.getMap("items").toJSON()).some(([id, item]) => { if (item.name === title) designId = id; return item.name === title; }), "owned design identity");
  canvas = await connect(first.context, `design:${designId}`); peers.push(canvas);
  await second.page.getByText(title, { exact: true }).first().click();
  await surface(second.page).waitFor({ timeout: 30_000 });
  stage = "draw three shapes";
  for (const [index, x] of [70, 230, 410].entries()) {
    await first.page.getByRole("button", { name: /^Rectangle/ }).first().click();
    const box = await surface(first.page).boundingBox();
    await first.page.mouse.move(box.x + x, box.y + 120); await first.page.mouse.down();
    await first.page.mouse.move(box.x + x + 100, box.y + 200, { steps: 8 }); await first.page.mouse.up();
    await until(() => Object.keys(snapshot()).length === index + 1, "draw synchronizes");
  }
  const ids = Object.keys(snapshot());
  const before = snapshot();
  check("one user draws three shared shapes", ids.length === 3);
  stage = "group with Ctrl+G";
  await select(first.page, ids.slice(0, 2));
  check("two shapes selected before grouping", await first.page.getByRole("tree", { name: "Layers", exact: true }).locator('[role="treeitem"][aria-selected="true"]').count() === 2);
  await first.page.keyboard.press("Control+g");
  await until(() => !!groupOf(), "group reaches live document");
  const group = groupOf();
  const after = snapshot();
  const groupName = after[group].name;
  check("Ctrl+G keeps child coordinates and the third shape separate", ids.slice(0, 2).every((id) => after[id].parentId === group && after[id].x === before[id].x && after[id].y === before[id].y) && !after[ids[2]].parentId);
  const peerLayer = second.page.getByRole("treeitem", { name: groupName, exact: true });
  await peerLayer.waitFor();
  check("peer sees a group with two nested layers", await peerLayer.getAttribute("aria-expanded") === "true" && await second.page.getByRole("tree", { name: "Layers", exact: true }).getByRole("treeitem").count() === 4);
  stage = "peer moves the group";
  const shownBefore = await Promise.all([first, second].map((user) => shape(user.page, ids[0]).boundingBox()));
  await select(second.page, [ids[0]]);
  check("single click selects the whole group", await peerLayer.getAttribute("aria-selected") === "true");
  const p = await centre(second.page, ids[0]);
  await second.page.mouse.move(p.x, p.y); await second.page.mouse.down();
  await second.page.mouse.move(p.x + 36, p.y + 24, { steps: 8 }); await second.page.mouse.up();
  await until(() => ids.slice(0, 2).every((id) => snapshot()[id].x !== before[id].x && snapshot()[id].y !== before[id].y), "peer group move");
  const moved = snapshot();
  const dx = moved[ids[0]].x - before[ids[0]].x, dy = moved[ids[0]].y - before[ids[0]].y;
  check("peer move carries both children once and leaves the third alone", ids.slice(0, 2).every((id) => moved[id].x - before[id].x === dx && moved[id].y - before[id].y === dy) && moved[ids[2]].x === before[ids[2]].x && moved[ids[2]].y === before[ids[2]].y);
  await until(async () => (await Promise.all([first, second].map(async (user, index) => { const box = await shape(user.page, ids[0]).boundingBox(); return box && box.x > shownBefore[index].x && box.y > shownBefore[index].y; }))).every(Boolean), "both users see child movement");
  check("both canvases display the peer move", true);
  stage = "drill in, escape, ungroup and undo";
  const child = await centre(first.page, ids[0]); await first.page.mouse.dblclick(child.x, child.y);
  const selectedChild = first.page.getByRole("tree", { name: "Layers", exact: true }).locator('[role="treeitem"][aria-selected="true"]');
  await until(async () => await selectedChild.count() === 1 && await selectedChild.getAttribute("aria-level") === "2", "double click selects a child");
  check("double-click enters the group and selects one child", true);
  await first.page.keyboard.press("Escape");
  await until(async () => await first.page.getByRole("treeitem", { name: groupName, exact: true }).getAttribute("aria-selected") === "true", "Escape selects parent group");
  await first.page.keyboard.press("Control+Shift+g");
  await until(() => !snapshot()[group] && ids.slice(0, 2).every((id) => !snapshot()[id].parentId), "ungroup");
  check("ungroup promotes and selects both unchanged children", await selectedChild.count() === 2 && ids.slice(0, 2).every((id) => snapshot()[id].x === moved[id].x && snapshot()[id].y === moved[id].y));
  await first.page.keyboard.press("Control+z");
  await until(() => !!snapshot()[group] && ids.slice(0, 2).every((id) => snapshot()[id].parentId === group), "undo restores group");
  await second.page.getByRole("treeitem", { name: groupName, exact: true }).waitFor();
  check("undo regroups for both users without undoing the peer move", ids.slice(0, 2).every((id) => snapshot()[id].x === moved[id].x && snapshot()[id].y === moved[id].y));
  stage = "grouped exports";
  const svg = (await exportAs(first.page, "SVG")).toString();
  check("SVG export contains grouped children", svg.includes("<svg") && (svg.match(/<rect\b/g) ?? []).length >= 3);
  const png = await exportAs(first.page, "PNG");
  check("grouped PNG export is a real image", png.subarray(1, 4).toString() === "PNG");
  const pdf = await exportAs(first.page, "PDF");
  check("grouped PDF export is a real document", pdf.subarray(0, 5).toString() === "%PDF-");
  stage = "live grouped component instance";
  const shapes = canvas.doc.getMap("shapes");
  const current = snapshot();
  const mainId = `groups-main-${designId}`, instanceId = `groups-instance-${designId}`;
  const left = Math.min(...ids.slice(0, 2).map((id) => current[id].x)), top = Math.min(...ids.slice(0, 2).map((id) => current[id].y));
  const right = Math.max(...ids.slice(0, 2).map((id) => current[id].x + current[id].w));
  canvas.doc.transact(() => {
    const base = { ...current[ids[2]], x: left - 10, y: top - 10, w: right - left + 20, h: 110, parentId: null, fill: "none", component: true, type: "frame", name: "Grouped main" };
    shapes.set(mainId, new Y.Map(Object.entries(base)));
    shapes.get(group).set("parentId", mainId);
    shapes.set(instanceId, new Y.Map(Object.entries({ ...base, type: "instance", component: false, instanceOf: mainId, name: "Grouped instance", x: base.x + 360 })));
  });
  const virtual = (page) => surface(page).locator(`[data-instance-shape-id="${instanceId}~${ids[0]}"] rect`).first();
  for (const user of [first, second]) await virtual(user.page).waitFor({ state: "attached" });
  const oldX = Number(await virtual(second.page).getAttribute("x"));
  shapes.get(ids[0]).set("x", current[ids[0]].x + 12);
  await until(async () => (await Promise.all([first, second].map(async (user) => Number(await virtual(user.page).getAttribute("x")) === oldX + 12))).every(Boolean), "grouped instance follows main child");
  check("both users render grouped component instances and live child updates", true);
} catch (error) {
  check(`groups browser flow: ${stage}`, false, error.message);
  if (first) await first.page.screenshot({ path: `${process.env.TEMP ?? "/tmp"}/codechatter-canvas-groups-failure.png` }).catch(() => {});
} finally {
  try {
    // Discover the owned item even when creation/rename failed halfway through.
    if (list && !designId) designId = Object.entries(list.doc.getMap("items").toJSON()).find(([, item]) => item.name === title)?.[0];
    if (designId && !canvas) { canvas = await connect(first.context, `design:${designId}`); peers.push(canvas); }
    if (canvas) canvas.doc.getMap("shapes").clear();
    if (list && designId) list.doc.getMap("items").delete(designId);
    await until(() => peers.every((peer) => !peer.provider.hasUnsyncedChanges), "fixture cleanup acknowledged");
    check("owned shapes and design removed even after failure", (!canvas || canvas.doc.getMap("shapes").size === 0) && (!list || !designId || !list.doc.getMap("items").has(designId)));
  } catch (error) { check("owned canvas cleanup", false, error.message); }
  for (const peer of peers.reverse()) peer.close();
  await browser.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
finish();
