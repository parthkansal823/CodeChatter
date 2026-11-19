// API Studio, two people: a request to http://localhost:<port> reaches a server running in the
// room's sandbox; the other person sees the request live; scripts before sending and after the
// response (Postman's pm), with no network and a time limit; a Postman collection's scripts, only
// when asked for; a cURL import sends a POST with its body; private addresses (cloud metadata) are blocked.
//   node test/api-studio.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch, openApp } from "./browser.mjs";

const stamp = Date.now().toString(36);
const port = 4000 + Math.floor(Math.random() * 900);
const serverFile = `srv_${stamp}.js`;
const ok = (promise) => promise.then(() => true, () => false);

const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;

// A small JSON echo server, started with Run in the room's sandbox.
await a.getByRole("button", { name: "New file" }).click();
await a.getByPlaceholder("name.ext").fill(serverFile);
await a.getByPlaceholder("name.ext").press("Enter");
await a.getByRole("tab", { name: new RegExp(serverFile.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
await a.locator(".monaco-editor .view-lines").first().click();
// Insert atomically: fast individual key events can lose characters while Monaco synchronises.
await a.keyboard.insertText(
  `require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{s.setHeader("content-type","application/json");s.end(JSON.stringify({ok:true,method:q.method,url:q.url,body:b}))})}).listen(${port},()=>console.log("listening ${port}"))`,
);
await a.keyboard.press("Control+Enter");
check("serverStarts", await ok(a.locator(".xterm-rows").getByText(`listening ${port}`).first().waitFor({ timeout: 60_000 })));

// test1 makes a request to the sandbox server.
for (const page of [a, b]) await openApp(page, "API");
await a.getByRole("button", { name: "New request" }).first().click();
await a.getByRole("textbox", { name: "Request name" }).fill(`Ping ${stamp}`);
const url = a.getByRole("textbox", { name: "Request URL" });
await url.fill(`http://localhost:${port}/hello?x=${stamp}`);
await a.getByRole("button", { name: "Send", exact: true }).click();
const response = a.getByRole("region", { name: "Response", exact: true });
check("sandboxRequestAnswers", await ok(response.getByText("200 OK").waitFor({ timeout: 30_000 })));
check("responseBodyShown", await ok(response.getByText(`/hello?x=${stamp}`).first().waitFor({ timeout: 5_000 })));

// test2 sees the request appear in the shared collection.
check("requestSharedLive", await ok(b.getByText(`Ping ${stamp}`).first().waitFor({ timeout: 15_000 })));

// Scripts: one before sending changes this send's address and sets a variable; one after the response tests it.
const requestPane = a.getByRole("region", { name: "Request", exact: true });
await requestPane.getByRole("tab", { name: /^Scripts/ }).click();
const before = a.getByRole("textbox", { name: "Before sending" });
const after = a.getByRole("textbox", { name: "After the response" });
await before.fill(`pm.environment.set("who", "scripted-${stamp}");\npm.request.url = pm.request.url + "&from=" + pm.environment.get("who");\nconsole.log("before", pm.request.url);`);
await after.fill(
  `pm.test("Status is 200", () => pm.response.to.have.status(200));\npm.test("Says ok", () => pm.expect(pm.response.json().ok).to.equal(true));\npm.test("Fails on purpose", () => pm.expect(pm.response.json().method).to.equal("DELETE"));\nconsole.log("after", pm.response.json().url);`,
);
await b.getByText(`Ping ${stamp}`).first().click();
await b.getByRole("region", { name: "Request", exact: true }).getByRole("tab", { name: /^Scripts/ }).click();
check("theOtherPersonSeesTheScript", await ok(b.waitForFunction(() => [...document.querySelectorAll("textarea[aria-label='After the response']")].some((area) => area.value.includes("Fails on purpose")), null, { timeout: 15_000 })));
await a.getByRole("button", { name: "Send", exact: true }).click();
check("theScriptChangesWhereItGoes", await ok(response.getByText(`from=scripted-${stamp}`).first().waitFor({ timeout: 30_000 })), ((await response.textContent()) ?? "").slice(0, 200));
const testsTab = response.getByRole("tab", { name: /^Tests/ });
check("itsTestsAreCounted", /2\/3/.test(await testsTab.innerText()), await testsTab.innerText());
await testsTab.click();
const results = response.getByRole("list", { name: "Test results" });
check("eachTestSaysHowItWent", await ok(results.getByRole("listitem").filter({ hasText: "Status is 200" }).getByLabel("Passed").waitFor({ timeout: 5000 })) && (await results.getByRole("listitem").filter({ hasText: "Fails on purpose" }).getByLabel("Failed").count()) === 1);
check("andWhyOneFailed", await ok(results.getByText('expected "GET" to equal "DELETE"').waitFor({ timeout: 5000 })));
const consoleLines = response.getByRole("region", { name: "Console" });
check("whatTheyLoggedShows", await ok(consoleLines.getByText(/before · before http:\/\/localhost:\d+\/hello/).waitFor({ timeout: 5000 })) && (await consoleLines.getByText(/after · after \/hello/).count()) === 1);

// No network, and a time limit.
await requestPane.getByRole("tab", { name: /^Scripts/ }).click();
await after.fill("");
await before.fill(`await fetch("http://localhost:${port}/stolen");`);
await a.getByRole("button", { name: "Send", exact: true }).click();
check("aScriptHasNoNetwork", await ok(response.getByText(/The script before sending stopped.*fetch is not a function/).waitFor({ timeout: 15_000 })), ((await response.textContent()) ?? "").slice(0, 200));
await before.fill("while (true) {}");
await a.getByRole("button", { name: "Send", exact: true }).click();
check("aLoopThatNeverEndsIsStopped", await ok(response.getByText(/longer than 5 seconds/).waitFor({ timeout: 20_000 })));
await before.fill("pm.environment.set('a', 1);\nbroken(;");
await a.getByRole("button", { name: "Send", exact: true }).click();
check("aMistakeSaysItsLine", await ok(response.getByText(/stopped at line 2/).waitFor({ timeout: 15_000 })), ((await response.textContent()) ?? "").slice(0, 200));
await before.fill("");

// A Postman collection's scripts come only when asked for.
try {
  const postman = JSON.stringify({
    info: { name: `Scripted ${stamp}`, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    event: [{ listen: "test", script: { exec: ["pm.test('From the collection', () => pm.response.to.be.ok);"] } }],
    item: [{ name: `Imported ${stamp}`, request: { method: "GET", url: `http://localhost:${port}/imported` } }],
  });
  await a.getByRole("button", { name: "Import" }).first().click();
  const importing = a.getByRole("dialog");
  await importing.getByRole("textbox").first().fill(postman);
  const bring = importing.getByRole("checkbox", { name: /Bring their scripts too/ });
  check("aCollectionsScriptsAreOfferedNotTaken", await ok(bring.waitFor({ timeout: 10_000 })) && !(await bring.isChecked()));
  await bring.check();
  await importing.getByRole("button", { name: "Import", exact: true }).click();
  await a.getByText(`Imported ${stamp}`).first().click();
  // Sent once it's the request shown.
  await a.waitForFunction((name) => document.querySelector("input[aria-label='Request name']")?.value === name, `Imported ${stamp}`, { timeout: 10_000 });
  await a.getByRole("button", { name: "Send", exact: true }).click();
  await response.getByRole("tab", { name: /^Tests/ }).click();
  check("broughtTheyRun", await ok(response.getByRole("list", { name: "Test results" }).getByText("From the collection").waitFor({ timeout: 30_000 })));
} catch (error) {
  check("importingScriptsWorks", false, String(error).slice(0, 300));
  await a.screenshot({ path: `${process.env.TEMP ?? "/tmp"}/api-studio-import.png` }).catch(() => {});
  await a.keyboard.press("Escape").catch(() => {});
}

// A POST imported from cURL keeps its method, header and body.
await a.getByRole("button", { name: "Import" }).first().click();
await a.getByRole("textbox", { name: "cURL command" }).fill(`curl -X POST http://localhost:${port}/echo -H 'content-type: application/json' -d '{"a":1}'`);
await a.getByRole("dialog").getByRole("button", { name: "Add to collection" }).click();
await a.getByRole("button", { name: "Send", exact: true }).click();
check("curlImportPosts", await ok(response.getByText('"method": "POST"').first().waitFor({ timeout: 30_000 })), ((await response.textContent()) ?? "").slice(0, 160));

// Private addresses never leave the server.
await url.fill("http://169.254.169.254/latest/meta-data/");
await a.getByRole("button", { name: "Send", exact: true }).click();
check("metadataBlocked", await ok(response.getByText("Blocked for safety").waitFor({ timeout: 15_000 })));

await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/api-studio.png` });
// Stop the server so the sandbox is quiet for the next test.
await a.getByRole("button", { name: /^Stop/ }).first().click().catch(() => {});
// And take its file away.
await a.getByRole("button", { name: "Close API Studio", exact: true }).click().catch(() => {});
const made = a.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name: serverFile, exact: true });
await made.press("Delete").catch(() => {});
await made.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
check("itsFileIsRemoved", (await made.count()) === 0);
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
