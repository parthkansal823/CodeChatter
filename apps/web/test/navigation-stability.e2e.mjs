/** Catch repeated document reloads that prevent sign-in and room controls from becoming usable; leave seeded data unchanged. */
import { BASE, PASSWORD, check, finish, launch, sleep } from "./browser.mjs";

let browser, context, page, errors, seededBefore;
let signedIn = false;
let stage = "launch browser";

function verify(name, condition) {
  check(name, condition);
  if (!condition) throw new Error("CheckFailed");
}

async function seededRoles() {
  const response = await context.request.get(`${BASE}/api/rooms/E2ETST/members`);
  if (!response.ok()) throw new Error("SeededMembersUnavailable");
  const { members } = await response.json();
  return JSON.stringify(members.map(({ id, role }) => ({ id, role })).sort((a, b) => a.id.localeCompare(b.id)));
}

/** Count actual HTML navigations, not Next's normal history updates or RSC fetches. */
async function stable(path, label, ready) {
  stage = `${label} stability`;
  let documents = 0;
  const requested = (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
  };
  page.on("request", requested);
  try {
    await page.goto(`${BASE}${path}`);
    await ready().waitFor({ timeout: 60_000 });
    await sleep(2000); // Let the initial compile/hydration finish before measuring an idle page.
    const before = documents;
    await sleep(4000);
    verify(`${label} does not repeatedly reload its document`, documents === before);
    verify(`${label} stays on its page with usable controls`, new URL(page.url()).pathname === path && await ready().isVisible() && await ready().isEnabled());
  } finally {
    page.off("request", requested);
  }
}

try {
  ({ browser, errors } = await launch());
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  page.on("pageerror", () => errors.push("PageError"));
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  // Opening preferences reuses the room's editor sync. This read-only suite
  // must not initialize or replace the shared account's saved editor settings.
  await page.route("**/api/me/settings", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updatedAt: new Date().toISOString() }) })
    : route.continue());

  await stable("/sign-in", "Sign-in", () => page.getByRole("button", { name: "Sign in", exact: true }));
  stage = "sign in";
  const response = await context.request.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { origin: new URL(BASE).origin },
    data: { email: "test1@codechatter.local", password: PASSWORD },
  });
  signedIn = response.ok();
  verify("the stability fixture signs in", signedIn);
  seededBefore = await seededRoles();
  await stable("/dashboard", "Dashboard", () => page.getByRole("button", { name: "New room", exact: true }));
  await stable("/settings/preferences", "Preferences", () => page.getByRole("switch", { name: "Email me a daily digest", exact: true }));
  await stable("/rooms/E2ETST", "Room", () => page.getByRole("tree", { name: "Files", exact: true }));
} catch (error) {
  // Browser exceptions can contain entered data; report only a controlled stage and error category.
  check(`navigation stability workflow completes (${stage})`, false, error?.name ?? "Error");
} finally {
  if (context && seededBefore) {
    try { check("stability checks leave seeded room roles unchanged", await seededRoles() === seededBefore); }
    catch { check("stability checks leave seeded room roles unchanged", false); }
  }
  if (context && signedIn) {
    await context.request.post(`${BASE}/api/auth/sign-out`, { headers: { origin: new URL(BASE).origin }, data: {} }).catch(() => {});
  }
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
check("no browser page errors", Boolean(errors) && errors.length === 0);
finish();
