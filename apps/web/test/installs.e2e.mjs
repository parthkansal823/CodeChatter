// Package installs from the Ports panel (ADR 0007): the owner allows them for an hour and turns them
// off again; an editor sees whether they're on, and who allowed them, but has no switch.
//   node test/installs.e2e.mjs      (from apps/web, with the dev stack running)
import { check, finish, launch } from "./browser.mjs";

const OFF = "Off. The sandbox has no internet.";
const { browser, errors, signIn } = await launch();
const owner = await signIn("test1@codechatter.local");
const editor = await signIn("test2@codechatter.local");

async function openPorts(page) {
  await page.keyboard.press("Control+`");
  await page.getByRole("tab", { name: "Ports", exact: true }).click();
  const box = page.getByRole("region", { name: "Package installs" });
  await box.waitFor({ timeout: 15_000 });
  return box;
}

try {
  const mine = await openPorts(owner.page);
  const theirs = await openPorts(editor.page);
  // Start from off, whatever an earlier run left.
  await mine.getByText(/^(Off|On until)/).waitFor({ timeout: 15_000 });
  if (await mine.getByRole("button", { name: "Turn off" }).isVisible()) await mine.getByRole("button", { name: "Turn off" }).click();
  await mine.getByText(OFF).waitFor({ timeout: 15_000 });
  check("ownerSeesOffAndTheSwitch", await mine.getByRole("button", { name: "Allow for an hour" }).isVisible());
  await theirs.getByText(OFF).waitFor({ timeout: 15_000 });
  check("editorHasNoSwitch", (await theirs.getByRole("button").count()) === 0 && (await theirs.getByText("The room's owner can turn them on.").isVisible()));
  check("registriesAreListed", /npm, PyPI, Go modules, crates\.io/.test(await mine.innerText()));

  await mine.getByRole("button", { name: "Allow for an hour" }).click();
  await mine.getByText(/^On until .*allowed by/).waitFor({ timeout: 30_000 });
  check("ownerAllowsInstalls", await mine.getByRole("button", { name: "Turn off" }).isVisible(), (await mine.innerText()).split("\n")[1]);
  // Everyone's panel polls, so the editor sees it within a few seconds.
  await theirs.getByText(/^On until .*allowed by/).waitFor({ timeout: 15_000 });
  check("editorSeesWhoAllowedThem", true, (await theirs.innerText()).split("\n")[1]);

  await mine.getByRole("button", { name: "Turn off" }).click();
  await mine.getByText(OFF).waitFor({ timeout: 15_000 });
  await theirs.getByText(OFF).waitFor({ timeout: 15_000 });
  check("ownerTurnsThemOff", true);
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
