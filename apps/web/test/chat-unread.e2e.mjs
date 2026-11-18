/** Verify real unread visibility, cross-device counts and literal room search; delete only this suite's messages even after failure. */
// From apps/web with the shared stack running: node test/chat-unread.e2e.mjs
import { io } from "socket.io-client";

import { BASE, ROOM, check, finish, launch } from "./browser.mjs";

if (ROOM !== "E2ETST") throw new Error("This suite only changes seeded E2ETST chat");
const stamp = Date.now().toString(36);
const prefix = `chat_${stamp}`;
const oldWord = `Legacyneedle_${stamp}`;
const batchWord = `Batch_${stamp}`;
const percentWord = `Percent_${stamp}`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, timeout = 20_000) {
  const end = Date.now() + timeout;
  do { if (await probe()) return; await pause(75); } while (Date.now() < end);
  throw new Error("Chat fixture state did not settle");
}

const { browser, errors, signIn } = await launch();
const sockets = [];
const profiles = [];
const owned = new Map();
let author, reader, otherDevice, dashboard, speaker, ownSpeaker;
let stage = "sign in";
let oldMessage;

async function call(profile, suffix, options = {}) {
  const response = await profile.context.request.fetch(`${BASE}/api/rooms/${ROOM}/messages${suffix}`, {
    ...options, headers: { origin: new URL(BASE).origin, ...options.headers },
  });
  if (!response.ok()) throw new Error(`Chat request failed with ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}
async function socketOf(profile) {
  const cookie = (await profile.context.cookies(BASE)).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  const socket = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { origin: new URL(BASE).origin, cookie }, reconnection: false });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chat peer did not connect")), 15_000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", () => { clearTimeout(timer); reject(new Error("Chat peer was refused")); });
  });
  if (!(await socket.timeout(8000).emitWithAck("room:join", ROOM)).ok) throw new Error("Chat peer could not join");
  return socket;
}
async function say(profile, socket, body, clientId = crypto.randomUUID()) {
  const result = await socket.timeout(8000).emitWithAck("chat:send", { roomId: ROOM, body, clientId });
  if (!result.ok) throw new Error("Chat fixture could not be sent");
  owned.set(result.data.id, profile);
  return result.data;
}
const chatButton = (page) => page.locator("header").getByRole("group", { name: "Side panel", exact: true }).getByRole("button", { name: /^Chat(?:,|$)/ });
async function closeChat(page) {
  const button = chatButton(page);
  if (await button.getAttribute("aria-pressed") === "true") await button.click();
}
async function openChat(page) {
  await page.bringToFront();
  if (await chatButton(page).getAttribute("aria-pressed") !== "true") await chatButton(page).click();
  await page.getByRole("log", { name: "Room chat", exact: true }).waitFor();
}
async function countOnButton(page, count) {
  const name = count > 99 ? "Chat, 99+ unread" : count ? `Chat, ${count} unread` : "Chat";
  await until(() => chatButton(page).getAttribute("aria-label").then((label) => label === name));
}
async function search(page, query) {
  await page.getByRole("textbox", { name: "Search room chat", exact: true }).fill(query);
  await page.getByRole("button", { name: "Search chat", exact: true }).click();
  return page.getByRole("region", { name: "Chat search results", exact: true });
}
async function inView(page, messageId) {
  return page.locator(`[data-message-id="${messageId}"]`).evaluate((row) => {
    const log = row.closest('[role="log"]');
    if (!log) return false;
    const a = row.getBoundingClientRect(), b = log.getBoundingClientRect();
    return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
  }).catch(() => false);
}

/** Discover acknowledged and unacknowledged owned sends by their unique fixture text before deleting by stable message ID. */
async function rememberOwned(profile) {
  let before;
  for (let page = 0; page < 20; page++) {
    const result = await call(profile, `/search?q=${encodeURIComponent(prefix)}${before ? `&before=${before}` : ""}`);
    for (const message of result.messages) if (message.author?.id === profile.userId && message.body.includes(prefix)) owned.set(message.id, profile);
    if (!result.hasMore || !result.nextBefore) return;
    before = result.nextBefore;
  }
  throw new Error("Too many fixture pages to clean safely");
}

try {
  author = await signIn("test1@codechatter.local"); profiles.push(author);
  reader = await signIn("test2@codechatter.local"); profiles.push(reader);
  otherDevice = await signIn("test2@codechatter.local"); profiles.push(otherDevice);
  for (const profile of profiles) {
    profile.page.setDefaultTimeout(20_000);
    profile.userId = (await profile.context.request.get(`${BASE}/api/me`).then((response) => response.json())).user.id;
  }
  await closeChat(reader.page);
  await closeChat(otherDevice.page);
  speaker = await socketOf(author);
  ownSpeaker = await socketOf(reader);

  stage = "old-message fixtures and a clean unread baseline";
  oldMessage = await say(author, speaker, `${prefix} ${oldWord} explains an old decision`);
  await say(author, speaker, `${prefix} ${percentWord} budget 25% token_value`);
  await say(author, speaker, `${prefix} ${percentWord} budget 25x tokenXvalue`);
  for (let index = 0; index < 54; index++) await say(author, speaker, `${prefix} ${batchWord} filler ${String(index).padStart(2, "0")}`);
  // The suite advances only the seeded test account's E2ETST cursor to establish its baseline.
  const latest = (await call(reader, "?limit=1"))[0];
  await call(reader, "/read", { method: "POST", data: { messageId: latest.id } });
  await countOnButton(reader.page, 0);
  await countOnButton(otherDevice.page, 0);

  stage = "dashboard batch count and three real UI sends";
  dashboard = await reader.context.newPage();
  dashboard.on("pageerror", () => errors.push("dashboard page error"));
  let perRoomDashboardRequests = 0;
  dashboard.on("request", (request) => { if (/\/api\/rooms\/[A-Z0-9]{6}\/messages\/unread$/.test(new URL(request.url()).pathname)) perRoomDashboardRequests++; });
  await dashboard.goto(`${BASE}/dashboard`);
  const roomRow = dashboard.getByRole("row").filter({ hasText: ROOM });
  await roomRow.waitFor();
  await openChat(author.page);
  for (let index = 1; index <= 3; index++) {
    const body = `${prefix} new message ${index}`;
    await author.page.getByRole("textbox", { name: "Message", exact: true }).fill(body);
    await author.page.getByRole("button", { name: "Send message", exact: true }).click();
    await until(async () => {
      const result = await call(author, `/search?q=${encodeURIComponent(body)}`);
      const message = result.messages.find((item) => item.body === body);
      if (message) owned.set(message.id, author);
      return Boolean(message);
    });
  }
  await countOnButton(reader.page, 3);
  await countOnButton(otherDevice.page, 3);
  await roomRow.getByLabel("3 unread messages", { exact: true }).waitFor();
  check("three messages update the closed chat button and a second device live", true);
  check("dashboard shows three and uses a batch request instead of per-room requests", perRoomDashboardRequests === 0);

  const recent = (await call(author, `/search?q=${encodeURIComponent(`${prefix} new message`)}`)).messages;
  await say(author, speaker, recent[0].body, recent[0].clientId);
  await countOnButton(reader.page, 3);
  const self = await say(reader, ownSpeaker, `${prefix} my own message`);
  await until(async () => (await call(reader, "/unread")).count === 3);
  check("a retried send and the reader's own message do not add unread", true);

  stage = "visible reading batches once and clears every device";
  const marks = [];
  reader.page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === `/api/rooms/${ROOM}/messages/read`) marks.push(request); });
  await openChat(reader.page);
  await reader.page.getByText("New messages", { exact: true }).waitFor();
  check("opening the conversation shows its first-unread divider", true);
  await countOnButton(reader.page, 0);
  await countOnButton(otherDevice.page, 0);
  await roomRow.getByLabel("3 unread messages", { exact: true }).waitFor({ state: "hidden" });
  await pause(1000);
  check("on-screen messages are marked in one request and clear the other device/dashboard", marks.length === 1);
  const beforeOldRead = await call(reader, "/unread");
  await call(reader, "/read", { method: "POST", data: { messageId: oldMessage.id } });
  const afterOldRead = await call(reader, "/unread");
  check("an older device cannot move the read cursor backwards", afterOldRead.readThroughId === beforeOldRead.readThroughId && afterOldRead.count === 0);
  owned.set(self.id, reader);

  stage = "old search result opens in the conversation";
  const results = await search(reader.page, oldWord.toUpperCase());
  const resultButton = results.getByRole("button").filter({ hasText: oldWord });
  await resultButton.waitFor();
  check("case-insensitive search highlights words and shows author/time", await resultButton.locator("mark").count() > 0 && (await resultButton.innerText()).includes("test1"));
  await resultButton.click();
  await until(() => inView(reader.page, oldMessage.id));
  const around = await call(reader, `/context?around=${oldMessage.id}`);
  check("a result older than the latest history opens with surrounding messages", around.messages.length > 1 && around.messages.some((item) => item.id === oldMessage.id));

  stage = "literal symbols and paginated search";
  const literal = await search(reader.page, `${percentWord} %`);
  await literal.getByRole("button").filter({ hasText: "25%" }).waitFor();
  check("percent is searched as itself", await literal.getByRole("button").filter({ hasText: "25x" }).count() === 0);
  const underscore = await call(reader, `/search?q=${encodeURIComponent(`${percentWord} token_value`)}`);
  check("underscore is searched as itself", underscore.messages.length === 1 && underscore.messages[0].body.includes("token_value"));
  const paged = await search(reader.page, batchWord);
  await paged.getByRole("button", { name: "More results", exact: true }).waitFor();
  await paged.getByRole("button", { name: "More results", exact: true }).click();
  await until(() => paged.getByRole("button").filter({ hasText: batchWord }).count().then((count) => count === 54));
  check("More fetches the next 50-message search page without duplicates", true);

  stage = "deleting counted messages updates every device";
  await closeChat(reader.page);
  const deleted = await say(author, speaker, `${prefix} delete while unread`);
  await countOnButton(reader.page, 1);
  await call(author, `/${deleted.id}`, { method: "DELETE" });
  await countOnButton(reader.page, 0);
  await countOnButton(otherDevice.page, 0);
  const gone = await call(reader, `/search?q=${encodeURIComponent(`${prefix} delete while unread`)}`);
  check("deleted messages stop counting and cannot be found", !gone.messages.some((item) => item.id === deleted.id));

  stage = "many unread messages cannot be cleared without being seen";
  const overflow = [];
  for (let index = 0; index < 103; index++) overflow.push(await say(author, speaker, `${prefix} overflow ${index}`));
  await countOnButton(reader.page, 100);
  check("the title-bar count caps at 99+", true);
  await openChat(reader.page);
  await reader.page.getByText("New messages", { exact: true }).waitFor();
  await until(() => inView(reader.page, overflow[0].id));
  await until(async () => (await call(reader, "/unread")).readThroughId > beforeOldRead.readThroughId);
  const partial = await call(reader, "/unread");
  check("opening far-back unread starts at the divider and preserves unseen later messages", partial.count > 0 && partial.readThroughId < overflow.at(-1).id);
  // Avoid reading more while cleanup changes the conversation.
  await closeChat(reader.page);
} catch (error) {
  await reader?.page.screenshot({ path: `${process.env.TEMP}/codechatter-chat-unread-failure.png` }).catch(() => {});
  check(`chat unread/search workflow completes (${stage})`, false, error?.name ?? "Error");
} finally {
  for (const socket of sockets) socket.close();
  try {
    for (const profile of [author, reader].filter(Boolean)) await rememberOwned(profile);
    for (const [id, profile] of owned) await call(profile, `/${id}`, { method: "DELETE" });
    for (const profile of [author, reader].filter(Boolean)) {
      const remaining = await call(profile, `/search?q=${encodeURIComponent(prefix)}`);
      if (remaining.messages.some((message) => message.author?.id === profile.userId)) throw new Error("Owned messages remain");
    }
    check("all owned messages are removed, including after failure", true);
  } catch { check("all owned messages are removed, including after failure", false); }
  await browser.close();
}
check("no browser page errors", errors.length === 0, errors.length ? `${errors.length} page errors` : "");
finish();
