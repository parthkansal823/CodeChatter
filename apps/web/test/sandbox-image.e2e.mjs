// The room's sandbox image in the Ports panel, two people in E2ETST: the owner switches the room to the base image
// (asked to confirm, as the sandbox restarts) and back to full; the editor sees which one it runs but can't switch.
// It needs a server with both images (SANDBOX_IMAGE_BASE and SANDBOX_IMAGE_FULL in .env); on one without, it says so
// and checks that the panel doesn't offer the choice. The room ends on the full image.
//   node test/sandbox-image.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const owner = (await signIn("test1@codechatter.local")).page;
const editor = (await signIn("test2@codechatter.local")).page;

async function openPorts(page) {
  await page.keyboard.press("Control+`");
  await page.getByRole("tab", { name: "Ports", exact: true }).click();
  await page.getByRole("region", { name: "Package installs" }).waitFor({ timeout: 15_000 });
  return page.getByRole("region", { name: "Sandbox image" });
}

try {
  const mine = await openPorts(owner);
  const theirs = await openPorts(editor);
  const offered = await ok(mine.waitFor({ timeout: 8_000 }));
  if (!offered) {
    console.log("SKIP  this server has one sandbox image (set SANDBOX_IMAGE_BASE and SANDBOX_IMAGE_FULL to offer the choice)");
    check("notOfferedWithOneImage", (await mine.count()) === 0);
  } else {
    const pick = (name) => mine.getByRole("group", { name: "Pick the image" }).getByRole("button", { name, exact: true });
    owner.once("dialog", (dialog) => void dialog.accept());
    await pick("Base").click();
    check("switchedToBase", await ok(owner.getByText("The sandbox restarted with the base image").waitFor({ timeout: 60_000 })));
    check("panelSaysBase", await ok(mine.getByText(/^Base: Python, JavaScript/).waitFor({ timeout: 15_000 })));
    check("editorSeesIt", await ok(theirs.getByText(/^Base: Python, JavaScript/).waitFor({ timeout: 15_000 })));
    check("editorCantSwitch", (await theirs.getByRole("group", { name: "Pick the image" }).count()) === 0);
    owner.once("dialog", (dialog) => void dialog.accept());
    await pick("Full").click();
    check("switchedBackToFull", await ok(owner.getByText("The sandbox restarted with the full image").waitFor({ timeout: 60_000 })));
    check("panelSaysFull", await ok(mine.getByText(/^Full: 24 more languages/).waitFor({ timeout: 15_000 })));
  }
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
