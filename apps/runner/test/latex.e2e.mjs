// LaTeX for real, in E2ETST on the full image: real TeX Live, latexmk and biber, inside the jail with no network. A paper with chapters and a bibliography
// makes a real PDF, mistakes come back by file and line with the last good PDF still there, and a paper can't reach outside what the room's code could.
// The test's files and what the builds made are removed. Needs SANDBOX_IMAGE to be the full image, and pnpm sandbox:build:full.
//   node --env-file=../../.env test/latex.e2e.mjs        (from apps/runner, with the dev stack running; SLOW=1 also waits out a build that never ends)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, setFileText, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 700)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const token = (room = ROOM) => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: room, uid: "e2e-user", name: "E2E" })}`;
const ask = async (body) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/latex`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
  return { status: response.status, body: await response.json() };
};

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

async function run(path) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ path, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }), signal: AbortSignal.timeout(60_000) });
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data;
    }
  }
  return output;
}

const stamp = Date.now().toString(36);
const FOLDER = `latex-test-${stamp}`;
const MAIN = `${FOLDER}/main.tex`;
const CHAPTER = `${FOLDER}/chapters/one.tex`;
const BIB = `${FOLDER}/refs.bib`;
let scripts = 0;
async function shell(text) {
  const path = `latex-${stamp}-${(scripts += 1)}.sh`;
  createFileAtPath(doc, path, text);
  await sleep(1000);
  const output = await run(path);
  const node = findByPath(doc, path);
  if (node) trash(doc, node.id);
  return output;
}
const write = (path, content) => {
  const node = findByPath(doc, path);
  if (node) setFileText(doc, node.id, content);
  else createFileAtPath(doc, path, content);
};
const vector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");
const build = async (file = MAIN, extra = {}) => ask({ op: "build", file, stateVector: vector(), ...extra });
const errorsOf = (result) => (result.body.problems ?? []).filter((item) => item.severity === "error");
const warningsOf = (result) => (result.body.problems ?? []).filter((item) => item.severity === "warning");

const PAPER = `\\documentclass{article}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,graphicx,booktabs,tikz,siunitx}
\\usepackage[style=numeric,backend=biber]{biblatex}
\\addbibresource{refs.bib}
\\title{A test paper}
\\begin{document}
\\maketitle
\\include{chapters/one}
\\printbibliography
\\end{document}
`;
const CHAPTER_TEXT = `\\section{One}
Knuth wrote about this~\\cite{knuth}.
\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}
A speed of \\SI{3e8}{\\metre\\per\\second}.
`;
const REFERENCES = `@book{knuth,
  title = {The {TeX}book},
  author = {Knuth, Donald E.},
  year = {1984},
  publisher = {Addison-Wesley},
}
`;

try {
  write(MAIN, PAPER);
  write(CHAPTER, CHAPTER_TEXT);
  write(BIB, REFERENCES);

  const before = await ask({ op: "status", file: MAIN });
  check("nothingIsBuiltAtFirst", before.status === 200 && before.body.built === false && before.body.pdfAt === null, before.body);
  const noPdf = await ask({ op: "pdf", file: MAIN });
  check("soThereIsNoPdf", noPdf.status === 422 && /hasn't made a PDF/.test(noPdf.body.error), noPdf.body);

  // ---- A real paper ----
  const started = Date.now();
  const first = await build();
  console.log(`      the first build took ${Math.round((Date.now() - started) / 100) / 10} s`);
  check("aPaperBuilds", first.status === 200 && first.body.ok === true, first.body.problems ?? first.body);
  check("withNoErrors", errorsOf(first).length === 0, errorsOf(first));
  check("itSaysHowLong", first.body.pages >= 2 && first.body.bytes > 1000 && first.body.ms > 0 && first.body.at > 0, first.body);
  const pdf = await ask({ op: "pdf", file: MAIN });
  const bytes = Buffer.from(pdf.body.base64 ?? "", "base64");
  check("theResultIsARealPdf", pdf.status === 200 && bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length === first.body.bytes, { status: pdf.status, length: bytes.length });
  check("thatEndsAsOneShould", bytes.subarray(-32).toString().includes("%%EOF"));
  const bbl = await shell(`cat "$HOME"/paper/*/main.bbl | grep -c "Knuth"; cd "/workspace/${FOLDER}" && find . -type f | sort\n`);
  check("biberRanAndFoundTheReference", /^[1-9]/m.test(bbl), bbl);
  check("whatItMakesStaysOutOfTheRoomsFiles", !/\.(aux|log|pdf|bbl|fls|fdb_latexmk|blg|bcf)\b/.test(bbl), bbl);
  check("norInTheTree", !flatten(listTree(doc)).some((node) => node.path.startsWith(`${FOLDER}/`) && /\.(aux|log|pdf|bbl)$/.test(node.path)));
  const again = await ask({ op: "status", file: MAIN });
  check("anyoneCanReadTheResult", again.body.built === true && again.body.at === first.body.at && again.body.pdfAt === first.body.pdfAt, again.body);

  // ---- What's just been typed ----
  write(CHAPTER, `${CHAPTER_TEXT}\\newpage\nAnother page.\n\\newpage\nAnd another.\n`);
  const typed = await build();
  check("aBuildHasWhatWasJustTyped", typed.body.ok === true && typed.body.pages === first.body.pages + 2, { first: first.body.pages, now: typed.body.pages, problems: typed.body.problems });
  write(CHAPTER, CHAPTER_TEXT);

  // ---- Mistakes ----
  const goodPdfAt = (await build()).body.pdfAt;
  write(CHAPTER, `\\section{One}\nFine so far.\n\\notARealCommand{here}\n`);
  const typo = await build();
  const problem = errorsOf(typo)[0];
  check("aTypoIsAnError", typo.status === 200 && typo.body.ok === false, typo.body.ok);
  check("inTheRightFile", problem?.file === CHAPTER, problem);
  check("onTheRightLine", problem?.line === 3, problem);
  check("sayingWhatsWrong", /Undefined control sequence/.test(problem?.message ?? ""), problem);
  check("andShowingTheLine", /notARealCommand/.test(problem?.context ?? ""), problem);
  check("aPdfStillThere", typo.body.pdfAt !== null && (await ask({ op: "pdf", file: MAIN })).status === 200, typo.body.pdfAt);
  check("withTheLogToRead", /Undefined control sequence/.test(typo.body.log), typo.body.log?.slice(-200));
  write(CHAPTER, CHAPTER_TEXT);

  write(MAIN, PAPER.replace("\\usepackage[T1]{fontenc}", "\\usepackage{no_such_package_here}"));
  const missing = await build();
  check("aMissingPackageSaysWhichFirst", missing.body.ok === false && /no_such_package_here/.test(errorsOf(missing)[0]?.message ?? "") && errorsOf(missing)[0]?.file === MAIN && errorsOf(missing)[0]?.line >= 2, missing.body.problems);
  check("withoutWhatFollowsFromIt", !errorsOf(missing).some((item) => /Emergency stop|Fatal error occurred/.test(item.message)), missing.body.problems);
  write(MAIN, PAPER);

  write(CHAPTER, `${CHAPTER_TEXT}And~\\cite{nobody}.\n`);
  const uncited = await build();
  check("aCitationNotInTheBibIsAWarningNotAFailure", uncited.body.ok === true && warningsOf(uncited).some((item) => /nobody/.test(item.message)), uncited.body.problems);
  write(CHAPTER, CHAPTER_TEXT);

  write(BIB, "@book{knuth,\n  title = {Broken\n");
  const badBib = await build();
  check("aBrokenBibSaysSo", (badBib.body.problems ?? []).some((item) => /bib|BibTeX/i.test(item.message)), badBib.body.problems ?? badBib.body);
  write(BIB, REFERENCES);

  const fixed = await build();
  check("fixingThemClearsThem", fixed.body.ok === true && errorsOf(fixed).length === 0, fixed.body.problems);
  check("andMakesANewPdf", fixed.body.pdfAt > goodPdfAt, { fixed: fixed.body.pdfAt, goodPdfAt });

  // ---- From scratch, and two at once ----
  const fresh = await build(MAIN, { fresh: true });
  check("itCanBuildFromScratch", fresh.body.ok === true && fresh.body.pages === fixed.body.pages, fresh.body.problems);
  const together = await Promise.all([build(), build()]);
  check("twoAtOnceBothFinish", together.every((item) => item.status === 200 && item.body.ok === true), together.map((item) => item.body.problems));

  // ---- A second paper ----
  const SECOND = `${FOLDER}/other paper.tex`;
  write(SECOND, "\\documentclass[conference]{IEEEtran}\n\\begin{document}\n\\title{A journal's class}\n\\maketitle\nHello.\n\\end{document}\n");
  const second = await build(SECOND);
  check("aJournalsClassWorksAndSpacesInANameDo", second.body.ok === true && second.body.file === SECOND, second.body.problems ?? second.body);
  check("andTheFirstKeepsItsOwnResult", (await ask({ op: "status", file: MAIN })).body.pages === together[0].body.pages);

  // ---- What a paper can't do ----
  const marker = `/tmp/latex-pwned-${stamp}`;
  const ESCAPE = `${FOLDER}/escape.tex`;
  write(ESCAPE, `\\documentclass{article}\n\\begin{document}\n\\immediate\\write18{touch ${marker}}\nHello.\n\\end{document}\n`);
  const escaped = await build(ESCAPE);
  check("itCantRunCommands", /runsystem\(touch .*disabled/.test(escaped.body.log ?? ""), escaped.body.log?.slice(-300) ?? escaped.body);
  check("soNothingHappened", /GONE/.test(await shell(`[ -e ${marker} ] && echo THERE || echo GONE\n`)));

  if (process.env.SLOW) {
    const LOOP = `${FOLDER}/loop.tex`;
    write(LOOP, "\\documentclass{article}\n\\begin{document}\n\\def\\a{\\a}\\a\n\\end{document}\n");
    const looped = await build(LOOP);
    check("aBuildThatNeverEndsIsStopped", errorsOf(looped).some((item) => /still building/.test(item.message)), looped.body.problems ?? looped.body);
    check("andNothingIsLeftRunning", /NONE/.test(await shell(`pgrep -c pdflatex > /dev/null && echo RUNNING || echo NONE\n`)));
  }

  // ---- What a request can't do ----
  const noFile = await build(`${FOLDER}/no-such.tex`);
  check("aFileThatIsntThereIsRefused", noFile.status === 422 && /no file called/.test(noFile.body.error), noFile.body);
  for (const file of ["../etc/passwd.tex", "/etc/x.tex", `${FOLDER}/../../x.tex`, `${FOLDER}/main.pdf`]) {
    const refused = await ask({ op: "build", file });
    check(`refused ${file}`, refused.status === 400, refused.body);
  }
  const unknown = await ask({ op: "clean", file: MAIN });
  check("anUnknownRequestIsRefused", unknown.status === 400, unknown.body);
  const forged = await fetch(`${RUNNER}/rooms/${ROOM}/latex`, { method: "POST", headers: { authorization: token("TEAM22"), "content-type": "application/json" }, body: JSON.stringify({ op: "status", file: MAIN }) });
  check("anotherRoomsTokenIsRefused", forged.status === 401);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(800);
  await shell(`rm -rf "$HOME/paper"; echo CLEAN\n`).catch(() => {});
  await sleep(800);
  check("theTestsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER) || item.path.startsWith(`latex-${stamp}`)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
