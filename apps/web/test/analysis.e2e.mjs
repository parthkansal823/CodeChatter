// The Analysis tool in a browser: open it, run it on a file with a secret and a shell injection, see them reported with the
// place to go, go there, and never see the secret. Another person who's signed out gets nothing. The file is removed.
//   node test/analysis.e2e.mjs        (from apps/web, with the dev stack running)
import { randomBytes } from "node:crypto";

import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const MIXED = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TOKEN = `ghp_${Array.from(randomBytes(36), (byte) => MIXED[byte % MIXED.length]).join("")}`;
const name = `ana_${Date.now().toString(36)}.py`;

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const row = () => a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) });

try {
  // Nobody signed out can run it, or read anything from it.
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/analysis`, { headers: { origin: BASE } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
  await sleep(800);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText(`import subprocess\n\nTOKEN = "${TOKEN}"\n\ndef run(command):\n    subprocess.call(command, shell=True)\n`);
  await sleep(3000);

  await a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Analysis", exact: true }).click();
  const tool = a.getByRole("region", { name: "Analysis" });
  await tool.waitFor({ timeout: 15_000 });
  check("itExplainsItselfFirst", await tool.getByText(/gitleaks for secrets/).isVisible());
  await tool.getByRole("button", { name: "Analyse this project" }).click();
  check("itSaysItsWorking", await ok(tool.getByRole("button", { name: /Analysing/ }).waitFor({ timeout: 5_000 })));
  const secrets = tool.getByRole("region", { name: "Secrets" });
  check("itFinishes", await ok(tool.getByRole("button", { name: "Run again" }).waitFor({ timeout: 240_000 })));
  const place = secrets.getByRole("button", { name: `${name}:3` });
  check("theSecretIsReportedWithItsPlace", await ok(place.waitFor({ timeout: 5_000 })));
  check("whichRuleFoundIt", await secrets.getByRole("row", { name: new RegExp(name.replace(".", "\\.")) }).getByText("github-pat").isVisible());
  check("theShellInjectionToo", await ok(tool.getByRole("region", { name: "Security" }).getByRole("row", { name: new RegExp(`${name.replace(".", "\\.")}:6`) }).getByRole("cell", { name: "high", exact: true }).first().waitFor({ timeout: 5_000 })));
  check("theTilesCountThem", await tool.getByText("Lines of code").isVisible());
  check("theToolsAreNamed", await tool.getByText(/Ran .*scc.*lizard.*gitleaks.*bandit/).isVisible());
  check("theSecretIsNotOnThePage", !(await tool.innerText()).includes(TOKEN));

  // The AI's review, written from what the tools found. The model is stood in for: what's under test is what it's sent.
  let sent = null;
  await a.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: true, provider: "openai", model: "stand-in", vision: false, problem: null, limit: { requests: 30, windowSeconds: 600 }, ollama: null } }));
  await a.route("**/api/rooms/*/ai/chat", (route) => {
    sent = route.request().postDataJSON();
    const events = [
      { type: "delta", text: `## Risks\nThe secret in \`${name}:3\` comes first. Also see \`src/invented.py\`.` },
      { type: "done", stop: "end", usage: { inputTokens: 10, outputTokens: 10, estimated: false } },
    ];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await tool.getByRole("button", { name: "Ask the AI to review this" }).click();
  const answer = a.getByRole("log", { name: "AI conversation" });
  check("theAiPanelAnswers", await ok(answer.getByText("comes first").waitFor({ timeout: 30_000 })), JSON.stringify(sent)?.slice(0, 160));
  check("inProjectReviewMode", sent?.mode === "project");
  const project = sent?.context?.project;
  check("itsToldWhatGitleaksFound", project?.facts.some((fact) => fact.startsWith("gitleaks:") && fact.includes(`${name}:3`)), JSON.stringify(project?.facts)?.slice(0, 200));
  check("andWhatBanditFound", project?.facts.some((fact) => fact.startsWith("bandit") && fact.includes("B602")));
  check("andSeesTheTree", project?.tree.includes(name));
  check("theSecretIsNotSentToTheAi", !JSON.stringify(sent).includes(TOKEN));
  check("thePlaceInTheAnswerOpensTheFile", await answer.getByRole("button", { name: `${name}:3` }).isVisible());
  check("aFileThatIsntThereIsFlagged", await answer.getByText("src/invented.py", { exact: true }).first().isVisible() && (await answer.getByText(/Not in this project/).isVisible()));
  check("itsNotALink", (await answer.getByRole("button", { name: "src/invented.py" }).count()) === 0);
  await a.unroute("**/api/ai/status");
  await a.unroute("**/api/rooms/*/ai/chat");

  // It stays when you look away and come back.
  await place.click();
  check("itsPlaceOpensTheFile", await ok(a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")), selected: true }).waitFor({ timeout: 10_000 })));
  await a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Analysis", exact: true }).click();
  check("theReportIsStillThere", await ok(a.getByRole("region", { name: "Analysis" }).getByRole("region", { name: "Secrets" }).waitFor({ timeout: 10_000 })));
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 300));
} finally {
  const editorButton = a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Analysis", exact: true });
  if (await a.getByRole("region", { name: "Analysis" }).isVisible().catch(() => false)) await editorButton.click().catch(() => {});
  await sleep(500);
  await row().focus().catch(() => {});
  await a.keyboard.press("Delete").catch(() => {});
  check("theFileIsRemoved", await ok(row().waitFor({ state: "detached", timeout: 10_000 })));
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
