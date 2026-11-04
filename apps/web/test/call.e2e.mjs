// Calls (roadmap §5: video and voice on LiveKit), with two people in E2ETST and the browser's fake camera and
// microphone. test1 joins: the dock says it's just them, and test2's Call button counts one in the call. test2 joins
// and both see two tiles. test1's camera reaches test2 as video (media through the dev stack's LiveKit), test2's
// muted microphone shows on test1's side, and leaving takes each out.
//   node test/call.e2e.mjs        (from apps/web, with the dev stack running, LiveKit included: pnpm infra:up)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const one = await signIn("test1@codechatter.local");
const two = await signIn("test2@codechatter.local");
for (const { context } of [one, two]) await context.grantPermissions(["camera", "microphone"]);
const a = one.page;
const b = two.page;
const dock = (page) => page.getByRole("region", { name: "Call" });
const tile = (page, name) => dock(page).getByRole("list", { name: "People in the call" }).getByRole("group", { name: new RegExp(`^${name}`) });

try {
  await a.getByRole("button", { name: "Call", exact: true }).click();
  check("joined", await ok(dock(a).getByText("Just you in the call").waitFor({ timeout: 20_000 })), await dock(a).innerText().catch(() => "(no dock)"));
  check("othersSeeWhoIsIn", await ok(b.getByRole("button", { name: "Join call (1)" }).waitFor({ timeout: 10_000 })));

  await b.getByRole("button", { name: "Join call (1)" }).click();
  check("bothInCall", (await ok(dock(a).getByText("2 in the call").waitFor({ timeout: 20_000 }))) && (await ok(dock(b).getByText("2 in the call").waitFor({ timeout: 10_000 }))));
  check("tilesForEach", (await tile(a, "test2").count()) === 1 && (await tile(b, "test1").count()) === 1);

  // test1's camera: video in test1's tile on test2's side.
  await dock(a).getByRole("button", { name: "Turn your camera on" }).click();
  check("cameraReachesOthers", await ok(tile(b, "test1").locator("video").waitFor({ timeout: 30_000 })));
  const playing = await tile(b, "test1")
    .locator("video")
    .evaluate((video) => new Promise((resolve) => (video.readyState >= 2 ? resolve(true) : video.addEventListener("loadeddata", () => resolve(true), { once: true }), setTimeout(() => resolve(false), 15_000))));
  check("videoPlays", playing);
  await b.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "call.png") });

  // test2 mutes: test1 sees it.
  await dock(b).getByRole("button", { name: "Mute your microphone" }).click();
  check("muteShows", await ok(tile(a, "test2").getByLabel("Microphone off").waitFor({ timeout: 15_000 })));

  // Leaving.
  await dock(b).getByRole("button", { name: "Leave" }).click();
  check("leaveTakesThemOut", (await ok(dock(a).getByText("Just you in the call").waitFor({ timeout: 20_000 }))) && (await dock(b).count()) === 0);
  await dock(a).getByRole("button", { name: "Leave" }).click();
  check("lastOneLeaves", await ok(dock(a).waitFor({ state: "detached", timeout: 10_000 })));
} catch (error) {
  const shot = join(tmpdir(), "call-failed.png");
  await b.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
