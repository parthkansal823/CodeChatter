// Shared helpers for the browser end-to-end tests (Playwright-core driving Edge).
// The dev stack must be running (app at http://localhost:8080) and seeded
// (pnpm seed): the tests use test1/test2 in the "Automated tests" room.
import { createRequire } from "node:module";

// playwright-core comes from the editor spike until the web app gets its own copy.
const { chromium } = createRequire(new URL("../../../spikes/s1-editor/package.json", import.meta.url))("playwright-core");

export const BASE = process.env.APP_URL ?? "http://localhost:8080";
export const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
export const PASSWORD = "codechatter123";
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
export function check(name, ok, detail = "") {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
}

/** Anything the app's security policy refused, on any page of any suite (see launch). */
const refused = [];
/** For the suite that attacks the policy on purpose: what it set off so far doesn't count. */
export const forgetRefused = () => {
  refused.length = 0;
};

/** Prints the summary and exits non-zero when a check failed. */
export function finish() {
  check("nothing was refused by the security policy", refused.length === 0, [...new Set(refused)].join(" | "));
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

/** `args`: extra browser switches (the call test's fake camera and microphone). */
export async function launch({ args = [] } = {}) {
  const browser = await chromium.launch({ channel: "msedge", headless: process.env.HEADED !== "1", args });
  // Every suite also proves the policy doesn't break what it tests.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...options) => {
    const context = await newContext(...options);
    context.on("page", (page) => {
      page.on("console", (message) => {
        if (message.type() !== "error" || !/Content Security Policy/.test(message.text())) return;
        // A frame's own stricter policy (API Studio's response preview) isn't the app's.
        if (message.location().url === "about:srcdoc") return;
        refused.push(message.text().slice(0, 240));
      });
    });
    return context;
  };
  const errors = [];
  return {
    browser,
    errors,
    /** A new browser profile signed in as `email`, on the test room. */
    async signIn(email, { width = 1440, height = 900 } = {}) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(`${email}: ${error.message.split("\n")[0]}`));
      await page.goto(`${BASE}/sign-in?returnTo=${encodeURIComponent(`/rooms/${ROOM}`)}`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(new RegExp(`/rooms/${ROOM}`), { timeout: 30_000 });
      await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
      return { context, page };
    },
  };
}
