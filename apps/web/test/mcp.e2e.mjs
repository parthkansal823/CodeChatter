// The MCP tool in a browser, for real: its example server runs in the sandbox, and the official MCP Inspector lists and calls it. It's
// added to .mcp.json, its tools make forms, what's wrong with a form is said, a call's answer and a tool's failure show, and so do
// resources and prompts. A server that won't start says so. Its files are removed.
//   node test/mcp.e2e.mjs        (from apps/web, with the dev stack running and the current sandbox images)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const files = a.getByRole("tree", { name: "Files" });

try {
  // Nobody signed out gets anything.
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/mcp`, { headers: { origin: BASE }, data: { server: "example", method: "tools/list" } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  await a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "MCP", exact: true }).click();
  const tool = a.getByRole("region", { name: "MCP servers" });
  await tool.waitFor({ timeout: 20_000 });
  check("itExplainsItselfFirst", await ok(tool.getByText(/how AI tools reach other programs/).waitFor({ timeout: 10_000 })));

  // Adding with something missing says what.
  await tool.getByRole("button", { name: "Add it" }).click();
  check("aMissingNameIsSaid", await tool.getByRole("alert").getByText(/short name/).isVisible());

  // The example, all the way to the sandbox.
  await tool.getByRole("button", { name: "Try an example" }).click();
  const servers = tool.getByRole("navigation", { name: "Servers in this room" });
  check("itIsAddedToTheRoom", await ok(servers.getByRole("button", { name: "example" }).waitFor({ timeout: 15_000 })));
  const tools = tool.getByRole("navigation", { name: "Its tools" });
  check("itsToolsAreListed", await ok(tools.getByRole("button", { name: "add" }).waitFor({ timeout: 90_000 })));
  check("eachOne", (await tools.getByRole("button").count()) === 3);
  check("theConfigIsARealFile", await ok(files.getByRole("treeitem", { name: /^\.mcp\.json/ }).waitFor({ timeout: 5_000 })));
  check("theServerIsARealFile", await ok(files.getByRole("treeitem", { name: /^mcp-example/ }).waitFor({ timeout: 5_000 })));

  // A form from its schema.
  const add = tool.getByRole("region", { name: "Tool add" });
  check("itSaysWhatItDoes", await add.getByText("Adds two numbers.").isVisible());
  await add.getByRole("button", { name: "Call add" }).click();
  check("aMissingValueIsSaid", await ok(add.getByText("a is needed.").waitFor({ timeout: 5_000 })));
  await add.getByLabel(/^a \(needed\)/).fill("2");
  await add.getByLabel(/^b \(needed\)/).fill("3");
  await add.getByRole("button", { name: "Call add" }).click();
  check("theRealAnswerShows", await ok(add.getByText("5", { exact: true }).waitFor({ timeout: 60_000 })));
  await add.getByText(/The whole answer/).click();
  check("allOfItCanBeSeen", (await add.getByRole("group", { name: "The whole answer" }).innerText()).includes('"content"'));

  // Other kinds of field.
  await tools.getByRole("button", { name: "shout" }).click();
  const shout = tool.getByRole("region", { name: "Tool shout" });
  await shout.getByLabel(/^text \(needed\)/).fill("hi");
  await shout.getByLabel(/^times/).fill("2");
  await shout.getByLabel(/^style/).selectOption("stars");
  await shout.getByRole("button", { name: "Call shout" }).click();
  check("textNumbersAndChoicesGoThrough", await ok(shout.getByText("*** HIHI ***").first().waitFor({ timeout: 60_000 })));

  // A tool saying it failed.
  await tools.getByRole("button", { name: "fail" }).click();
  const fail = tool.getByRole("region", { name: "Tool fail" });
  check("aToolThatTakesNothingSaysSo", await fail.getByText("It takes nothing.").isVisible());
  await fail.getByRole("button", { name: "Call fail" }).click();
  check("aToolsFailureShows", await ok(fail.getByText(/always fails|reported a failure/).first().waitFor({ timeout: 60_000 })));

  // Resources and prompts.
  await tool.getByRole("button", { name: "resources 1" }).click();
  await tool.getByRole("button", { name: "Read Welcome note" }).click();
  check("aResourceIsRead", await ok(tool.getByText("Hello from a resource.").first().waitFor({ timeout: 60_000 })));
  await tool.getByRole("button", { name: "prompts 1" }).click();
  check("aPromptWaitsForWhatItNeeds", await tool.getByRole("button", { name: "Get review" }).isDisabled());
  await tool.getByLabel(/^language/).fill("Python");
  await tool.getByRole("button", { name: "Get review" }).click();
  check("aPromptIsGot", await ok(tool.getByText(/Review this Python code\./).first().waitFor({ timeout: 60_000 })));

  // One that won't start says so, and another can be added beside the first.
  await servers.getByRole("button", { name: "Add a server" }).click();
  await servers.getByLabel("Name").fill("broken");
  await servers.getByLabel("How to start it, or its address").fill("no-such-program --flag");
  await servers.getByRole("button", { name: "Add it" }).click();
  check("aServerThatWontStartSaysSo", await ok(tool.getByRole("alert").getByText("Couldn't talk to it.").waitFor({ timeout: 90_000 })));
  check("itsReasonShows", ((await tool.getByRole("alert").innerText()).length) > 25);
  await tool.getByRole("button", { name: "Remove broken" }).click();
  check("removingItLeavesTheOther", await ok(servers.getByRole("button", { name: "broken" }).waitFor({ state: "detached", timeout: 10_000 })));
  check("theOtherIsStillThere", await servers.getByRole("button", { name: "example" }).isVisible());
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 500));
} finally {
  const apps = a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "MCP", exact: true });
  if (await a.getByRole("region", { name: "MCP servers" }).isVisible().catch(() => false)) await apps.click().catch(() => {});
  await sleep(500);
  for (const name of [/^\.mcp\.json/, /^mcp-example/]) {
    const row = files.getByRole("treeitem", { name });
    if (await row.count().catch(() => 0)) {
      await row.focus().catch(() => {});
      await a.keyboard.press("Delete").catch(() => {});
      await sleep(800);
    }
  }
  check("theFilesAreRemoved", (await files.getByRole("treeitem", { name: /^\.mcp\.json|^mcp-example/ }).count()) === 0);
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
