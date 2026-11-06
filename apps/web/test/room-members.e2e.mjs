// Managing a room's people in the browser, in a disposable room with test1 (owner) and test2. The Share menu's invite
// link and who can join; asking to join, and the waiting page opening the room by itself; roles changing live; someone
// removed cut off from the editor, chat and the call (the call by the server, even if their page ignores it); letting
// them back; a new link; declining; leaving.
//   node test/room-members.e2e.mjs        (from apps/web, with the dev stack running, LiveKit included: pnpm infra:up)
import { io } from "socket.io-client";

import { BASE, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const stamp = Date.now().toString(36);
const NAME = `Members ${stamp}`;
const CUT_OFF = "You no longer have access to this room";

const { browser, errors, signIn } = await launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const one = await signIn("test1@codechatter.local");
const two = await signIn("test2@codechatter.local");
for (const { context } of [one, two]) await context.grantPermissions(["camera", "microphone"]);
const a = one.page;
const b = two.page;

const created = await a.request.post(`${BASE}/api/rooms`, { data: { name: NAME, templateId: "blank" }, headers: { origin: BASE } });
const room = await created.json();
const roomUrl = `${BASE}/rooms/${room.id}`;
const tree = (page) => page.getByRole("tree", { name: "Files" });
const heading = (page, name) => page.getByRole("heading", { name });
const dock = (page) => page.getByRole("region", { name: "Call" });
const newFile = (page) => page.getByRole("button", { name: /new file/i }).first();
const peopleTab = (page) => page.getByRole("tab", { name: /^People/ });
/** The side panel may be closed: the avatars in the title bar open it on People. */
async function openPeople(page) {
  if (!(await peopleTab(page).isVisible())) await page.locator("header").getByRole("button", { name: /people here|waiting to join/ }).click();
  await peopleTab(page).click();
}
const members = (page) => page.getByRole("region", { name: "Members" });
const waiting = (page) => page.getByRole("region", { name: "Waiting to join" });
const removed = (page) => page.getByRole("region", { name: "Removed" });

/** Socket.IO as a person, as a page has it. */
async function socketOf(context) {
  const cookies = await context.cookies();
  const socket = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { origin: BASE, cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  await socket.emitWithAck("room:join", room.id);
  return socket;
}
const say = (socket, body) => socket.emitWithAck("chat:send", { roomId: room.id, clientId: crypto.randomUUID(), body });

async function shareLink(page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const code = page.getByTestId("invite-link");
  await ok(page.waitForFunction(() => document.querySelector("[data-testid=invite-link]")?.textContent?.includes("invite="), null, { timeout: 15_000 }));
  return (await code.innerText()).trim();
}
const choose = async (page, combobox, option) => {
  await page.getByRole("combobox", { name: combobox }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
/** They open the link and wait; the owner approves them; they're in the room. */
async function askAndApprove(link) {
  await b.goto(link);
  await heading(b, `Waiting to join ${NAME}`).waitFor({ timeout: 30_000 });
  await a.getByRole("button", { name: "Approve test2" }).click({ timeout: 15_000 });
  await tree(b).waitFor({ timeout: 40_000 });
}

try {
  await a.goto(roomUrl);
  await tree(a).waitFor({ timeout: 60_000 });

  // Share: the link, again and again.
  const link = await shareLink(a);
  check("shareShowsTheInviteLink", link === `${roomUrl}?invite=${room.inviteToken}`, link);
  await choose(a, "Who can join", "People with the link, after you approve");
  check("whoCanJoinCanChange", await ok(a.getByText("People who open it wait for the owner to approve them.").waitFor({ timeout: 10_000 })));
  await a.keyboard.press("Escape");

  // Asking to join. The owner sees it with the side panel closed.
  await b.goto(link);
  check("theLinkWaits", await ok(heading(b, `Waiting to join ${NAME}`).waitFor({ timeout: 30_000 })));
  check("theOwnerSeesSomeoneAsk", await ok(a.locator("header").getByRole("button", { name: "1 waiting to join" }).waitFor({ timeout: 15_000 })));
  await openPeople(a);
  check("theTabCountsThem", await ok(a.getByRole("tab", { name: "People, 1 waiting to join" }).waitFor({ timeout: 15_000 })));
  check("withTheirEmail", await ok(waiting(a).getByText("test2@codechatter.local").waitFor({ timeout: 15_000 })));
  await waiting(a).getByRole("button", { name: "Approve test2" }).click();
  check("theWaitingPageOpensTheRoom", await ok(tree(b).waitFor({ timeout: 40_000 })));
  check("theTokenLeavesTheAddress", !b.url().includes("invite="), b.url());
  check("nobodyWaitsNow", await ok(a.getByRole("tab", { name: "People", exact: true }).waitFor({ timeout: 15_000 })));

  // Roles change live.
  await openPeople(b);
  check("everyoneSeesWhoBelongs", await ok(members(b).getByText("Owner").waitFor({ timeout: 15_000 })));
  check("editorsSeeNoControls", (await members(b).getByRole("combobox").count()) === 0 && (await members(b).getByRole("button", { name: /^Remove/ }).count()) === 0);
  check("anEditorCanMakeFiles", await ok(newFile(b).waitFor({ timeout: 15_000 })));
  await choose(a, "Role of test2", "Viewer");
  check("aViewerCantWithoutReloading", await ok(newFile(b).waitFor({ state: "detached", timeout: 20_000 })));
  await choose(a, "Role of test2", "Editor");
  check("andCanAgainWithoutReloading", await ok(newFile(b).waitFor({ timeout: 20_000 })));

  // Removing someone who's in the call and listening to the chat. Their page is made to ignore losing access,
  // so if they leave the call now, it's because the server took them out.
  // (Calls need WebRTC through LiveKit, which GitHub's runners don't promise: call.e2e.mjs isn't in CI either.)
  const inCall = !process.env.GITHUB_ACTIONS;
  if (inCall) {
    await a.getByRole("button", { name: "Call", exact: true }).click();
    await dock(a).getByText("Just you in the call").waitFor({ timeout: 30_000 });
    await b.getByRole("button", { name: "Join call (1)" }).click({ timeout: 20_000 });
    check("bothInTheCall", await ok(dock(b).getByText("2 in the call").waitFor({ timeout: 30_000 })));
  }
  const listener = await socketOf(two.context);
  const speaker = await socketOf(one.context);
  const heard = [];
  listener.on("chat:message", (message) => heard.push(message.body));
  await say(speaker, `before ${stamp}`);
  await sleep(800);
  check("theyHearTheChat", heard.includes(`before ${stamp}`));

  const summary = await (await b.request.get(`${BASE}/api/rooms/${room.id}`)).json();
  await b.route(`**/api/rooms/${room.id}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) }));
  await members(a).getByRole("button", { name: "Remove test2" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
  if (inCall) {
    check("theServerTakesThemOutOfTheCall", await ok(dock(b).waitFor({ state: "detached", timeout: 20_000 })));
    check("theOthersSeeThemGo", await ok(dock(a).getByText("Just you in the call").waitFor({ timeout: 20_000 })));
  }
  await sleep(500); // chat's listeners are rechecked as the news arrives
  await say(speaker, `after ${stamp}`);
  await sleep(800);
  check("theyStopHearingTheChat", !heard.includes(`after ${stamp}`), heard.join(", "));
  listener.close();
  speaker.close();
  await b.unroute(`**/api/rooms/${room.id}`);
  if (inCall) await dock(a).getByRole("button", { name: /leave/i }).click().catch(() => {});

  check("theyreOnTheRemovedList", await ok(removed(a).getByText("test2").waitFor({ timeout: 15_000 })));
  await b.goto(link);
  check("theLinkRefusesThem", await ok(heading(b, `You can’t join ${NAME}`).waitFor({ timeout: 30_000 })));

  // Letting them back, and cutting them off in a page that doesn't ignore it.
  await removed(a).getByRole("button", { name: "Let test2 back" }).click();
  check("theyLeaveTheList", await ok(removed(a).waitFor({ state: "detached", timeout: 15_000 })));
  await askAndApprove(link);
  check("theyCanComeBack", await ok(tree(b).waitFor({ timeout: 5000 })));
  await members(a).getByRole("button", { name: "Remove test2" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
  check("anOpenPageSaysSo", await ok(heading(b, CUT_OFF).waitFor({ timeout: 30_000 })));
  await removed(a).getByRole("button", { name: "Let test2 back" }).click();
  await removed(a).waitFor({ state: "detached", timeout: 15_000 });

  // A new link: the old one stops working.
  const newLink = await (async () => {
    await a.getByRole("button", { name: "Share", exact: true }).click();
    await a.getByRole("button", { name: "Make a new link" }).click();
    await a.getByRole("alertdialog").getByRole("button", { name: "Make a new link" }).click();
    await a.waitForFunction((old) => {
      const text = document.querySelector("[data-testid=invite-link]")?.textContent ?? "";
      return text.includes("invite=") && text !== old;
    }, link, { timeout: 15_000 });
    return (await a.getByTestId("invite-link").innerText()).trim();
  })();
  await a.keyboard.press("Escape");
  check("aNewLinkIsDifferent", newLink !== link && newLink.startsWith(`${roomUrl}?invite=`));
  await b.goto(link);
  check("theOldLinkIsDead", await ok(heading(b, "Nothing here").waitFor({ timeout: 30_000 })));

  // Declining: the waiting page says so by itself.
  await b.goto(newLink);
  await heading(b, `Waiting to join ${NAME}`).waitFor({ timeout: 30_000 });
  await waiting(a).getByRole("button", { name: "Decline test2" }).click({ timeout: 15_000 });
  check("declinedPeopleAreToldWhileWaiting", await ok(heading(b, `You can’t join ${NAME}`).waitFor({ timeout: 30_000 })));
  await removed(a).getByRole("button", { name: "Let test2 back" }).click();
  await removed(a).waitFor({ state: "detached", timeout: 15_000 });

  // Leaving.
  await askAndApprove(newLink);
  await openPeople(b);
  await b.getByRole("button", { name: "Leave room" }).click({ timeout: 15_000 });
  await b.getByRole("alertdialog").getByRole("button", { name: "Leave", exact: true }).click();
  check("leavingGoesToYourRooms", await ok(b.waitForURL(/\/dashboard/, { timeout: 30_000 })));
  check("theOwnerSeesThemGo", await ok(members(a).getByText("test2").waitFor({ state: "detached", timeout: 15_000 })));
  check("theOwnerHasNoLeaveButton", (await a.getByRole("button", { name: "Leave room" }).count()) === 0);

  await members(a).waitFor({ timeout: 5000 });
  await a.screenshot({ path: process.env.SHOT ?? `${process.env.SHOT_DIR ?? process.env.TEMP ?? "/tmp"}/room-members.png` });
} catch (error) {
  check("noUnexpectedError", false, String(error?.message ?? error).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 150));
  await b.screenshot({ path: `${process.env.SHOT_DIR ?? process.env.TEMP ?? "/tmp"}/room-members-b.png` }).catch(() => {});
  await a.screenshot({ path: `${process.env.SHOT_DIR ?? process.env.TEMP ?? "/tmp"}/room-members-a.png` }).catch(() => {});
} finally {
  await a.request.delete(`${BASE}/api/rooms/${room.id}`, { headers: { origin: BASE } }).catch(() => {});
}

await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
