// Framework templates, as someone would use them (roadmap §14 C): make a room from the template, allow package
// installs, press Start in the Dev server tab, wait for the dev server, open the preview and use the app.
// Real downloads through the package proxy, so it takes a few minutes per template. Each room is deleted when
// its check is done. Run some of them with TEMPLATES=react,flask. With WARM=1 (after pnpm sandbox:warm) each must
// start with plain Start, its packages unpacked from the warm cache and installs left off (except the cold ones).
//   node test/templates.e2e.mjs      (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

/**
 * Each template: its name in the New room dialog, its dev server's port, and what its preview shows. `cold`:
 * never warm (Go's, Cargo's and Maven's downloads live in the home folder, not the workspace the cache keeps).
 */
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
  { id: "nuxt", name: "Nuxt", port: 3000, heading: "Hello from Nuxt", counter: true },
  { id: "angular", name: "Angular", port: 4200, heading: "Hello from Angular", counter: true },
  { id: "nestjs", name: "NestJS", port: 3000, heading: "Hello from NestJS" },
  { id: "gin", name: "Gin (Go)", port: 8080, heading: "Hello from Gin", cold: true },
  { id: "axum", name: "Axum (Rust)", port: 3000, heading: "Hello from Axum", cold: true },
  { id: "spring-boot", name: "Spring Boot", port: 8080, heading: "Hello from Spring Boot", cold: true },
  { id: "laravel", name: "Laravel", port: 8000, heading: "Hello from Laravel" },
  { id: "express-postgres", name: "Express and PostgreSQL", port: 3000, heading: "Hello from Express and PostgreSQL", text: "0 notes" },
  { id: "fastapi", name: "FastAPI", port: 8000, text: "Hello from FastAPI" },
  { id: "flask", name: "Flask", port: 5000, heading: "Hello from Flask" },
  { id: "django", name: "Django", port: 8000, heading: "Hello from Django" },
];
const only = process.env.TEMPLATES?.split(",").map((id) => id.trim());
const warmRun = process.env.WARM === "1";

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

/**
 * The owner's one click in the Dev server tab, then wait until it listens. With WARM=1 (after pnpm
 * sandbox:warm) nothing needs downloading, so the tab offers plain Start from the first, and installs
 * stay off; otherwise it's Allow installs and start.
 */
async function startDevServer({ port, cold }, roomId) {
  const warm = warmRun && !cold;
  await page.keyboard.press("Control+`"); // opens the bottom panel (with a terminal), which wakes the sandbox
  await page.getByRole("tab", { name: "Dev server", exact: true }).click();
  if (warm) {
    // From its first answer, before the sandbox is up: the runner finds the warm install itself.
    await page.getByText("Stopped", { exact: true }).first().waitFor({ timeout: 30_000 });
    if (await page.getByRole("button", { name: "Allow installs and start" }).count()) {
      throw new Error("The tab offered to allow installs, although the template is warm.");
    }
    await page.getByRole("button", { name: "Start", exact: true }).click({ timeout: 60_000 });
  } else {
    await page.getByRole("button", { name: "Allow installs and start" }).click();
  }
  await page.getByText(`Running on port ${port}`, { exact: true }).waitFor({ timeout: 6 * 60_000 });
  if (warm) {
    const installs = await page.evaluate((room) => fetch(`/api/rooms/${room}/sandbox`).then((r) => r.json()).then((s) => s.installs ?? null), roomId);
    if (installs) throw new Error("Installs were switched on, although the template is warm.");
  }
}

for (const template of CASES.filter((c) => !only || only.includes(c.id))) {
  let roomId = null;
  let previewPage = null;
  const t0 = Date.now();
  try {
    roomId = await newRoom(template.name);
    await startDevServer(template, roomId);
    // Failed requests from the preview's first load on (the page's own listener would start too late).
    const failedRequests = [];
    page.context().on("response", (response) => response.status() >= 400 && failedRequests.push(`${response.status()} ${response.url().slice(-140)}`));
    const [preview] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Open preview" }).click()]);
    previewPage = preview;
    // What went wrong in the preview, shown when its check fails.
    const problems = [];
    preview.on("console", (message) => (process.env.DEBUG_PREVIEW || message.type() === "error") && problems.push(`${message.type()}: ${message.text().slice(0, 300)}`));
    preview.on("pageerror", (error) => problems.push(`uncaught: ${error.message.slice(0, 300)}`));
    previewPage.problems = problems;
    previewPage.failedRequests = failedRequests;
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
    const seen = previewPage?.problems?.length ? " (the preview's errors are above)" : "";
    for (const problem of [...(previewPage?.failedRequests ?? []), ...(previewPage?.problems ?? [])].slice(0, 30)) console.log(`  preview: ${problem}`);
    check(`${template.id}RunsInThePreview`, false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})${seen}`);
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
