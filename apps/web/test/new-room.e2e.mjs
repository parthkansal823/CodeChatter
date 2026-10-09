// Creating a room: the form, then the invite step, which must fit its dialog at desktop and phone widths
// (a long invite link once stretched the dialog's grid and pushed the copy button and Open room outside it).
// The room it makes is deleted at the end.
//   node test/new-room.e2e.mjs      (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

const { browser, errors, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");
let roomId = null;

/** Whether each named element sits wholly inside the dialog, and the link shows all of itself. */
async function fits() {
  const dialog = await page.getByRole("dialog").boundingBox();
  const parts = {
    link: await page.locator("code", { hasText: "?invite=" }).boundingBox(),
    copy: await page.getByRole("button", { name: "Copy invite link" }).boundingBox(),
    open: await page.getByRole("button", { name: "Open room" }).boundingBox(),
  };
  const outside = Object.entries(parts)
    .filter(([, box]) => !box || box.x < dialog.x || box.x + box.width > dialog.x + dialog.width + 0.5 || box.y + box.height > dialog.y + dialog.height + 0.5)
    .map(([name]) => name);
  const hidden = await page.locator("code", { hasText: "?invite=" }).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  return { ok: outside.length === 0 && !hidden, detail: `${outside.length ? `outside: ${outside.join(", ")}` : "inside"}${hidden ? "; link cut off" : ""}` };
}

try {
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: "New room" }).click();
  await page.getByLabel("Name").fill(`Layout check ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Create room" }).click();
  await page.getByRole("heading", { name: /is ready$/ }).waitFor({ timeout: 30_000 });
  roomId = /Room code (\w{6})/.exec(await page.getByRole("dialog").innerText())?.[1] ?? null;

  const wide = await fits();
  check("inviteStepFitsItsDialog", wide.ok, wide.detail);
  await page.screenshot({ path: join(tmpdir(), "new-room-wide.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const narrow = await fits();
  check("fitsAtPhoneWidth", narrow.ok, narrow.detail);
  await page.screenshot({ path: join(tmpdir(), "new-room-phone.png") });
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  if (roomId) {
    const status = await page.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE", credentials: "same-origin" }).then((r) => r.status), roomId);
    check("testRoomDeleted", status < 300, `${roomId}: ${status}`);
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
