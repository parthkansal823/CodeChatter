/**
 * Share one test tab through the real call UI and verify remote decoded frames.
 * Edge's Chromium tab-title picker flag avoids capturing the owner's desktop.
 * Run from apps/web with the shared dev stack: node test/call-screen-share.e2e.mjs
 */
import { check, finish, launch } from "./browser.mjs";

const captureTitle = "CodeChatter screen capture fixture";
let browser;
let errors = [];
const pages = [];
let stage = "launch";

function verify(name, value) {
  check(name, value);
  if (!value) throw new Error("CheckFailed");
}

const dock = (page) => page.getByRole("region", { name: "Call", exact: true });
const screen = (page) => dock(page).getByRole("group", { name: /^test1's screen$/ });

async function leave(page) {
  await dock(page).getByRole("button", { name: "Leave", exact: true }).click({ timeout: 3000 }).catch(() => {});
}

async function run() {
  const launched = await launch({ args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--auto-select-tab-capture-source-by-title=${captureTitle}`,
    "--auto-accept-this-tab-capture",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ] });
  browser = launched.browser;
  errors = launched.errors;
  stage = "sign-in";
  const one = await launched.signIn("test1@codechatter.local");
  const two = await launched.signIn("test2@codechatter.local");
  for (const { context, page } of [one, two]) {
    pages.push(page);
    await context.grantPermissions(["camera", "microphone"]);
  }
  const a = one.page;
  const b = two.page;
  stage = "join call";
  await a.getByRole("button", { name: "Call", exact: true }).click();
  await dock(a).getByText("Just you in the call", { exact: true }).waitFor({ timeout: 30_000 });
  await b.getByRole("button", { name: "Join call (1)", exact: true }).click();
  await dock(b).getByText("2 in the call", { exact: true }).waitFor({ timeout: 30_000 });
  await dock(a).getByText("2 in the call", { exact: true }).waitFor({ timeout: 30_000 });
  verify("two people joined for screen sharing", await dock(a).getByText("2 in the call", { exact: true }).isVisible());
  stage = "automatic test-tab capture";
  await a.evaluate((title) => {
    document.title = title;
    const marker = document.createElement("div");
    marker.id = "screen-capture-fixture";
    marker.style.cssText = "position:fixed;left:4px;top:4px;z-index:9999;padding:6px;background:var(--background);color:var(--foreground);pointer-events:none";
    document.body.append(marker);
    let frame = 0;
    window.__screenCaptureTicker = setInterval(() => { marker.textContent = `Capture frame ${++frame}`; }, 100);
  }, captureTitle);
  await a.bringToFront();
  await dock(a).getByRole("button", { name: "Share your screen", exact: true }).click();
  await dock(a).getByRole("button", { name: "Stop sharing your screen", exact: true }).waitFor({ timeout: 30_000 });
  const shared = screen(b);
  await shared.waitFor({ timeout: 30_000 });
  verify("remote participant sees the large shared-screen tile", await shared.evaluate((element) => element.classList.contains("aspect-video") && !element.closest('ul[aria-label="People in the call"]')));
  const video = shared.locator("video");
  await video.waitFor({ timeout: 20_000 });
  verify("shared screen receives increasing decoded frames", await video.evaluate(async (element) => {
    const frames = () => element.getVideoPlaybackQuality().totalVideoFrames;
    const before = frames();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (element.videoWidth > 0 && element.videoHeight > 0 && frames() > before + 2) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }));
  stage = "stop screen sharing";
  await dock(a).getByRole("button", { name: "Stop sharing your screen", exact: true }).click();
  await shared.waitFor({ state: "detached", timeout: 20_000 });
  verify("stopping sharing removes the other participant's screen tile", await screen(b).count() === 0);
  verify("the call stays connected after sharing stops", await dock(b).getByText("2 in the call", { exact: true }).isVisible());
  await a.evaluate(() => { clearInterval(window.__screenCaptureTicker); document.getElementById("screen-capture-fixture")?.remove(); });
}

try { await run(); }
catch (error) { check("screen-share flow completes", false, `${stage}: ${error?.name ?? "Error"}`); }
finally {
  for (const page of pages) await leave(page);
  await browser?.close();
}
check("no browser page errors", errors.length === 0);
finish();
