// The AI calls view in a browser: the room's calls with their numbers, filtering by where they came from, opening one, and someone
// else's conversation staying closed. The list is stood in for, so this is the page: apps/api/test/traces.e2e.mjs tests what's in it.
//   node test/traces.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, ROOM, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");

const trace = (over) => ({ id: over.id, at: "2026-11-07T10:00:00.000Z", source: "chat", mode: "assistant", by: "Test One", mine: true, model: "gemma4:e4b", status: "ok", error: null, inputTokens: 100, outputTokens: 50, estimated: false, firstMs: 1000, totalMs: 4000, input: [{ role: "system", content: "Be brief." }, { role: "user", content: "What is a hash map?" }], output: "A map that hashes.", hidden: false, ...over });
let rows = [];
await a.route("**/api/rooms/*/ai/traces", (route) => route.fulfill({ json: rows }));

try {
  const outside = await browser.newContext();
  const refused = await outside.request.get(`${BASE}/api/rooms/${ROOM}/ai/traces`, { headers: { origin: BASE } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  await a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Prompts", exact: true }).click();
  const tool = a.getByRole("region", { name: "Prompts" });
  await tool.waitFor({ timeout: 20_000 });
  await tool.getByRole("button", { name: "AI calls" }).click();
  check("itExplainsItselfWhenEmpty", await ok(tool.getByText(/No calls here yet/).waitFor({ timeout: 10_000 })));

  rows = [
    trace({ id: "a" }),
    trace({ id: "b", source: "prompt", mode: null, inputTokens: 200, outputTokens: 100, firstMs: 3000 }),
    trace({ id: "c", source: "gateway", mode: null, by: null, mine: false, estimated: true, input: [{ role: "user", content: "From code." }], output: "From the model." }),
    trace({ id: "d", by: "Test Two", mine: false, input: null, output: null, hidden: true }),
    trace({ id: "e", source: "prompt", mode: null, status: "error", error: "The AI provider is having trouble.", outputTokens: 0, firstMs: null, output: "" }),
  ];
  await tool.getByRole("button", { name: "Look again" }).click();
  const calls = tool.getByRole("group", { name: "The calls" });
  check("theCallsAreListed", await ok(calls.getByRole("row").nth(5).waitFor({ timeout: 10_000 })));
  check("everyOne", (await calls.getByRole("row").count()) === 6);
  check("theyAddUp", (await tool.getByText("5", { exact: true }).first().isVisible()) && (await tool.getByText("850", { exact: true }).isVisible()) && (await tool.getByText("250 written").isVisible()), await tool.innerText());
  check("aFailureIsCounted", await tool.getByText("Failed", { exact: true }).first().isVisible());
  check("anEstimateIsMarked", await calls.getByRole("cell", { name: "~100" }).isVisible());
  check("itSaysWhereEachCameFrom", (await calls.getByRole("cell", { name: "Code in the room" }).isVisible()) && (await calls.getByRole("cell", { name: "AI panel" }).first().isVisible()));

  // Your own: what was said.
  await calls.getByRole("row").nth(1).getByRole("button").click();
  const detail = tool.getByRole("region", { name: "This call" });
  check("aCallOpens", await ok(detail.getByText("What is a hash map?").waitFor({ timeout: 5_000 })));
  check("withItsAnswer", await detail.getByText("A map that hashes.").isVisible());
  check("andWhichMode", await detail.getByText(/AI panel \(assistant\)/).isVisible());

  // Someone else's: only that it happened.
  await calls.getByRole("row").nth(4).getByRole("button").click();
  check("someoneElsesStaysClosed", await ok(detail.getByText("This was Test Two's own conversation, so only they can read it.").waitFor({ timeout: 5_000 })));
  check("withNothingOfIt", !(await detail.innerText()).includes("hash map"));

  // A failure.
  await calls.getByRole("row").nth(5).getByRole("button").click();
  check("aFailureSaysWhy", await ok(detail.getByText("The AI provider is having trouble.").waitFor({ timeout: 5_000 })));

  // Filtering.
  await tool.getByLabel("Show calls from").selectOption("gateway");
  check("itFiltersByWhereItCameFrom", (await calls.getByRole("row").count()) === 2);
  await tool.getByLabel("Show calls from").selectOption("all");

  // Back to the prompts.
  await tool.getByRole("button", { name: "Prompts", exact: true }).click();
  check("theOtherViewIsStillThere", await ok(tool.getByRole("button", { name: "New prompt" }).first().waitFor({ timeout: 10_000 })));
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 500));
} finally {
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
