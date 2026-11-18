// The room's own browser, against a real dev server in E2ETST's sandbox: a page shown beside the editor through the preview proxy, its address, its
// console and its requests, back and forward, a tablet's width, opening it in a tab of its own, and click to code: an element found by its text, one a
// React development build says the source of, and one Vue's says the file of, each opening its code in the editor. The page's React and Vue are
// stand-ins for what those builds put on their elements (the bridge reads the same). It stops its server and removes its file.
//   node test/room-browser.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch, sleep } from "./browser.mjs";

const stamp = Date.now().toString(36);
const port = 5000 + Math.floor(Math.random() * 900);
const serverFile = `browser_${stamp}.js`;
const heading = `Plain heading ${stamp}`;
const ok = (promise) => promise.then(() => true, () => false);

// The server's page is in the file itself, so its code is in the room to be found.
const lines = [
  "const PAGE = `<!doctype html><html><head><title>Browser test</title></head><body>",
  `<h1>${heading}</h1>`,
  '<p id="react">React made this</p>',
  '<p id="vue">Vue made this</p>',
  '<button id="load">Load data</button>',
  '<a href="/second">Second page</a>',
  "<script>",
  `document.getElementById("react").__reactFiber$stand = { type: "p", _debugSource: { fileName: "/home/sandbox/workspace/${serverFile}", lineNumber: 3, columnNumber: 1 }, _debugOwner: { type: function Widget() {} } };`,
  `document.getElementById("vue").__vueParentComponent = { type: { __file: "${serverFile}", __name: "Card" } };`,
  'console.log("hello from the page", { n: 1 });',
  'console.error("something went wrong");',
  'document.getElementById("load").onclick = () => fetch("/data").then((r) => r.json()).then((d) => console.log("got " + d.ok));',
  "</script></body></html>`;",
  'require("http").createServer((q, s) => {',
  '  if (q.url === "/data") { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify({ ok: true })); }',
  '  s.setHeader("content-type", "text/html");',
  '  s.end(q.url === "/second" ? "<!doctype html><title>Second</title><h2>The second page</h2>" : PAGE);',
  `}).listen(${port}, () => console.log("listening ${port}"));`,
];

const { browser, errors, signIn } = await launch();
const { page: a, context } = await signIn("test1@codechatter.local");
const pane = a.getByRole("region", { name: "Browser" });
const tools = pane.getByRole("tabpanel");
const page = a.frameLocator('iframe[title^="The page"]');
const activeTab = (name) => a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")), selected: true });
const cursorLine = async () => Number((await a.getByText(/^Ln \d+, Col \d+/).first().innerText()).match(/^Ln (\d+)/)?.[1] ?? 0);

try {
  // ---- A dev server in the sandbox ----
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(serverFile);
  await a.getByPlaceholder("name.ext").press("Enter");
  await activeTab(serverFile).waitFor({ timeout: 15_000 });
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText(lines.join("\n"));
  await sleep(800);
  await a.keyboard.press("Control+Enter");
  check("theServerStarts", await ok(a.locator(".xterm-rows").getByText(`listening ${port}`).first().waitFor({ timeout: 60_000 })));

  // ---- The browser, beside the editor ----
  await a.getByRole("button", { name: "Browser", exact: true }).click();
  await pane.waitFor({ timeout: 10_000 });
  const server = pane.getByRole("combobox", { name: "Server" });
  for (let i = 0; i < 20 && !(await server.locator(`option[value="${port}"]`).count()); i++) await sleep(1000);
  await server.selectOption(String(port));
  await pane.getByRole("button", { name: "Open it here" }).click();
  check("thePageShowsBesideTheEditor", await ok(page.getByRole("heading", { name: heading }).waitFor({ timeout: 30_000 })));
  check("itsAddressShows", await ok(a.waitForFunction(() => document.querySelector('[aria-label="Address"]')?.value === "/", null, { timeout: 10_000 })));

  // ---- DevTools: the console and the network ----
  check("theConsoleShowsWhatItLogged", await ok(tools.getByText("hello from the page").first().waitFor({ timeout: 10_000 })) && (await tools.getByText("something went wrong").count()) === 1);
  check("itsErrorsAreCounted", await pane.getByRole("tab", { name: /^Console \(1 error\)/ }).isVisible());
  await page.getByRole("button", { name: "Load data" }).click();
  check("whatTheCodeLogsLaterShowsToo", await ok(tools.getByText("got true").waitFor({ timeout: 10_000 })));
  await pane.getByRole("tab", { name: /^Network/ }).click();
  const dataRow = tools.getByRole("row").filter({ hasText: "/data" });
  check("theNetworkShowsEachRequest", await ok(dataRow.first().waitFor({ timeout: 10_000 })) && /200/.test(await dataRow.first().innerText()) && /fetch/.test(await dataRow.first().innerText()), await tools.innerText());
  check("andThePageItself", (await tools.getByRole("row").filter({ hasText: "document" }).count()) >= 1);

  const fetchOnly = pane.getByRole("group", { name: "Kinds of request" }).getByRole("button", { name: "Fetch/XHR" });
  await fetchOnly.click();
  check("theNetworkFiltersByKind", (await tools.getByRole("row").filter({ hasText: "document" }).count()) === 0 && (await dataRow.count()) === 1);
  await dataRow.first().click();
  check("aRequestsDetailsShow", await ok(tools.getByRole("definition").filter({ hasText: /\/data$/ }).first().waitFor({ timeout: 5000 })));
  await pane.getByRole("group", { name: "Kinds of request" }).getByRole("button", { name: "All" }).click();

  // ---- JavaScript in the page, as DevTools' console runs it ----
  await pane.getByRole("tab", { name: /^Console/ }).click();
  const prompt = pane.getByRole("textbox", { name: "Run JavaScript in the page" });
  await prompt.fill("document.title + ' / ' + (1 + 1)");
  await prompt.press("Enter");
  check("javascriptRunsInThePage", await ok(tools.getByText("‹ Browser test / 2").waitFor({ timeout: 10_000 })));
  await prompt.fill('localStorage.setItem("theme", "dark"); "kept"');
  await prompt.press("Enter");
  await tools.getByText("‹ kept").waitFor({ timeout: 10_000 });
  await prompt.fill("missing.thing");
  await prompt.press("Enter");
  check("itsErrorsShowToo", await ok(tools.getByText(/ReferenceError: missing is not defined/).first().waitFor({ timeout: 10_000 })));

  // ---- The page's storage ----
  await pane.getByRole("tab", { name: "Application" }).click();
  const local = tools.getByRole("region", { name: "Local storage" });
  check("itsStorageShows", await ok(local.getByText("theme").waitFor({ timeout: 10_000 })) && (await local.getByText("dark").count()) === 1);
  await local.getByRole("button", { name: "Delete theme" }).click();
  check("aKeyCanBeDeleted", await ok(local.getByText("theme").waitFor({ state: "detached", timeout: 10_000 })));

  // ---- The Elements, as a tree ----
  await pane.getByRole("tab", { name: "Elements" }).click();
  const tree = tools.getByRole("list", { name: "The page's elements" });
  check("theElementsShowAsATree", await ok(tree.getByText("<html>").waitFor({ timeout: 10_000 })) && (await tree.getByText("<h1>").count()) === 1);
  await tree.getByRole("button", { name: /^<h1>/ }).click();
  check("pickingOneSaysWhatItIsAndWhereItsCodeIs", await ok(tools.getByRole("region", { name: "The element picked" }).getByText(/found by its text/).first().waitFor({ timeout: 10_000 })));

  // ---- SEO ----
  await pane.getByRole("tab", { name: "SEO" }).click();
  const found = tools.getByRole("list", { name: "What was found" });
  check("seoSaysWhatsMissing", await ok(found.getByText(/^Problem: No meta description/).waitFor({ timeout: 10_000 })) && (await found.getByText("Good: One h1.").count()) === 1 && (await found.getByText(/^Problem: No language on <html>/).count()) === 1, await found.innerText().catch(() => "none"));
  check("andShowsTheHeadings", (await tools.getByRole("region", { name: "Headings" }).getByText(heading).count()) === 1);

  // ---- Performance: what the browser measured ----
  await pane.getByRole("tab", { name: "Performance" }).click();
  const fcp = tools.getByRole("list", { name: "Web Vitals" }).getByRole("listitem").filter({ hasText: "First Contentful Paint" });
  check("theWebVitalsAreMeasured", await ok(fcp.getByText(/^\d+ ms$/).waitFor({ timeout: 10_000 })), await fcp.innerText().catch(() => "none"));
  // ---- Lighthouse: Google's own, in the sandbox ----
  await pane.getByRole("tab", { name: "Lighthouse" }).click();
  await tools.getByRole("combobox", { name: "Device" }).selectOption("desktop");
  for (const category of ["Performance", "Accessibility", "Best practices"]) await tools.getByRole("checkbox", { name: category }).uncheck();
  await tools.getByRole("button", { name: "Run Lighthouse" }).click();
  check("lighthouseSaysItsRunning", await ok(tools.getByRole("status").getByText(/Running Lighthouse on \//).waitFor({ timeout: 5000 })));
  const scores = tools.getByRole("list", { name: "Scores" });
  check("lighthouseGivesAScore", await ok(scores.getByText("SEO").waitFor({ timeout: 180_000 })) && /^\d+$/.test((await scores.getByRole("listitem").first().innerText()).split("\n")[0].trim()), await tools.innerText().catch(() => ""));
  check("andWhatToFix", await ok(tools.getByRole("region", { name: /SEO: what to fix/ }).getByText(/meta description/i).first().waitFor({ timeout: 5000 })));
  await tools.getByRole("button", { name: "The full report" }).click();
  const report = a.getByRole("dialog", { name: "Lighthouse's report" });
  check("itsFullReportOpensSafely", await ok(report.locator('iframe[title="Lighthouse\'s full report"][sandbox="allow-scripts allow-popups"]').waitFor({ timeout: 10_000 })) && (await ok(report.frameLocator("iframe").getByText(/Search Engine Optimization|SEO/).first().waitFor({ timeout: 20_000 }))));
  await a.keyboard.press("Escape");
  await pane.getByRole("tab", { name: /^Console/ }).click();

  // ---- Moving about ----
  await page.getByRole("link", { name: "Second page" }).click();
  check("followingALinkMovesTheAddress", await ok(a.waitForFunction(() => document.querySelector('[aria-label="Address"]')?.value === "/second", null, { timeout: 10_000 })));
  await pane.getByRole("button", { name: "Back", exact: true }).click();
  check("backGoesBack", await ok(page.getByRole("heading", { name: heading }).waitFor({ timeout: 10_000 })));
  await pane.getByRole("combobox", { name: "Width" }).selectOption("768");
  check("aTabletsWidth", Math.round((await a.locator('iframe[title^="The page"]').boundingBox())?.width ?? 0) === 768);
  await pane.getByRole("combobox", { name: "Width" }).selectOption("");
  const [tab] = await Promise.all([context.waitForEvent("page", { timeout: 15_000 }), pane.getByRole("button", { name: "Open in a new tab" }).click()]);
  await tab.waitForLoadState("domcontentloaded").catch(() => {});
  check("itOpensInATabOfItsOwn", await ok(tab.getByRole("heading", { name: heading }).waitFor({ timeout: 20_000 })), tab.url());
  await tab.close();

  // ---- Click to code ----
  const inspect = async (target) => {
    await pane.getByRole("button", { name: "Click to code" }).click();
    await sleep(300);
    await target.click();
  };
  await a.getByRole("tab", { name: "README.md" }).first().click().catch(() => {});
  await inspect(page.getByRole("heading", { name: heading }));
  check("clickingAnElementOpensItsCode", await ok(activeTab(serverFile).waitFor({ timeout: 10_000 })));
  await sleep(500);
  check("atItsLine", (await cursorLine()) === 2, await cursorLine());
  check("theElementSaysHowItWasFound", await ok(tools.getByText(/found by its text/).waitFor({ timeout: 5000 })) && /h1/.test(await tools.innerText()));
  check("clickToCodeTurnsItselfOff", (await pane.getByRole("button", { name: "Click to code" }).getAttribute("aria-pressed")) === "false");
  await inspect(page.getByText("React made this"));
  await sleep(800);
  check("reactsSourceOpensItsLine", (await cursorLine()) === 3 && (await tools.getByText("Component: Widget").count()) === 1 && /as the page's react build says/.test(await tools.innerText()), { line: await cursorLine(), tools: await tools.innerText() });
  await inspect(page.getByText("Vue made this"));
  // LOOK=<file.png>: a picture of the room with its browser, for whoever's checking how it looks.
  if (process.env.LOOK) await a.screenshot({ path: process.env.LOOK });
  check("vuesFileOpens", await ok(tools.getByText(/as the page's vue build says/).waitFor({ timeout: 5000 })) && (await tools.getByText("Component: Card").count()) === 1);
  // Clicking in click to code doesn't press what's under it.
  await pane.getByRole("tab", { name: /^Console/ }).click();
  const before = await tools.getByText("got true").count();
  await inspect(page.getByRole("button", { name: "Load data" }));
  await sleep(1000);
  // What was picked shows in the Element tab: the console is looked at in its own.
  await pane.getByRole("tab", { name: /^Console/ }).click();
  check("clickToCodeDoesntPressWhatItPicks", (await tools.getByText("got true").count()) === before, { before, after: await tools.getByText("got true").count() });
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
  await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/room-browser.png` }).catch(() => {});
} finally {
  await a.getByRole("button", { name: /^Stop/ }).first().click().catch(() => {});
  await pane.getByRole("button", { name: "Close the browser" }).click().catch(() => {});
  const made = a.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name: serverFile, exact: true });
  await made.press("Delete").catch(() => {});
  await made.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  check("itsFileIsRemoved", (await made.count()) === 0);
  await browser.close();
  check("noPageErrors", errors.length === 0, errors.join(" | "));
}
finish();
