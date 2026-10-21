// GitHub activity in room chat (roadmap §14 E): in a room made from octocat/Spoon-Knife, test1 (no GitHub token)
// turns it on from the Source Control view and gets the webhook's address and secret to add by hand; a push
// delivery signed with that secret (sent from here, as GitHub would) shows in chat from "GitHub" with its link;
// an unsigned one is refused; turned off, deliveries aren't taken. Making the webhook with a token is covered
// against a mock GitHub by apps/api/test/source-control.e2e.mjs. The room is deleted at the end.
//   node test/webhooks.e2e.mjs        (from apps/web, with the dev stack running and internet access)
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");
let roomId = null;

const deliver = (event, payload, secret) => {
  const raw = JSON.stringify(payload);
  return fetch(`${BASE}/api/github/webhooks/${roomId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      ...(secret && { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }),
    },
    body: raw,
  }).then((r) => r.status);
};
const push = {
  repository: { full_name: "octocat/Spoon-Knife" },
  ref: "refs/heads/main",
  pusher: { name: "octo-pusher" },
  commits: [{ id: "f".repeat(40), message: "Tidy the page" }],
  compare: "https://github.com/octocat/Spoon-Knife/compare/a...b",
};

try {
  const created = await page.evaluate(() =>
    fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Webhooks check", repo: { owner: "octocat", name: "Spoon-Knife" } }),
    }).then((r) => r.json()),
  );
  roomId = created.id;
  await page.goto(`${BASE}/rooms/${roomId}`);
  await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Source control" }).click();
  const view = page.getByRole("region", { name: "Source control" });
  await view.getByRole("button", { name: /^Activity in chat/ }).click();
  check("offAtFirst", await ok(view.getByRole("button", { name: /^Activity in chat\s*Off$/ }).waitFor({ timeout: 10_000 })));
  await view.getByRole("button", { name: "Post GitHub activity to chat" }).click();

  const steps = view.getByRole("region", { name: "Add the webhook on GitHub" });
  check("manualSteps", await ok(steps.waitFor({ timeout: 15_000 })));
  const codes = await steps.locator("code").allInnerTexts();
  const [url, secret] = codes;
  check("addressShown", url === `${BASE}/api/github/webhooks/${roomId}`, url);
  check("localhostNoted", await ok(steps.getByText(/GitHub can’t reach a localhost address/).waitFor({ timeout: 2_000 })));
  check("nowOn", await ok(view.getByRole("button", { name: /^Activity in chat\s*On$/ }).waitFor({ timeout: 10_000 })));

  check("unsignedRefused", (await deliver("push", push, null)) === 401);
  check("pushTaken", (await deliver("push", push, secret)) === 204);
  await page.getByRole("button", { name: "Chat" }).first().click();
  check("inChatFromGithub", await ok(page.getByText("octo-pusher pushed 1 commit to main:").waitFor({ timeout: 10_000 })));
  check("authorGithub", await ok(page.getByText("GitHub", { exact: true }).first().waitFor({ timeout: 2_000 })));
  check("compareLink", await ok(page.getByRole("link", { name: push.compare }).waitFor({ timeout: 2_000 })));
  await page.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "webhooks.png") });

  await view.getByRole("button", { name: "Turn off" }).click();
  check("turnedOff", await ok(view.getByRole("button", { name: /^Activity in chat\s*Off$/ }).waitFor({ timeout: 10_000 })));
  check("notTakenWhenOff", (await deliver("push", push, secret)) === 404);
} catch (error) {
  const shot = join(tmpdir(), "webhooks-failed.png");
  await page.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (roomId) {
    const status = await page.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE" }).then((r) => r.status), roomId);
    check("roomDeleted", status === 204, String(status));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
