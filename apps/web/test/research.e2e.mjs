// The Research layout in a browser, with real LaTeX behind it: a room from the research template opens on its paper with the PDF beside it and its
// references; mistakes show by line and take you there; citing, \cite completion, adding by DOI (the lookup is stood in for, so it needs no internet);
// the notebook makes the figure the paper uses; and two people see the same PDF. The room and files it makes are removed.
//   node test/research.e2e.mjs        (from apps/web, with the dev stack running on the full sandbox image)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stamp = Date.now().toString(36);

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const headers = { origin: BASE };
let researchRoom = null;

const pdfPane = a.getByRole("region", { name: "PDF" });
const references = a.getByRole("region", { name: "References" });
const apps = a.getByRole("group", { name: "Apps" });
const editor = a.locator(".monaco-editor").first();
const built = pdfPane.getByRole("status").filter({ hasText: /\d+ pages?, built at/ });
const build = async () => {
  const done = a.waitForResponse((response) => response.url().endsWith("/latex") && /"op":"build"/.test(response.request().postData() ?? ""), { timeout: 150_000 });
  await pdfPane.getByRole("button", { name: "Build", exact: true }).click();
  await done;
  await sleep(400);
};
/** The PDF the pane is showing, as bytes' first characters, from its own link. */
const pdfHead = () =>
  a.evaluate(async () => {
    const frame = document.querySelector('[aria-label="PDF"] iframe');
    if (!frame) return null;
    const bytes = await (await fetch(frame.src)).arrayBuffer();
    return { start: new TextDecoder().decode(bytes.slice(0, 5)), size: bytes.byteLength };
  });
const logText = async () => {
  const show = pdfPane.getByRole("button", { name: "What LaTeX said" });
  if ((await show.getAttribute("aria-expanded")) !== "true") await show.click();
  return pdfPane.getByLabel("What LaTeX said", { exact: true }).last().innerText();
};
const inEditor = () => a.evaluate(() => [...document.querySelectorAll(".monaco-editor .view-line")].map((line) => line.textContent).join("\n"));

try {
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/latex`, { headers, data: { op: "status", file: "a.tex" } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  const lookupRefused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/references/lookup`, { headers, data: { id: "10.1038/nature14539" } });
  check("signedOutCantLookUp", lookupRefused.status() === 401, lookupRefused.status());
  await outside.close();

  // ---- A room made for research ----
  const created = await a.request.post(`${BASE}/api/rooms`, { headers, data: { name: `Research test ${stamp}`, templateId: "research" } });
  check("aResearchRoomIsMade", created.ok(), created.status());
  researchRoom = (await created.json()).id;
  await a.goto(`${BASE}/rooms/${researchRoom}`);
  await apps.waitFor({ timeout: 40_000 });

  check("itOpensInTheResearchLayout", await ok(a.getByRole("button", { name: /^Research layout/ }).waitFor({ timeout: 15_000 })));
  check("thePaperIsOpen", await ok(a.getByRole("tab", { name: /main\.tex/ }).waitFor({ timeout: 20_000 })));
  check("itsPdfPaneIsOpen", await ok(pdfPane.waitFor({ timeout: 15_000 })));
  check("itsReferencesAreOpen", await ok(references.getByRole("list", { name: "References in this room" }).getByRole("listitem").nth(2).waitFor({ timeout: 15_000 })), await references.innerText().catch(() => ""));
  check("theyReadAsTheyWouldInPrint", await ok(references.getByRole("button", { name: "The TeXbook" }).waitFor({ timeout: 3000 })) && (await references.getByText("LeCun et al. · 2015 · Nature").count()) === 1, await references.innerText());
  const shownApps = await apps.getByRole("button").evaluateAll((all) => all.map((item) => item.getAttribute("aria-label") ?? item.textContent));
  check("onlyTheAppsForResearchShow", ["Docs", "Databases", "Flow", "Lakehouse", "Diagrams", "Whiteboard"].every((name) => shownApps.includes(name)) && !["API", "MCP", "Kubernetes", "Design", "Prompts", "Analysis"].some((name) => shownApps.includes(name)), shownApps);
  check("debuggingIsOutOfTheWay", (await a.getByRole("button", { name: "Run and debug", exact: true }).count()) === 0);
  check("theFilesAreThere", (await a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^paper/ }).count()) === 1);
  await a.waitForTimeout(800);
  const coloured = await a.evaluate(() => [...document.querySelectorAll(".monaco-editor .view-line span span")].some((span) => span.textContent?.startsWith("\\documentclass") && !/mtk1\b/.test(span.className)));
  check("latexHasColours", coloured);

  // ---- Building ----
  check("itSaysToBuild", await ok(pdfPane.getByText("Press Build to make the PDF.").waitFor({ timeout: 15_000 })), await pdfPane.innerText());
  const started = Date.now();
  await build();
  console.log(`      the first build took ${Math.round((Date.now() - started) / 100) / 10} s`);
  check("itBuilds", await ok(built.waitFor({ timeout: 10_000 })), await pdfPane.innerText());
  check("thePdfIsShown", await ok(pdfPane.locator("iframe").waitFor({ timeout: 15_000 })));
  const head = await pdfHead();
  check("itsARealPdf", head?.start === "%PDF-" && head.size > 1000, head);
  check("itCanBeDownloaded", (await pdfPane.getByRole("link", { name: "Download main.pdf" }).getAttribute("download")) === "main.pdf");
  check("withItsReferences", /main\.bbl/.test(await logText()), (await logText()).slice(-300));
  check("beforeTheNotebookItAsksForTheFigure", !/results\.png/.test(await logText()), (await logText()).slice(-200));

  // ---- A mistake ----
  await editor.click({ position: { x: 140, y: 40 } });
  await a.keyboard.press("Control+Home");
  for (let i = 0; i < 16; i++) await a.keyboard.press("ArrowDown");
  await a.keyboard.press("End");
  await a.keyboard.press("Enter");
  await a.keyboard.insertText("\\notARealCommand");
  await sleep(500);
  const typedLine = /Ln (\d+)/.exec(await a.locator("footer").innerText())?.[1];
  await build();
  const problems = pdfPane.getByRole("list", { name: "Problems in the build" });
  check("aMistakeSaysWhatsWrong", await ok(problems.getByText("Undefined control sequence.").waitFor({ timeout: 10_000 })), await pdfPane.innerText());
  check("whereItIs", (await problems.innerText()).includes(`paper/main.tex:${typedLine}`), { typedLine, shown: await problems.innerText() });
  check("andShowsTheLine", /notARealCommand/.test(await problems.innerText()));
  check("itSaysThereWasAnError", await ok(pdfPane.getByRole("status").filter({ hasText: /^1 error/ }).waitFor({ timeout: 3000 })), await pdfPane.innerText());
  check("thePdfStays", (await pdfPane.locator("iframe").count()) === 1);
  await a.getByRole("tab", { name: /references\.bib|README/ }).first().click().catch(() => {});
  await problems.getByRole("button").first().click();
  await sleep(600);
  check("pressingItGoesThere", (await a.locator(".monaco-editor .current-line").count()) > 0 && (await a.locator("footer").innerText()).includes(`Ln ${typedLine},`), await a.locator("footer").innerText());
  await a.keyboard.press("End");
  for (let i = 0; i < "\\notARealCommand".length; i++) await a.keyboard.press("Backspace");
  await sleep(500);
  await build();
  check("fixingItClearsIt", await ok(built.waitFor({ timeout: 10_000 })), await pdfPane.innerText());

  // ---- As I type ----
  await pdfPane.getByRole("switch", { name: "As I type" }).click();
  const pagesBefore = await built.innerText();
  await editor.click({ position: { x: 140, y: 40 } });
  // Before \\printbibliography, inside the document.
  await a.keyboard.press("Control+End");
  await a.keyboard.press("ArrowUp");
  await a.keyboard.press("ArrowUp");
  await a.keyboard.press("Home");
  await a.keyboard.insertText("\\newpage Another page.\\newpage And another.");
  check("itBuildsAfterAPauseInTyping", await ok(a.waitForFunction((before) => {
    const status = document.querySelector('[aria-label="PDF"] [role="status"]');
    return status && /\d+ pages?, built at/.test(status.textContent ?? "") && status.textContent?.split(",")[0] !== before.split(",")[0];
  }, pagesBefore, { timeout: 40_000 })), await pdfPane.innerText());
  await pdfPane.getByRole("switch", { name: "As I type" }).click();
  for (let i = 0; i < "\\newpage Another page.\\newpage And another.".length; i++) await a.keyboard.press("Backspace");

  // ---- Citing ----
  await editor.click({ position: { x: 140, y: 40 } });
  await a.keyboard.press("Control+End");
  await a.keyboard.press("Enter");
  await references.getByRole("button", { name: "Cite knuth1984texbook" }).click();
  await sleep(500);
  check("citingPutsItInThePaper", (await inEditor()).includes("\\cite{knuth1984texbook}"), (await inEditor()).slice(-200));
  await a.keyboard.press("Enter");
  await a.keyboard.insertText("\\cite{");
  check("citeCompletesFromTheRoomsReferences", await ok(a.locator(".suggest-widget .monaco-list-row").filter({ hasText: "lecun2015deep" }).waitFor({ timeout: 8000 })), await a.locator(".suggest-widget").innerText().catch(() => "no widget"));
  check("sayingWhoItIs", /LeCun et al\. 2015/.test(await a.locator(".suggest-widget").innerText()), await a.locator(".suggest-widget").innerText());
  await a.keyboard.press("Escape");

  // ---- Adding by DOI: what comes back is stood in for, so this needs no internet ----
  const invalid = references.getByLabel("Add by DOI or arXiv id");
  await invalid.fill("not a doi");
  await references.getByRole("button", { name: "Add", exact: true }).click();
  check("somethingThatIsntADoiIsRefused", await ok(references.getByRole("alert").getByText(/doesn't look like a DOI/).waitFor({ timeout: 10_000 })), await references.innerText());
  await a.route("**/references/lookup", (route) => route.fulfill({ json: { bibtex: "@article{Hinton_2006, title={A fast learning algorithm for deep belief nets}, author={Hinton, Geoffrey E. and Osindero, Simon and Teh, Yee-Whye}, journal={Neural Computation}, year={2006}, doi={10.1162/neco.2006.18.7.1527}}" } }));
  await invalid.fill("https://doi.org/10.1162/neco.2006.18.7.1527");
  await references.getByRole("button", { name: "Add", exact: true }).click();
  check("aDoiAddsTheReference", await ok(references.getByRole("button", { name: "A fast learning algorithm for deep belief nets" }).waitFor({ timeout: 10_000 })), await references.innerText());
  check("clearingTheBox", (await invalid.inputValue()) === "");
  await invalid.fill("10.1162/neco.2006.18.7.1527");
  await references.getByRole("button", { name: "Add", exact: true }).click();
  check("addingItAgainSaysItsThere", await ok(references.getByRole("alert").getByText(/already here, as Hinton_2006/).waitFor({ timeout: 10_000 })), await references.innerText());
  await a.unroute("**/references/lookup");
  await references.getByLabel("Search references").fill("hinton 2006");
  check("searchFindsIt", (await references.getByRole("list", { name: "References in this room" }).getByRole("listitem").count()) === 1);
  await references.getByLabel("Search references").fill("");

  // ---- The notebook makes the figure the paper uses ----
  const files = a.getByRole("tree", { name: "Files" });
  const notebookRow = files.getByRole("treeitem", { name: /^analysis\.ipynb/ });
  if (!(await notebookRow.count())) await files.getByRole("treeitem", { name: /^analysis$/ }).click();
  await notebookRow.click();
  const notebook = a.getByRole("region", { name: "Notebook analysis.ipynb" });
  check("theNotebookOpens", await ok(notebook.waitFor({ timeout: 20_000 })), "");
  await a.getByRole("button", { name: "Run all", exact: true }).click();
  check("itFindsTheLine", await ok(notebook.getByText(/response = 1\.\d+ x dose/).waitFor({ timeout: 90_000 })), await notebook.innerText());
  check("theFigureAppearsInTheFiles", await ok(files.getByRole("treeitem", { name: /^figures/ }).waitFor({ timeout: 20_000 })));
  await a.getByRole("tab", { name: /main\.tex/ }).click();
  await a.getByRole("button", { name: "PDF", exact: true }).waitFor({ timeout: 5000 });
  if ((await a.getByRole("button", { name: "PDF", exact: true }).getAttribute("aria-pressed")) !== "true") await a.getByRole("button", { name: "PDF", exact: true }).click();
  await pdfPane.waitFor({ timeout: 10_000 });
  await build();
  check("thePaperNowHasIt", /figures\/results\.png/.test(await logText()), (await logText()).slice(-300));

  // ---- Switching layouts ----
  await a.getByRole("button", { name: /^Research layout/ }).click();
  check("itCanGoBackToTheCodeLayout", await ok(a.getByRole("button", { name: /^Code layout/ }).waitFor({ timeout: 5000 })));
  check("whereEveryAppIsBack", await ok(apps.getByRole("button", { name: "API", exact: true }).waitFor({ timeout: 5000 })) && (await a.getByRole("button", { name: "Run and debug", exact: true }).count()) === 1);
  await a.reload();
  await apps.waitFor({ timeout: 40_000 });
  check("andItsRemembered", await ok(a.getByRole("button", { name: /^Code layout/ }).waitFor({ timeout: 15_000 })));

  // ---- A person's own room in the code layout, and two people ----
  await a.goto(`${BASE}/rooms/${ROOM}`);
  await apps.waitFor({ timeout: 40_000 });
  const name = `paper_${stamp}.tex`;
  const row = files.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  await sleep(500);
  await editor.click({ position: { x: 140, y: 40 } });
  await a.keyboard.insertText("\\documentclass{article}\n\\begin{document}\nA paper by two people.\n\\end{document}\n");
  await sleep(800);
  check("aTexFileOffersItsPdfInAnyLayout", (await a.getByRole("button", { name: "PDF", exact: true }).count()) === 1);
  check("referencesStayOutOfACodeRoomWithNoBib", (await a.getByRole("tab", { name: "References" }).count()) === 0);
  await a.getByRole("button", { name: "PDF", exact: true }).click();
  await pdfPane.waitFor({ timeout: 10_000 });
  const { page: b } = await signIn("test2@codechatter.local");
  const theirFile = b.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
  await theirFile.waitFor({ timeout: 30_000 });
  await theirFile.click();
  await b.getByRole("button", { name: "PDF", exact: true }).click();
  const theirPane = b.getByRole("region", { name: "PDF" });
  await theirPane.waitFor({ timeout: 10_000 });
  await build();
  await built.waitFor({ timeout: 15_000 });
  check("whatOnePersonBuildsTheOtherSees", await ok(theirPane.locator("iframe").waitFor({ timeout: 20_000 })), await theirPane.innerText());
  check("withTheSameResult", /1 page, built at/.test(await theirPane.innerText()), await theirPane.innerText());
  await b.context().close();
  await a.getByRole("button", { name: "Close the PDF" }).click();
  await row.focus();
  await a.keyboard.press("Delete");
  await sleep(800);
  check("itsFileIsRemoved", (await row.count()) === 0);

  // ---- Who may ----
  const bad = await a.request.post(`${BASE}/api/rooms/${ROOM}/latex`, { headers, data: { op: "build", file: "../../etc/x.tex" } });
  check("aPathOutOfTheRoomIsRefused", bad.status() === 400, bad.status());
} catch (error) {
  console.error(error);
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  await a.unrouteAll().catch(() => {});
  if (researchRoom) {
    const gone = await a.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE", credentials: "same-origin" }).then((response) => response.status), researchRoom).catch(() => 0);
    check("theTestRoomIsDeleted", gone >= 200 && gone < 300, gone);
  }
  check("noPageErrors", errors.length === 0, errors.join(" | "));
}
await browser.close();
finish();
