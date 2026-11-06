// Public rooms (roadmap §5). test1 makes a room with a file and switches it to public from the lock in the title bar.
// test2, not in it, finds it in Explore and opens it read-only (no New file), then forks it: a new private room of
// test2's, marked "forked from", with the file's text. When test1 makes the room private again, test2 can't open it.
// Both rooms are deleted at the end.
//   node test/public-rooms.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { io } from "socket.io-client";

import { BASE, check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const name = `Public e2e ${stamp}`;
const file = `hello_${stamp}.py`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const one = await signIn("test1@codechatter.local");
const a = one.page;
await one.context.grantPermissions(["clipboard-read", "clipboard-write"]);
const { page: b } = await signIn("test2@codechatter.local");
const rooms = [];
const call = (page, path, init) =>
  page.evaluate(
    ([p, i]) => fetch(p, { ...i, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })),
    [path, init],
  );

try {
  // test1's room, with a file.
  const made = await call(a, "/api/rooms", { method: "POST", body: JSON.stringify({ name }) });
  const roomId = made.json?.id;
  rooms.push([a, roomId]);
  await a.goto(`${BASE}/rooms/${roomId}`);
  await a.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
  await a.locator(".monaco-editor .view-lines:visible").first().click();
  await a.evaluate((text) => navigator.clipboard.writeText(text), `print("forked ${stamp}")\n`);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(1_000);

  // Public, from the lock.
  await a.getByRole("button", { name: "Private room: change who can see it" }).click();
  await a.getByRole("menuitem", { name: /^Public/ }).click();
  check("madePublic", await ok(a.getByRole("button", { name: "Public room: change who can see it" }).waitFor({ timeout: 10_000 })));

  // test2 finds it in Explore and opens it read-only.
  await b.goto(`${BASE}/explore`);
  await b.getByLabel("Search public rooms").fill(stamp);
  const listed = b.getByRole("list", { name: "Public rooms" }).getByRole("link", { name: new RegExp(escape(name)) });
  check("listedInExplore", await ok(listed.waitFor({ timeout: 15_000 })));
  await listed.click();
  await b.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  check("visitorCanLook", await ok(b.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) }).waitFor({ timeout: 15_000 })));
  check("visitorIsReadOnly", (await b.getByRole("button", { name: "New file" }).count()) === 0);
  await b.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "public-room.png") });

  // test2 forks it.
  await b.getByRole("button", { name: "Fork", exact: true }).click();
  const dialog = b.getByRole("dialog", { name: `Fork ${name}` });
  await dialog.getByLabel("New room's name").fill(`My fork ${stamp}`);
  await dialog.getByRole("button", { name: "Fork", exact: true }).click();
  await b.waitForURL((url) => !url.pathname.endsWith(roomId) && /\/rooms\/[A-Z0-9]{6}$/.test(url.pathname), { timeout: 60_000 });
  const forkId = new URL(b.url()).pathname.split("/").pop();
  rooms.push([b, forkId]);
  await b.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  check("forkSaysWhere", await ok(b.getByRole("link", { name: `forked from ${name}` }).waitFor({ timeout: 10_000 })));
  await b.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) }).click();
  check("forkHasTheCode", await ok(b.locator(".monaco-editor .view-lines:visible").first().getByText(`forked ${stamp}`).waitFor({ timeout: 15_000 })));
  check("forkIsPrivateAndTheirs", await ok(b.getByRole("button", { name: "Private room: change who can see it" }).waitFor({ timeout: 5_000 })) && (await b.getByRole("button", { name: "New file" }).count()) === 1);

  // test2 goes back to watch, with chat listening, as the room's page does.
  await b.goto(`${BASE}/rooms/${roomId}`);
  await b.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  const socketOf = async (page) => {
    const cookies = await page.context().cookies();
    const socket = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { origin: BASE, cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  };
  const speaker = await socketOf(a);
  const listener = await socketOf(b);
  const heard = [];
  listener.on("chat:message", (message) => heard.push(message.body));
  await speaker.emitWithAck("room:join", roomId);
  check("aVisitorCanListen", (await listener.emitWithAck("room:join", roomId)).ok === true);
  const say = async (body) => {
    const sent = await speaker.timeout(8000).emitWithAck("chat:send", { roomId, body, clientId: crypto.randomUUID() });
    if (!sent.ok) throw new Error(`chat: ${sent.error}`);
  };
  await say("while public");
  check("aVisitorHearsChat", await ok(new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (heard.includes("while public")) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > 8000) { clearInterval(timer); reject(new Error("nothing heard")); }
    }, 100);
  })));

  // Private again: test2 can't open test1's room.
  await a.getByRole("button", { name: "Public room: change who can see it" }).click();
  await a.getByRole("menuitem", { name: /^Private/ }).click();
  await a.getByRole("button", { name: "Private room: change who can see it" }).waitFor({ timeout: 10_000 });
  const closed = await call(b, `/api/rooms/${roomId}`);
  check("privateAgainIsClosed", closed.status === 404, closed.status);
  // And if they already had it open, it closes on them.
  check("aWatchingVisitorIsToldItsGone", await ok(b.getByRole("heading", { name: "You no longer have access to this room" }).waitFor({ timeout: 20_000 })));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await say("after private");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  check("theyStopHearingChat", !heard.includes("after private"), heard.join(", "));
  speaker.close();
  listener.close();
} catch (error) {
  const shot = join(tmpdir(), "public-rooms-failed.png");
  await b.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  const gone = [];
  for (const [page, id] of rooms) {
    if (!id) continue;
    gone.push((await call(page, `/api/rooms/${id}`, { method: "DELETE" }).catch(() => ({ status: 0 }))).status);
  }
  check("roomsDeleted", gone.every((status) => status === 204), gone.join(", "));
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
