// The AI copilot, against the mock AI (apps/api/test/mock-ai.mjs, with .env pointing the API at it):
// an answer streams in; an Edit is reviewed, applied to the open file and seen by the other person;
// the agent's steps create a file and run it, each only after approval.
//   node test/ai.e2e.mjs        (from apps/web, with the dev stack and the mock AI running)
import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const file = `ai_${stamp}.py`;
const agentFile = `agent_${stamp}.py`;
const ok = (promise) => promise.then(() => true, () => false);
const editorText = async (page) => ((await page.locator(".monaco-editor .view-lines").first().textContent()) ?? "").replace(/ /g, " ");

const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;

// A new file, open in test1's editor.
await a.getByRole("button", { name: "New file" }).click();
await a.getByPlaceholder("name.ext").fill(file);
await a.getByPlaceholder("name.ext").press("Enter");
await a.getByRole("tab", { name: new RegExp(file.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
await a.locator(".monaco-editor .view-lines").first().click();
await a.keyboard.type('print("before")');

// An answer streams in.
await a.getByRole("button", { name: "AI", exact: true }).click(); // the title bar toggle opens the side panel on AI
const input = a.getByRole("textbox", { name: "Message to the AI" });
const conversation = a.getByLabel("AI conversation");
const ready = await ok(input.waitFor({ timeout: 20_000 }));
check("aiPanelReady", ready, ready ? "" : "no composer: is the mock AI running and .env pointing at it?");
await input.fill("What does this file do?");
await input.press("Enter");
check("answerStreams", await ok(conversation.getByText("Mock answer.").waitFor({ timeout: 20_000 })));

// Edit: the answer becomes a change you review, then it lands in the file for everyone.
const pickMode = async (name) => {
  await a.getByRole("combobox", { name: "AI mode" }).click();
  await a.getByRole("option", { name: new RegExp(`^${name}`) }).click();
};
await pickMode("Edit");
await input.fill("Print something else");
await input.press("Enter");
await a.getByRole("button", { name: "Review change" }).click();
await a.getByRole("button", { name: "Accept change" }).click();
check("editApplied", await ok(conversation.getByText(`Applied to ${file}.`).waitFor({ timeout: 10_000 })));
check("editInFile", (await editorText(a)).includes('print("edited by the AI")'), await editorText(a));
await b.getByRole("tree", { name: "Files" }).getByText(file, { exact: true }).click();
let seen = "";
for (let i = 0; i < 30 && !seen.includes("edited by the AI"); i++) {
  await b.waitForTimeout(500);
  seen = await editorText(b);
}
check("editReachesOthers", seen.includes('print("edited by the AI")'), seen);

// Agent: it proposes steps; each waits for approval.
await pickMode("Agent");
await input.fill(`Create ${agentFile} and run it`);
await input.press("Enter");
const create = a.getByRole("group", { name: `Create ${agentFile}` });
const proposed = await ok(create.getByRole("button", { name: "Review file" }).waitFor({ timeout: 20_000 }));
check("agentProposesSteps", proposed, proposed ? "" : ((await conversation.textContent()) ?? "").slice(-300));
if (proposed) {
  await create.getByRole("button", { name: "Review file" }).click();
  await a.getByRole("button", { name: "Create file" }).click();
  check("agentCreatesFile", await ok(a.getByRole("tree", { name: "Files" }).getByText(agentFile, { exact: true }).waitFor({ timeout: 10_000 })));
  const run = a.getByRole("group", { name: new RegExp(`^Run ${agentFile.replace(".", "\\.")}`) });
  await run.getByRole("button", { name: "Run", exact: true }).click();
  check("agentRunsIt", await ok(run.getByText("Done").waitFor({ timeout: 90_000 })));
}

// A failed run offers "Explain error", which opens the AI with the question already asked.
const failing = `fail_${stamp}.py`;
await a.getByRole("button", { name: "New file" }).click();
await a.getByPlaceholder("name.ext").fill(failing);
await a.getByPlaceholder("name.ext").press("Enter");
await a.getByRole("tab", { name: new RegExp(failing.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
await a.locator(".monaco-editor .view-lines").first().click();
await a.keyboard.type("raise SystemExit(3)");
const answers = await conversation.getByText("Mock answer.").count();
await a.getByRole("tab", { name: "Chat", exact: true }).click(); // the AI tab has to open by itself
await a.keyboard.press("Control+Enter");
const explain = a.getByRole("button", { name: "Explain error" });
const offered = await ok(explain.waitFor({ timeout: 60_000 }));
check("failedRunOffersExplain", offered);
if (offered) {
  await explain.click();
  let now = answers;
  for (let i = 0; i < 40 && now <= answers; i++) {
    await a.waitForTimeout(500);
    now = await conversation.getByText("Mock answer.").count().catch(() => 0);
  }
  check("explainOpensAiAndAnswers", now === answers + 1, `${answers} → ${now} answers`);
}

await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/ai.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
