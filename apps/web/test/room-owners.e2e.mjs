/** Verify room-owner confirmations and live handover in a disposable room, leaving seeded room roles and files untouched. */
import { BASE, PASSWORD, check, finish, launch, sleep } from "./browser.mjs";

const stamp = Date.now().toString(36);
const lastOwnerMessage = "Make someone else an owner before you step down or leave. You can still delete the room.";
let browser, errors, one, two, room, firstId, secondId, seededBefore;
let stage = "launch browser";

function verify(name, condition) {
  check(name, condition);
  if (!condition) throw new Error("CheckFailed");
}

async function until(operation, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await sleep(100);
  }
  throw new Error("ConditionTimeout");
}

async function request(profile, path, method = "GET", data) {
  const response = await profile.context.request.fetch(`${BASE}/api/${path}`, { method, headers: { origin: new URL(BASE).origin }, ...(data !== undefined && { data }) });
  const body = response.status() === 204 ? undefined : await response.json().catch(() => undefined);
  return { status: response.status(), body };
}

async function profile(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", () => errors.push("PageError"));
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const result = { context, page };
  const signedIn = await request(result, "auth/sign-in/email", "POST", { email, password: PASSWORD });
  if (signedIn.status !== 200) { await context.close(); throw Object.assign(new Error("SignInFailed"), { status: signedIn.status }); }
  return result;
}

async function members(profile = one, id = room.id) {
  const result = await request(profile, `rooms/${id}/members`);
  if (result.status !== 200) throw new Error("MembersUnavailable");
  return result.body.members;
}

const roleOf = async (id) => (await members()).find((member) => member.id === id)?.role;
const roster = (list) => JSON.stringify(list.map(({ id, role }) => ({ id, role })).sort((a, b) => a.id.localeCompare(b.id)));

async function openPeople(page) {
  const tab = page.getByRole("tab", { name: /^People/ });
  if (!await tab.isVisible()) await page.locator("header").getByRole("button", { name: /people here|waiting to join/ }).click();
  await tab.click();
  await page.getByRole("region", { name: "Members", exact: true }).waitFor();
}

async function chooseRole(page, name, role) {
  await page.getByRole("combobox", { name: `Role of ${name}`, exact: true }).click();
  await page.getByRole("option", { name: role, exact: true }).click();
}

async function promotion(page, name, id) {
  await chooseRole(page, name, "Owner");
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("heading", { name: `Make ${name} an owner?`, exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Make owner", exact: true }).click();
  await until(async () => await roleOf(id) === "owner");
}

async function handover(from, toName, expectedFirst, expectedSecond) {
  await from.page.getByRole("button", { name: "Hand this room to…", exact: true }).click();
  const dialog = from.page.getByRole("alertdialog");
  await dialog.getByRole("combobox", { name: "New room owner", exact: true }).click();
  await from.page.getByRole("option", { name: toName, exact: true }).click();
  await dialog.getByRole("button", { name: "Hand over room", exact: true }).click();
  await until(async () => await roleOf(firstId) === expectedFirst && await roleOf(secondId) === expectedSecond);
}

try {
  ({ browser, errors } = await launch());
  stage = "sign in test1";
  one = await profile("test1@codechatter.local");
  stage = "sign in test2";
  two = await profile("test2@codechatter.local");
  stage = "capture seeded roles";
  seededBefore = roster(await members(one, "E2ETST"));
  firstId = (await request(one, "me")).body.user.id;
  secondId = (await request(two, "me")).body.user.id;
  stage = "create disposable room";
  const created = await request(one, "rooms", "POST", { name: `Room owners ${stamp}`, templateId: "blank", joinPolicy: "invite" });
  room = created.body;
  verify("a disposable owner-test room is created", created.status === 201 && typeof room?.id === "string");
  const joined = await request(two, "rooms/join", "POST", { code: room.id, inviteToken: room.inviteToken });
  verify("the invited member starts as an editor", joined.status === 200 && joined.body.status === "joined" && await roleOf(secondId) === "editor");
  for (const person of [one, two]) {
    await person.page.goto(`${BASE}/rooms/${room.id}`);
    await person.page.getByRole("tree", { name: "Files", exact: true }).waitFor({ timeout: 60_000 });
    await openPeople(person.page);
  }

  stage = "last-owner explanation and promotion confirmation";
  await one.page.getByText(lastOwnerMessage, { exact: true }).waitFor();
  verify("the last owner sees why they cannot step down or leave", await one.page.getByRole("combobox", { name: "Role of test1", exact: true }).isDisabled() && await one.page.getByRole("button", { name: "Leave room", exact: true }).count() === 0);
  await chooseRole(one.page, "test2", "Owner");
  const promotionDialog = one.page.getByRole("alertdialog");
  await promotionDialog.getByRole("heading", { name: "Make test2 an owner?", exact: true }).waitFor();
  verify("owner promotion explains every management power before changing a role", await promotionDialog.getByText("An owner can delete this room, change everyone's role and remove anyone, including you.", { exact: true }).count() === 1 && await roleOf(secondId) === "editor");
  await promotionDialog.getByRole("button", { name: "Go back", exact: true }).click();
  verify("cancelling promotion leaves the member an editor", await roleOf(secondId) === "editor");
  await promotion(one.page, "test2", secondId);
  await two.page.getByRole("combobox", { name: "Role of test1", exact: true }).waitFor();
  await one.page.getByRole("button", { name: "Leave room", exact: true }).waitFor();
  await two.page.getByRole("button", { name: "Leave room", exact: true }).waitFor();
  verify("two owners appear live and both may leave", (await members()).filter((member) => member.role === "owner").length === 2 && await one.page.getByText(lastOwnerMessage, { exact: true }).count() === 0);
  verify("the new owner may manage the owner who promoted them", await two.page.getByRole("combobox", { name: "Role of test1", exact: true }).isEnabled() && await two.page.getByRole("button", { name: "Remove test1", exact: true }).isEnabled());

  stage = "owner removal confirmation";
  await one.page.getByRole("button", { name: "Remove test2", exact: true }).click();
  const removeDialog = one.page.getByRole("alertdialog");
  await removeDialog.getByRole("heading", { name: "Remove test2 from this room?", exact: true }).waitFor();
  await removeDialog.getByRole("button", { name: "Go back", exact: true }).click();
  verify("removing another owner still asks and can be cancelled", await roleOf(secondId) === "owner");

  stage = "handover confirmation and cancellation";
  await one.page.getByRole("button", { name: "Hand this room to…", exact: true }).click();
  const handoverDialog = one.page.getByRole("alertdialog");
  verify("handover requires choosing an active member before confirmation", await handoverDialog.getByRole("button", { name: "Hand over room", exact: true }).isDisabled());
  await handoverDialog.getByRole("combobox", { name: "New room owner", exact: true }).click();
  verify("handover lists the other active member and excludes yourself", await one.page.getByRole("option", { name: "test2", exact: true }).count() === 1 && await one.page.getByRole("option", { name: "test1", exact: true }).count() === 0);
  await one.page.getByRole("option", { name: "test2", exact: true }).click();
  await handoverDialog.getByRole("button", { name: "Go back", exact: true }).click();
  verify("cancelling handover keeps both roles", await roleOf(firstId) === "owner" && await roleOf(secondId) === "owner");
  await handover(one, "test2", "editor", "owner");
  await two.page.getByText(lastOwnerMessage, { exact: true }).waitFor();
  await until(async () => await one.page.getByRole("button", { name: "Hand this room to…", exact: true }).count() === 0);
  verify("handover to an existing owner steps the sender down live", await roleOf(firstId) === "editor" && await two.page.getByRole("button", { name: "Leave room", exact: true }).count() === 0);
  await handover(two, "test1", "owner", "editor");
  await one.page.getByText(lastOwnerMessage, { exact: true }).waitFor();
  verify("handover back restores the original room roles", await roleOf(firstId) === "owner" && await roleOf(secondId) === "editor");

  stage = "owner self-demotion with a second owner";
  await promotion(one.page, "test2", secondId);
  await one.page.getByRole("button", { name: "Leave room", exact: true }).waitFor();
  await chooseRole(one.page, "test1", "Editor");
  await until(async () => await roleOf(firstId) === "editor");
  await two.page.getByText(lastOwnerMessage, { exact: true }).waitFor();
  verify("an owner can step down when another active owner remains", await roleOf(secondId) === "owner");
  await promotion(two.page, "test1", firstId);
  await one.page.getByRole("button", { name: "Leave room", exact: true }).waitFor();

  stage = "owner leave confirmation";
  await one.page.getByRole("button", { name: "Leave room", exact: true }).click();
  const leaveDialog = one.page.getByRole("alertdialog");
  await leaveDialog.getByRole("button", { name: "Leave", exact: true }).click();
  await one.page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  await two.page.getByText(lastOwnerMessage, { exact: true }).waitFor();
  verify("an owner can leave and the remaining owner is protected", await two.page.getByRole("button", { name: "Leave room", exact: true }).count() === 0 && (await members(two)).filter((member) => member.role === "owner").length === 1);
} catch (error) {
  check(`room owner browser workflow completes (${stage})`, false, `${error?.name ?? "Error"}${typeof error?.status === "number" ? ` HTTP ${error.status}` : ""}`);
} finally {
  if (room?.id && one && two) {
    try {
      let removed = await request(one, `rooms/${room.id}`, "DELETE");
      if (removed.status !== 204) removed = await request(two, `rooms/${room.id}`, "DELETE");
      check("the disposable room is removed even after a failure", removed.status === 204 && (await request(two, `rooms/${room.id}`)).status === 404);
    } catch { check("the disposable room is removed even after a failure", false); }
  }
  if (one && seededBefore) {
    try { check("the shared seeded room roles remain unchanged", roster(await members(one, "E2ETST")) === seededBefore); }
    catch { check("the shared seeded room roles remain unchanged", false); }
  }
  for (const person of [one, two]) {
    if (!person) continue;
    await request(person, "auth/sign-out", "POST", {}).catch(() => {});
    await person.context.close().catch(() => {});
  }
  await browser?.close().catch(() => {});
}
check("no browser page errors", Boolean(errors) && errors.length === 0);
finish();
