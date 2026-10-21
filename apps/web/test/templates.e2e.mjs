// Framework templates, as someone would use them (roadmap §14 C): make a room from the template, allow package
// installs, press Start in the Dev server tab, wait for the dev server, open the preview and use the app.
// Real downloads through the package proxy, so it takes a few minutes per template. Each room is deleted when
// its check is done. Run some of them with TEMPLATES=react,flask.
//   node test/templates.e2e.mjs      (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

/** Each template: its name in the New room dialog, its dev server's port, and what its preview shows. */
const CASES = [
  { id: "react", name: "React (Vite)", port: 5173, heading: "Hello from React", counter: true },
  { id: "vue", name: "Vue (Vite)", port: 5173, heading: "Hello from Vue", counter: true },
  { id: "svelte", name: "Svelte (Vite)", port: 5173, heading: "Hello from Svelte", counter: true },
  { id: "nextjs", name: "Next.js", port: 3000, heading: "Hello from Next.js", counter: true },
  { id: "sveltekit", name: "SvelteKit", port: 5173, heading: "Hello from SvelteKit", counter: true },
  { id: "astro", name: "Astro", port: 4321, heading: "Hello from Astro", counter: true },
  { id: "solid", name: "Solid (Vite)", port: 5173, heading: "Hello from Solid", counter: true },
  { id: "fastify", name: "Fastify", port: 3000, heading: "Hello from Fastify" },
  { id: "hono", name: "Hono", port: 3000, heading: "Hello from Hono" },
  { id: "express-postgres", name: "Express and PostgreSQL", port: 3000, heading: "Hello from Express and PostgreSQL", text: "0 notes" },
  { id: "fastapi", name: "FastAPI", port: 8000, text: "Hello from FastAPI" },
  { id: "flask", name: "Flask", port: 5000, heading: "Hello from Flask" },
  { id: "django", name: "Django", port: 8000, heading: "Hello from Django" },
];
const only = process.env.TEMPLATES?.split(",").map((id) => id.trim());

const { browser, errors, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");

async function newRoom(template) {
  await page.goto(`${BASE}/dashboard`);
  await page.getByRole("button", { name: "New room" }).click();
  await page.getByLabel("Name").fill(`${template} check ${Date.now().toString(36)}`);
  await page.getByRole("radio", { name: new RegExp(`^${template.replace(/[()]/g, "\\$&")}`) }).click();
  await page.getByRole("button", { name: "Create room" }).click();
  await page.getByRole("heading", { name: /is ready$/ }).waitFor({ timeout: 30_000 });
  const id = /Room code (\w{6})/.exec(await page.getByRole("dialog").innerText())?.[1];
  await page.getByRole("button", { name: "Open room" }).click();
  await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  return id;
}

/** The owner's one click in the Dev server tab: allow installs and start. Then wait until it listens. */
async function startDevServer(port) {
  await page.keyboard.press("Control+`"); // opens the bottom panel (with a terminal)
  await page.getByRole("tab", { name: "Dev server", exact: true }).click();
  await page.getByRole("button", { name: "Allow installs and start" }).click();
  await page.getByText(`Running on port ${port}`, { exact: true }).waitFor({ timeout: 6 * 60_000 });
}

for (const template of CASES.filter((c) => !only || only.includes(c.id))) {
  let roomId = null;
  let previewPage = null;
  const t0 = Date.now();
  try {
    roomId = await newRoom(template.name);
    await startDevServer(template.port);
    const [preview] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Open preview" }).click()]);
    previewPage = preview;
    await preview.waitForLoadState("domcontentloaded");
    if (template.heading) await preview.getByRole("heading", { name: template.heading }).waitFor({ timeout: 60_000 });
    if (template.text) await preview.getByText(template.text).first().waitFor({ timeout: 60_000 });
    if (template.counter) {
      // A server-rendered page (Next.js, SvelteKit) shows the button before it hydrates, and a
      // click before then does nothing: click until one counts (each try waits two seconds).
      const counted = preview.getByRole("button", { name: "Clicked 1 times" });
      for (let tries = 0; tries < 30 && !(await counted.isVisible()); tries++) {
        await preview.getByRole("button", { name: "Clicked 0 times" }).click({ timeout: 5_000 }).catch(() => {});
        await counted.waitFor({ timeout: 2_000 }).catch(() => {});
      }
      await counted.waitFor({ timeout: 1_000 });
    }
    check(`${template.id}RunsInThePreview`, true, `${Math.round((Date.now() - t0) / 1000)}s`);
    await preview.close();
  } catch (error) {
    // The preview, when it opened (that's where it went wrong), else the room.
    const shot = join(tmpdir(), `template-${template.id}-failed.png`);
    await (previewPage && !previewPage.isClosed() ? previewPage : page).screenshot({ path: shot }).catch(() => {});
    check(`${template.id}RunsInThePreview`, false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
  } finally {
    if (roomId) {
      const status = await page.evaluate((room) => fetch(`/api/rooms/${room}`, { method: "DELETE", credentials: "same-origin" }).then((r) => r.status), roomId);
      if (status >= 300) check(`deleted ${roomId}`, false, String(status));
    }
  }
}
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
