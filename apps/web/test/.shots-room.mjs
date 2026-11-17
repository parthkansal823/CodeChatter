// Scratch: screenshots of the room's IDE for the UI clean-up. Not a test; removed afterwards.
import { launch, sleep } from "./browser.mjs";

const OUT = process.env.OUT;
const { browser, signIn } = await launch();
for (const [name, width, height] of [["desktop", 1440, 900], ["laptop", 1280, 720]]) {
  const { page } = await signIn("test1@codechatter.local", { width, height });
  await sleep(4000);
  // Open a file, so the editor shows.
  const first = page.getByRole("tree", { name: "Files" }).getByRole("treeitem").filter({ hasText: /\.(py|js|ts|md)$/ }).first();
  if (await first.count()) await first.click();
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/room-${name}.png` });
  if (name === "desktop") {
    for (const theme of ["dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await sleep(800);
      await page.screenshot({ path: `${OUT}/room-${name}-${theme}.png` });
    }
  }
  await page.context().close();
}
const { page } = await signIn("test1@codechatter.local", { width: 390, height: 844 });
await sleep(4000);
await page.screenshot({ path: `${OUT}/room-phone.png` });
await browser.close();
console.log("shots done");
