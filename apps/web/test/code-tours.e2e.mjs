/** Exercise shared tours through two real editors, local playback and server-enforced viewer access; clean up every fixture. */
// From apps/web, with the shared dev stack running: node test/code-tours.e2e.mjs
import { createRequire } from "node:module";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { addTour, createFile, deleteTour, listTours, resolveTourStop, textOf, trash, restore, getNode } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { BASE, ROOM, check, finish, launch, openApp } from "./browser.mjs";

const WebSocket = createRequire(new URL("../../collab/package.json", import.meta.url))("ws");
const stamp = Date.now().toString(36);
const title = `Code tour ${stamp}`;
const firstStop = `Start ${stamp}`;
const secondStop = `Finish ${stamp}`;
const names = [`tour_start_${stamp}.js`, `tour_end_${stamp}.js`];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, ms = 20_000) {
  const end = Date.now() + ms;
  do { if (await probe()) return; await pause(60); } while (Date.now() < end);
  throw new Error("Tour state did not settle");
}

/** Same-origin authenticated live peer for fixture setup, assertions and verified cleanup. */
async function connect(context, kind) {
  const cookie = (await context.cookies(BASE)).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: new URL(BASE).origin } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${BASE.replace(/^http/, "ws")}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 2 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${ROOM}:${kind}`, document: doc, token: "session" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { provider.destroy(); } finally { try { socket.destroy(); } finally { doc.destroy(); } }
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Tours peer did not sync")), 20_000);
      provider.on("synced", () => { clearTimeout(timer); resolve(); });
      provider.on("authenticationFailed", () => { clearTimeout(timer); reject(new Error("Tours peer refused")); });
      provider.attach();
    });
  } catch (error) { close(); throw error; }
  return { doc, close };
}

if (ROOM !== "E2ETST") throw new Error("This suite only changes the seeded E2ETST room");
const { browser, errors, signIn } = await launch();
const live = [];
const fileIds = [];
const ownedTourIds = new Set();
let first, second, viewer, tours, files, attacker;
let secondId, originalRole;
let roleChanged = false;
let stage = "sign in";
const panel = (page) => page.getByRole("region", { name: "Code tours", exact: true });
function rememberOwnedTours() {
  if (tours) for (const tour of listTours(tours.doc)) {
    if (tour.title === title || tour.title === `Probe ${stamp}`) ownedTourIds.add(tour.id);
  }
}
const ownedTours = () => {
  rememberOwnedTours();
  return tours ? listTours(tours.doc).filter((tour) => ownedTourIds.has(tour.id)) : [];
};
async function openTours(page) {
  if (!await panel(page).isVisible().catch(() => false)) await openApp(page, "Tours");
  await panel(page).waitFor();
}
async function selectLine(page, name, line, extraLines = 0) {
  stage = `open fixture file ${names.indexOf(name) + 1}`;
  await page.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name, exact: true }).click();
  await page.locator(".monaco-editor .view-lines").first().click();
  stage = "select fixture lines using Go to line";
  await page.keyboard.press("Control+g");
  const go = page.getByRole("dialog", { name: "Go to line", exact: true });
  await go.getByRole("combobox").fill(String(line));
  await go.getByRole("combobox").press("Enter");
  for (let i = 0; i < extraLines; i++) await page.keyboard.press("Shift+ArrowDown");
}
async function addStop(page, stopTitle, newTour) {
  stage = "wait for add-stop dialog";
  const dialog = page.getByRole("dialog", { name: "Add this line to a tour", exact: true });
  await dialog.waitFor();
  stage = "select a tour in add-stop dialog";
  if (newTour) {
    await dialog.getByLabel("Tour", { exact: true }).selectOption("");
    await dialog.getByLabel("Tour title", { exact: true }).fill(title);
  }
  else {
    await dialog.getByLabel("Tour", { exact: true }).selectOption({ label: title });
    // Another peer edits while the author is writing a note: save must keep the original code.
    textOf(files.doc, fileIds[1]).insert(0, "// peer edit while dialog is open\n");
    await dialog.getByText(new RegExp(`${names[1].replaceAll(".", "\\.")}:3`)).waitFor();
  }
  await dialog.getByLabel("Stop title", { exact: true }).fill(stopTitle);
  await dialog.getByLabel("Note (Markdown)", { exact: true }).fill(`**${stopTitle}** explains this code.`);
  await dialog.getByRole("button", { name: "Add stop", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function setRole(value) {
  const response = await first.context.request.patch(`${BASE}/api/rooms/${ROOM}/people/${secondId}`, { headers: { origin: new URL(BASE).origin }, data: { role: value } });
  if (!response.ok()) throw new Error("Could not set fixture member role");
}
async function landed(page, name, lastLine) {
  await page.getByRole("tab", { name: new RegExp(name.replaceAll(".", "\\.")) }).waitFor();
  await page.getByText(new RegExp(`^Ln ${lastLine}, Col \\d+$`), { exact: true }).waitFor();
  await until(() => page.locator(".monaco-editor .cc-tour-line").count().then((count) => count > 0));
}

try {
  first = await signIn("test1@codechatter.local");
  second = await signIn("test2@codechatter.local");
  for (const profile of [first, second]) profile.page.setDefaultTimeout(20_000);
  secondId = (await second.context.request.get(`${BASE}/api/me`).then((response) => response.json())).user.id;
  const people = await first.context.request.get(`${BASE}/api/rooms/${ROOM}/people`).then((response) => response.json());
  originalRole = people.members.find((member) => member.id === secondId)?.role;
  if (originalRole !== "editor") throw new Error("Seeded second member must be an editor");
  files = await connect(first.context, "files"); live.push(files);
  tours = await connect(first.context, "tours"); live.push(tours);
  tours.doc.on("afterTransaction", rememberOwnedTours);
  fileIds.push(createFile(files.doc, { name: names[0], content: "// header\nexport const first = 1;\nexport const detail = 2;\n// end\n" }));
  fileIds.push(createFile(files.doc, { name: names[1], content: "// header\nexport const last = 3;\n// end\n" }));
  await openTours(second.page);

  stage = "editor context menu and selected lines";
  await selectLine(first.page, names[0], 2, 2);
  stage = "open editor context menu";
  await first.page.keyboard.press("Shift+F10");
  const menuitem = first.page.getByRole("menuitem", { name: "Add this line to a tour", exact: true });
  await menuitem.hover();
  // Let Monaco's opening gesture settle before activating the menu label.
  await first.page.waitForTimeout(250);
  await menuitem.locator(".action-label").click();
  stage = "submit first tour stop";
  await addStop(first.page, firstStop, true);
  await until(() => ownedTours().some((tour) => tour.stops.length === 1));
  check("the editor context menu creates a tour with the selected lines", resolveTourStop(files.doc, ownedTours()[0].stops[0])?.endLine === 3);

  stage = "command palette and second stop";
  await selectLine(first.page, names[1], 2);
  await first.page.keyboard.press("Control+Shift+p");
  const palette = first.page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("combobox").fill("Add this line to a tour");
  await palette.getByRole("option", { name: "Add this line to a tour", exact: true }).click();
  await addStop(first.page, secondStop, false);
  await until(() => ownedTours().some((tour) => tour.stops.length === 2));
  await panel(second.page).getByRole("button", { name: `Play ${title}`, exact: true }).waitFor();
  check("the other person sees both stops arrive live", ownedTours()[0].stops.length === 2);
  check("a stop draft follows peer edits made while its dialog was open", resolveTourStop(files.doc, ownedTours()[0].stops[1])?.startLine === 3);

  stage = "edit and reorder stops from the tool";
  await openTours(first.page);
  await panel(first.page).getByRole("button", { name: new RegExp(`^${title}`) }).click();
  const firstCard = panel(first.page).getByRole("group", { name: `Stop: ${firstStop}`, exact: true });
  const secondCard = panel(first.page).getByRole("group", { name: `Stop: ${secondStop}`, exact: true });
  await secondCard.focus();
  await secondCard.press("ArrowUp");
  await until(() => ownedTours()[0].stops[0]?.title === secondStop);
  check("a focused stop reorders by keyboard and shares the order", true);
  await firstCard.dragTo(secondCard);
  await until(() => ownedTours()[0].stops[0]?.title === firstStop);
  check("dragging reorders a stop back to the first position", true);
  await firstCard.getByRole("button", { name: `Edit stop ${firstStop}`, exact: true }).click();
  const edit = first.page.getByRole("dialog", { name: "Edit stop", exact: true });
  await edit.getByLabel("Note (Markdown)", { exact: true }).fill(`**${firstStop}** explains this code. Edited live.`);
  await edit.getByRole("button", { name: "Save stop", exact: true }).click();
  await until(() => ownedTours()[0].stops[0]?.note.endsWith("Edited live."));

  stage = "independent playback and keyboard navigation";
  await panel(second.page).getByRole("button", { name: `Play ${title}`, exact: true }).click();
  await panel(second.page).getByText("Stop 1 of 2", { exact: true }).waitFor();
  await landed(second.page, names[0], 3);
  check("play opens and marks the first stop's selected lines", true);
  check("Markdown renders the stop note", await panel(second.page).locator("strong").filter({ hasText: firstStop }).count() > 0);
  await openTours(first.page);
  check("another person's playback does not start my player", await panel(first.page).getByRole("button", { name: "End tour", exact: true }).count() === 0);
  await panel(second.page).getByRole("button", { name: "Next", exact: true }).click();
  await panel(second.page).getByText("Stop 2 of 2", { exact: true }).waitFor();
  await landed(second.page, names[1], 3);
  check("Next opens and marks the other file's stop", true);
  await second.page.keyboard.press("Alt+ArrowLeft");
  await panel(second.page).getByText("Stop 1 of 2", { exact: true }).waitFor();
  await landed(second.page, names[0], 3);
  check("Back works from the keyboard", true);
  await selectLine(second.page, names[1], 1);
  await panel(second.page).getByRole("button", { name: `Play stop ${firstStop}`, exact: true }).click();
  await landed(second.page, names[0], 3);
  check("playing the current stop again returns to its code", true);

  stage = "relative anchors after a live insertion above";
  await selectLine(first.page, names[0], 1);
  await first.page.keyboard.insertText("// inserted above\n");
  await until(() => resolveTourStop(files.doc, ownedTours()[0].stops[0])?.startLine === 3);
  await panel(second.page).getByRole("button", { name: "Next", exact: true }).click();
  await panel(second.page).getByRole("button", { name: "Back", exact: true }).click();
  await landed(second.page, names[0], 4);
  check("the same stop follows its lines after an insertion above", true);

  stage = "deleted file and safe skipping";
  trash(files.doc, fileIds[1]);
  await panel(second.page).getByRole("button", { name: "Next", exact: true }).click();
  await panel(second.page).getByText("This file has been deleted. Skip this stop.", { exact: true }).waitFor();
  await panel(second.page).getByRole("button", { name: "Back", exact: true }).click();
  await landed(second.page, names[0], 4);
  check("a deleted file is explicit and the player can leave that stop", true);

  stage = "deleted lines and safe skipping";
  const source = textOf(files.doc, fileIds[0]);
  const from = source.toString().indexOf("export const first");
  source.delete(from, "export const first = 1;\nexport const detail = 2;".length);
  await panel(second.page).getByText("These lines no longer exist. Skip this stop.", { exact: true }).waitFor();
  check("removed source lines are unavailable instead of jumping to other code", true);

  stage = "viewer playback and server write refusal";
  restore(files.doc, fileIds[1]);
  roleChanged = true;
  await setRole("viewer");
  await second.context.close(); second = null;
  stage = "viewer sign-in";
  viewer = await signIn("test2@codechatter.local");
  stage = "open Tours as a viewer";
  await openTours(viewer.page);
  stage = "play a tour as a viewer";
  await panel(viewer.page).getByRole("button", { name: `Play ${title}`, exact: true }).click();
  await panel(viewer.page).getByText("Stop 1 of 2", { exact: true }).waitFor();
  await panel(viewer.page).getByRole("button", { name: "Next", exact: true }).click();
  await landed(viewer.page, names[1], 3);
  check("a viewer can play without mutation controls", await panel(viewer.page).getByRole("button", { name: /^New tour$|^Edit |^Delete |^Move |^Add stop/ }).count() === 0);
  stage = "verify viewer write refusal";
  attacker = await connect(viewer.context, "tours"); live.push(attacker);
  const probeId = addTour(attacker.doc, { title: `Probe ${stamp}`, createdBy: secondId });
  if (!probeId || !listTours(attacker.doc).some((tour) => tour.id === probeId)) throw new Error("Viewer probe did not create a local mutation");
  ownedTourIds.add(probeId);
  await pause(600);
  const fresh = await connect(first.context, "tours"); live.push(fresh);
  check("collab refuses and does not persist a viewer's tour mutation", !listTours(tours.doc).some((tour) => tour.id === probeId) && !listTours(fresh.doc).some((tour) => tour.id === probeId));
  attacker.close();
  if (probeId) deleteTour(fresh.doc, probeId);
} catch (error) {
  await first?.page.screenshot({ path: `${process.env.TEMP}/codechatter-code-tours-failure.png` }).catch(() => {});
  await browser.contexts().at(-1)?.pages()[0]?.screenshot({ path: `${process.env.TEMP}/codechatter-code-tours-last-page.png` }).catch(() => {});
  check(`code-tours workflow completes (${stage})`, false, error?.name ?? "Error");
} finally {
  attacker?.close();
  await viewer?.context.close().catch(() => {});
  await second?.context.close().catch(() => {});
  if (roleChanged && first && originalRole) {
    try {
      await setRole(originalRole);
      const people = await first.context.request.get(`${BASE}/api/rooms/${ROOM}/people`).then((response) => response.json());
      check("the seeded room role is restored", people.members.find((member) => member.id === secondId)?.role === originalRole);
    } catch { check("the seeded room role is restored", false); }
  }
  try {
    rememberOwnedTours();
    if (tours) for (const id of ownedTourIds) deleteTour(tours.doc, id);
    if (files) for (const id of fileIds) trash(files.doc, id);
    if (first && tours) {
      const confirm = await connect(first.context, "tours"); live.push(confirm);
      await until(() => !listTours(confirm.doc).some((tour) => ownedTourIds.has(tour.id) || tour.title === title || tour.title === `Probe ${stamp}`));
    }
    if (first && files) {
      const confirm = await connect(first.context, "files"); live.push(confirm);
      await until(() => fileIds.every((id) => getNode(confirm.doc, id)?.trashedAt != null));
    }
    check("owned tours and files are removed, including on failure", true);
  } catch { check("owned tours and files are removed, including on failure", false); }
  for (const connection of live.reverse()) connection.close();
  await browser.close();
}
// Never echo arbitrary errors: they may contain source or request data.
check("no browser page errors", errors.length === 0, errors.length ? `${errors.length} page errors` : "");
finish();
