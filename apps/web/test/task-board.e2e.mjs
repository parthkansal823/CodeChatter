/** Verify a shared task board, code-derived cards and server-enforced viewer permissions, removing every owned fixture. */
// From apps/web with the shared dev stack running: node test/task-board.e2e.mjs
import { createRequire } from "node:module";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { deleteTask, findByPath, readTasks, taskMaps, textOf, trash } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { BASE, ROOM, check, finish, launch } from "./browser.mjs";

const WebSocket = createRequire(new URL("../../collab/package.json", import.meta.url))("ws");
const stamp = Date.now().toString(36);
const title = `Board task ${stamp}`;
const codeTitle = `code task ${stamp}`;
const doingTitle = `ongoing task ${stamp}`;
const doneTitle = `finished task ${stamp}`;
const filename = `task_board_${stamp}.js`;
console.log(JSON.stringify({ taskBoardFixture: stamp, filename }));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, ms = 15_000) {
  const end = Date.now() + ms;
  do { if (await probe()) return; await pause(50); } while (Date.now() < end);
  throw new Error("A task-board fixture did not reach its expected state");
}

/** A same-origin, cookie-authenticated peer, used for assertions and explicit model-helper cleanup. */
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
    try { provider.destroy(); }
    finally { try { socket.destroy(); } finally { doc.destroy(); } }
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Task document did not sync")), 20_000);
      provider.on("synced", () => { clearTimeout(timer); resolve(); });
      provider.on("authenticationFailed", () => { clearTimeout(timer); reject(new Error("Task document was refused")); });
      provider.attach();
    });
  } catch (error) { close(); throw error; }
  return { doc, close };
}

if (ROOM !== "E2ETST") throw new Error("This suite only changes the seeded E2ETST room");
const { browser, errors, signIn } = await launch();
let first, second, viewer, tasks, files, attacker;
let originalRole = null;
let roleChanged = false;
let secondId = "";
let fixtureFileId = null;
let stage = "sign in";
let cleanupStage = "not started";
const open = [];
const ownedIds = new Set();

const board = (page) => page.getByRole("region", { name: "Task board", exact: true });
const column = (page, name) => board(page).getByRole("region", { name, exact: true });
const card = (page, name) => board(page).getByRole("group", { name: `Task: ${name}`, exact: true });

async function openBoard(page) {
  if (!await board(page).count()) await page.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Tasks", exact: true }).click();
  await board(page).waitFor();
  await column(page, "To do").waitFor();
}

async function writeFile(text) {
  if (await board(first.page).count()) await board(first.page).getByRole("button", { name: "Close task board", exact: true }).click();
  await first.page.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name: filename, exact: true }).click();
  await first.page.locator(".monaco-editor .view-lines").first().click();
  await first.page.keyboard.press("Control+a");
  await first.page.keyboard.insertText(text);
  await until(() => textOf(files.doc, fixtureFileId)?.toString() === text);
}

function rememberOwned() {
  for (const [id, snapshot] of taskMaps(tasks.doc).cards) {
    if (snapshot?.title?.includes(stamp) || snapshot?.source?.fileId === fixtureFileId) ownedIds.add(id);
  }
}

async function role(roleName) {
  const response = await first.context.request.patch(`${BASE}/api/rooms/${ROOM}/people/${secondId}`, { headers: { origin: new URL(BASE).origin }, data: { role: roleName } });
  if (!response.ok()) throw new Error("Could not update the test member role");
}

try {
  first = await signIn("test1@codechatter.local");
  second = await signIn("test2@codechatter.local");
  for (const profile of [first, second]) profile.page.setDefaultTimeout(15_000);
  const me = await second.context.request.get(`${BASE}/api/me`).then((response) => response.json());
  secondId = me.user.id;
  const people = await first.context.request.get(`${BASE}/api/rooms/${ROOM}/people`).then((response) => response.json());
  originalRole = people.members.find((member) => member.id === secondId)?.role ?? null;
  if (originalRole !== "editor") throw new Error("The seeded second account must be an editor");
  tasks = await connect(first.context, "tasks"); open.push(tasks);
  files = await connect(first.context, "files"); open.push(files);
  await openBoard(first.page);
  await openBoard(second.page);

  stage = "manual card creation and movement";
  await board(first.page).getByRole("button", { name: "Add to To do", exact: true }).click();
  const dialog = first.page.getByRole("dialog", { name: "Add task", exact: true });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Description", { exact: true }).fill(`Disposable board fixture ${stamp}`);
  await dialog.getByRole("button", { name: "Add task", exact: true }).click();
  await card(second.page, title).waitFor();
  await until(() => readTasks(tasks.doc).some((task) => task.title === title));
  rememberOwned();
  check("a manual card arrives live for the second person", await column(second.page, "To do").getByRole("group", { name: `Task: ${title}`, exact: true }).count() === 1);
  await card(second.page, title).dragTo(column(second.page, "Doing"));
  await until(() => readTasks(tasks.doc).find((task) => task.title === title)?.column === "doing");
  await column(first.page, "Doing").getByRole("group", { name: `Task: ${title}`, exact: true }).waitFor();
  check("HTML drag moves the shared card to Doing", true);
  await card(second.page, title).focus();
  await card(second.page, title).press("ArrowRight");
  await until(() => readTasks(tasks.doc).find((task) => task.title === title)?.column === "done");
  await column(first.page, "Done").getByRole("group", { name: `Task: ${title}`, exact: true }).waitFor();
  check("a focused card moves by keyboard and shares the change", true);

  stage = "manual editing, assignment and filters";
  await card(first.page, title).getByRole("button", { name: `Move ${title}`, exact: true }).click();
  await first.page.getByRole("menuitem", { name: "To do", exact: true }).click();
  await until(() => readTasks(tasks.doc).find((task) => task.title === title)?.column === "todo");
  check("the Move menu provides another keyboard-accessible route", true);
  stage = "concurrent description and assignment";
  await card(first.page, title).getByRole("button", { name: `Edit ${title}`, exact: true }).click();
  const editing = first.page.getByRole("dialog", { name: "Edit task", exact: true });
  await editing.getByLabel("Description", { exact: true }).fill(`Edited description ${stamp}`);
  await card(second.page, title).getByRole("combobox", { name: `Assign ${title}`, exact: true }).selectOption(secondId);
  await until(() => readTasks(tasks.doc).find((task) => task.title === title)?.assigneeId === secondId);
  await editing.getByRole("button", { name: "Save changes", exact: true }).click();
  await until(() => readTasks(tasks.doc).find((task) => task.title === title)?.description === `Edited description ${stamp}`);
  check("saving a description preserves another person's concurrent assignment", readTasks(tasks.doc).find((task) => task.title === title)?.assigneeId === secondId);
  stage = "assignee and code filters";
  await board(second.page).getByRole("combobox", { name: "Task filter", exact: true }).selectOption("mine");
  await card(second.page, title).waitFor();
  check("assignment is shared and Only mine includes the assignee", readTasks(tasks.doc).find((task) => task.title === title)?.assigneeId === secondId);
  await board(second.page).getByRole("combobox", { name: "Task filter", exact: true }).selectOption("code");
  await card(second.page, title).waitFor({ state: "hidden" });
  check("the code filter excludes manual cards", true);
  await board(second.page).getByRole("combobox", { name: "Task filter", exact: true }).selectOption("all");

  stage = "code task scanning and line navigation";
  await board(first.page).getByRole("button", { name: "Close task board", exact: true }).click();
  await first.page.getByRole("button", { name: "New file", exact: true }).click();
  await first.page.getByPlaceholder("name.ext", { exact: true }).fill(filename);
  await first.page.getByPlaceholder("name.ext", { exact: true }).press("Enter");
  await first.page.getByRole("tab", { name: new RegExp(filename.replaceAll(".", "\\.")) }).waitFor();
  await until(() => Boolean(findByPath(files.doc, filename)));
  fixtureFileId = findByPath(files.doc, filename).id;
  await writeFile(`\n// TODO: ${codeTitle}\n`);
  await card(second.page, codeTitle).waitFor();
  check("a typed TODO appears as one computed code card", await card(second.page, codeTitle).count() === 1);
  check("opening the board does not persist duplicate code cards", ![...taskMaps(tasks.doc).cards.values()].some((task) => task.source?.fileId === fixtureFileId));
  await openBoard(first.page);
  await card(first.page, codeTitle).getByRole("button", { name: `Open ${filename}:2`, exact: true }).click();
  await first.page.getByText(/^Ln 2, Col \d+$/, { exact: true }).waitFor();
  check("a code-card link opens the matching file and line", !await board(first.page).count());
  await writeFile("\n");
  await card(second.page, codeTitle).waitFor({ state: "hidden" });
  check("removing an untouched comment removes its card", true);

  stage = "code state and orphan lifecycle";
  await writeFile(`// TODO: ${doingTitle}\n// FIXME: ${doneTitle}\n`);
  await card(second.page, doingTitle).waitFor();
  await card(second.page, doingTitle).focus();
  await card(second.page, doingTitle).press("ArrowRight");
  await column(second.page, "Doing").getByRole("group", { name: `Task: ${doingTitle}`, exact: true }).waitFor();
  await card(second.page, doneTitle).focus();
  await card(second.page, doneTitle).press("ArrowRight");
  await column(second.page, "Doing").getByRole("group", { name: `Task: ${doneTitle}`, exact: true }).waitFor();
  await card(second.page, doneTitle).focus();
  await card(second.page, doneTitle).press("ArrowRight");
  await column(second.page, "Done").getByRole("group", { name: `Task: ${doneTitle}`, exact: true }).waitFor();
  await until(() => [...taskMaps(tasks.doc).cards.values()].filter((task) => task.source?.fileId === fixtureFileId).length === 2);
  rememberOwned();
  await board(second.page).getByRole("button", { name: "Close task board", exact: true }).click();
  await openBoard(second.page);
  check("reopening a board does not mark an unchecked Doing card as removed", await card(second.page, doingTitle).getByText("No longer in the code", { exact: true }).count() === 0);
  await card(second.page, doingTitle).waitFor();
  await writeFile(`\n// TODO: ${doingTitle}\n// FIXME: ${doneTitle}\n`);
  await card(second.page, doingTitle).getByRole("button", { name: `Open ${filename}:2`, exact: true }).waitFor();
  check("code-card state survives lines moving", await column(second.page, "Doing").getByRole("group", { name: `Task: ${doingTitle}`, exact: true }).count() === 1);
  stage = "remove comments and retain the Doing orphan";
  await writeFile("\n");
  await card(second.page, doingTitle).getByText("No longer in the code", { exact: true }).waitFor();
  stage = "remove the missing Done card";
  await card(second.page, doneTitle).waitFor({ state: "hidden" });
  check("missing Doing stays marked while missing Done disappears", true);

  stage = "viewer UI and collab write refusal";
  await role("viewer"); roleChanged = true;
  viewer = await signIn("test2@codechatter.local");
  await openBoard(viewer.page);
  await card(viewer.page, title).waitFor();
  const view = board(viewer.page);
  check("a viewer sees the board without mutation controls", await view.getByRole("button", { name: /^Add to |^Move |^Edit |^Delete |^Assign / }).count() === 0 && await view.getByText("You can read this board. Editing tasks needs file-editing permission.", { exact: true }).count() === 1);
  attacker = await connect(viewer.context, "tasks"); open.push(attacker);
  const probe = `task-board-probe-${stamp}`;
  attacker.doc.getMap("task-board-access-probe").set(probe, "viewer write must be refused");
  await pause(500);
  const freshOwner = await connect(first.context, "tasks"); open.push(freshOwner);
  check("collab refuses a viewer write and does not persist it", !tasks.doc.getMap("task-board-access-probe").has(probe) && !freshOwner.doc.getMap("task-board-access-probe").has(probe));
  // Destroy the intentionally dirty read-only peer before any role promotion:
  // otherwise its rejected local update could replay on reauthentication.
  attacker.close();
  // If this check fails, still remove only the unique probe as the owner.
  freshOwner.doc.getMap("task-board-access-probe").delete(probe);
} catch (error) {
  check(`task-board workflow completes (${stage})`, false, error?.name ?? "Error");
} finally {
  attacker?.close();
  if (viewer) await viewer.context.close().catch(() => {});
  if (second) await second.context.close().catch(() => {});
  if (roleChanged && first && originalRole) {
    try {
      await role(originalRole);
      const people = await first.context.request.get(`${BASE}/api/rooms/${ROOM}/people`).then((response) => response.json());
      const restored = people.members.find((member) => member.id === secondId)?.role === originalRole;
      roleChanged = !restored;
      check("the seeded member role is restored", restored);
    }
    catch { check("the seeded member role is restored", false); }
  }
  try {
    cleanupStage = "remove owned task state";
    if (tasks) { rememberOwned(); for (const id of ownedIds) deleteTask(tasks.doc, id); }
    if (tasks) tasks.doc.getMap("task-board-access-probe").delete(`task-board-probe-${stamp}`);
    cleanupStage = "remove fixture file";
    if (files && fixtureFileId) trash(files.doc, fixtureFileId);
    if (tasks && first) {
      cleanupStage = "verify task state with a fresh peer";
      const confirm = await connect(first.context, "tasks"); open.push(confirm);
      await until(() => [...ownedIds].every((id) => Object.values(taskMaps(confirm.doc)).every((map) => !map.has(id))));
      await until(() => !confirm.doc.getMap("task-board-access-probe").has(`task-board-probe-${stamp}`));
    }
    check("all owned card state is removed", !tasks || [...ownedIds].every((id) => Object.values(taskMaps(tasks.doc)).every((map) => !map.has(id))));
    if (files && first) {
      cleanupStage = "verify source file with a fresh peer";
      const confirm = await connect(first.context, "files"); open.push(confirm);
      await until(() => !findByPath(confirm.doc, filename));
    }
    check("the fixture source file is removed", !files || !findByPath(files.doc, filename));
  } catch (error) { check("task-board fixture cleanup completes", false, `${cleanupStage}: ${error?.name ?? "Error"}`); }
  for (const connection of open.reverse()) connection.close();
  await browser.close();
}
// Report only known error categories: a browser exception may contain source
// text, request data or credentials, so never echo an arbitrary message.
const errorKinds = errors.map((error) => {
  const property = /Cannot read properties of (?:null|undefined) \(reading '([A-Za-z_]{1,30})'\)/.exec(error);
  if (property) return `null/undefined property: ${property[1]}`;
  if (/Maximum update depth/.test(error)) return "React update depth";
  if (/Invalid hook call/.test(error)) return "React hook call";
  if (/Yjs|Y\.Doc/.test(error)) return "Yjs client error";
  return "other page error";
});
check("no browser page errors", errors.length === 0, [...new Set(errorKinds)].join(", "));
finish();
