// The Flow tool for real, in E2ETST: a dbt project in the room's files, read and built by real dbt on DuckDB, inside the jail with no network.
// Its graph, a build watched as it goes, rows and a profile that match what's worked out here, the rows a check found, recipes that fail, a
// check that holds back what's made after it, stopping, and a project dbt can't read. The test's files and everything dbt made are removed.
//   node --env-file=../../.env test/flow.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const token = (room = ROOM) => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: room, uid: "e2e-user", name: "E2E Tester" })}`;
const ask = async (body) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/flow`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
  return { status: response.status, body: await response.json() };
};
const until = async (what, condition, ms = 60_000) => {
  const by = Date.now() + ms;
  let last;
  while (Date.now() < by) {
    last = await what();
    if (condition(last)) return last;
    await sleep(800);
  }
  return last;
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
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ path, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }), signal: AbortSignal.timeout(200_000) });
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
const FOLDER = `flow-test-${stamp}`;
const inFolder = (path) => `${FOLDER}/${path}`;
let scripts = 0;
/** Runs a shell script in the room, as a Run does. */
async function shell(text) {
  const path = `flow-${stamp}-${(scripts += 1)}.sh`;
  createFileAtPath(doc, path, text);
  await sleep(1200);
  const output = await run(path);
  const node = findByPath(doc, path);
  if (node) trash(doc, node.id);
  return output;
}
const write = (path, content) => {
  const node = findByPath(doc, inFolder(path));
  if (node) setFileText(doc, node.id, content);
  else createFileAtPath(doc, inFolder(path), content);
};
const remove = (path) => {
  const node = findByPath(doc, inFolder(path));
  if (node) trash(doc, node.id);
};

// Everything the numbers below are checked against is worked out from this.
const ORDERS = [
  [1, "Pune", 120.5],
  [2, "Delhi", 80],
  [2, "Delhi", 80],
  [3, "pune", null],
  [4, "Agra", 12],
  [5, "Delhi", 300],
  [6, "Pune", 45],
];
const CSV = `order_id,city,amount\n${ORDERS.map(([id, city, amount]) => `${id},${city},${amount ?? ""}`).join("\n")}\n`;
const titled = (city) => city[0].toUpperCase() + city.slice(1).toLowerCase();
const clean = [...new Map(ORDERS.map((order) => [order[0], [order[0], titled(order[1]), order[2]]])).values()];
const byCity = new Map();
for (const [, city, amount] of clean) {
  const seen = byCity.get(city) ?? { orders: 0, total: 0 };
  byCity.set(city, { orders: seen.orders + 1, total: seen.total + (amount ?? 0) });
}
const top = [...byCity.entries()].sort((a, b) => b[1].total - a[1].total)[0];

const CLEAN_SQL = `select distinct order_id, upper(city[1]) || lower(city[2:]) as city, amount\nfrom {{ ref('raw_orders') }}\n`;
const BY_CITY_SQL = `select city, count(*) as orders, sum(amount) as total\nfrom {{ ref('clean_orders') }}\ngroup by city\n`;
const TOP_PY = `def model(dbt, session):\n    frame = dbt.ref("orders_by_city").df()\n    return frame.sort_values("total", ascending=False).head(1)\n`;
const SCHEMA = `version: 2
models:
  - name: clean_orders
    description: One row for each order
    columns:
      - name: order_id
        data_tests:
          - unique
          - not_null
      - name: amount
        data_tests:
          - not_null:
              config:
                severity: warn
`;

const ids = { seed: `seed.flow_test.raw_orders`, clean: `model.flow_test.clean_orders`, byCity: `model.flow_test.orders_by_city`, top: `model.flow_test.top_city` };
const finished = () => until(() => ask({ op: "status" }), (r) => r.body.state !== "running", 90_000);
const graphWith = (condition, ms = 40_000) => until(() => ask({ op: "graph" }), (r) => r.status === 200 && condition(r.body), ms);
const datasetOf = (graph, id) => graph.datasets.find((item) => item.id === id);

try {
  // Nothing left from a run that was cut short.
  for (const node of flatten(listTree(doc))) {
    if (!node.path.includes("/") && (node.name.startsWith("flow-test-") || node.name.startsWith("flow-") && node.name.endsWith(".sh"))) trash(doc, node.id);
  }
  await shell(`rm -rf "$HOME/flow"; echo CLEAN\n`);

  // ---- A room without a project ----
  const empty = await graphWith((graph) => graph.project === null, 15_000);
  check("aRoomWithoutAProjectSaysSo", empty.status === 200 && empty.body.project === null && empty.body.datasets.length === 0, empty.body);
  const nothingToBuild = await ask({ op: "build" });
  check("andCantBuild", nothingToBuild.status === 422 && /doesn't have a dbt project/.test(nothingToBuild.body.error), nothingToBuild.body);
  const idle = await ask({ op: "status" });
  check("nothingIsBeingBuilt", idle.status === 200 && idle.body.state === "idle", idle.body);

  // ---- A project in the room's files ----
  write("dbt_project.yml", `name: flow_test\nversion: "1.0"\nprofile: codechatter\nmodels:\n  flow_test:\n    +materialized: table\n`);
  write("seeds/raw_orders.csv", CSV);
  write("models/clean_orders.sql", CLEAN_SQL);
  write("models/orders_by_city.sql", BY_CITY_SQL);
  write("models/top_city.py", TOP_PY);
  write("models/schema.yml", SCHEMA);
  write("tests/amounts_arent_negative.sql", `select * from {{ ref('clean_orders') }} where amount < 0\n`);

  const started = Date.now();
  const first = await graphWith((graph) => graph.datasets.length === 4);
  console.log(`      reading the project took ${Math.round((Date.now() - started) / 100) / 10} s`);
  const graph = first.body;
  check("dbtReadsTheProject", graph.project?.path === FOLDER && graph.project?.name === "flow_test" && graph.problem === null, graph);
  check("itFindsEachDataset", [ids.seed, ids.clean, ids.byCity, ids.top].every((id) => datasetOf(graph, id)), graph.datasets?.map((item) => item.id));
  check("whatEachIsMadeFrom", datasetOf(graph, ids.clean)?.dependsOn.join() === ids.seed && datasetOf(graph, ids.byCity)?.dependsOn.join() === ids.clean && datasetOf(graph, ids.top)?.dependsOn.join() === ids.byCity && datasetOf(graph, ids.seed)?.dependsOn.length === 0, graph.datasets);
  check("whatLanguageItsIn", datasetOf(graph, ids.clean)?.language === "sql" && datasetOf(graph, ids.top)?.language === "python" && datasetOf(graph, ids.seed)?.language === null && datasetOf(graph, ids.seed)?.kind === "seed", graph.datasets);
  check("andWhereItsFileIs", datasetOf(graph, ids.top)?.file === inFolder("models/top_city.py") && datasetOf(graph, ids.seed)?.file === inFolder("seeds/raw_orders.csv"), graph.datasets);
  check("itReadsADescription", datasetOf(graph, ids.clean)?.description === "One row for each order");
  const checksOfClean = graph.checks.filter((item) => item.of === ids.clean);
  check("itFindsEachCheck", checksOfClean.length === 4, graph.checks);
  const amountCheck = graph.checks.find((item) => item.rule === "not_null" && item.column === "amount");
  check("withItsRuleAndColumn", amountCheck?.severity === "warn" && graph.checks.some((item) => item.rule === "unique" && item.column === "order_id" && item.severity === "error"), graph.checks);
  check("andOnesWrittenAsSql", graph.checks.some((item) => item.name === "amounts_arent_negative" && item.rule === null && item.file === inFolder("tests/amounts_arent_negative.sql")), graph.checks);
  check("nothingIsBuiltYet", graph.datasets.every((item) => item.result === null), graph.datasets);

  const unbuilt = await ask({ op: "preview", dataset: "clean_orders" });
  check("aDatasetNotBuiltSaysSo", unbuilt.status === 200 && unbuilt.body.built === false, unbuilt.body);
  const unbuiltProfile = await ask({ op: "profile", dataset: "clean_orders" });
  check("soDoesItsProfile", unbuiltProfile.status === 200 && unbuiltProfile.body.built === false, unbuiltProfile.body);

  // ---- A build, watched as it goes ----
  const buildStarted = Date.now();
  const build = await ask({ op: "build" });
  check("aBuildStarts", build.status === 200 && build.body.state === "running" && build.body.by === "E2E Tester", build.body);
  const second = await ask({ op: "build" });
  check("aSecondOneIsRefused", second.status === 422 && /already running/.test(second.body.error), second.body);
  const seenRunning = new Set();
  let done = build;
  while (Date.now() - buildStarted < 90_000) {
    done = await ask({ op: "status" });
    for (const [id, state] of Object.entries(done.body.nodes ?? {})) if (state === "running") seenRunning.add(id);
    if (done.body.state !== "running") break;
    await sleep(300);
  }
  console.log(`      the build took ${Math.round((Date.now() - buildStarted) / 100) / 10} s; seen running: ${[...seenRunning].length}`);
  check("itWarnsAsOneOrderHasNoAmount", done.body.state === "warned", done.body);
  const failedLines = (done.body.log ?? []).join("\n");
  check("withCounts", done.body.counts?.warned === 1 && done.body.counts?.failed === 0 && done.body.counts?.skipped === 0 && done.body.counts?.done === 7, done.body.counts);
  check("andWhatDbtSaid", /Completed with 1 warning/.test(failedLines) && !/\x1b\[/.test(failedLines), failedLines);

  const built = (await graphWith((item) => datasetOf(item, ids.top)?.result !== null)).body;
  check("everythingSaysHowItWent", datasetOf(built, ids.seed)?.result?.status === "success" && datasetOf(built, ids.clean)?.result?.status === "success" && datasetOf(built, ids.top)?.result?.status === "success", built.datasets);
  check("eachCheckToo", built.checks.find((item) => item.rule === "unique")?.result?.status === "pass" && built.checks.find((item) => item.id === amountCheck.id)?.result?.status === "warn" && built.checks.find((item) => item.id === amountCheck.id)?.result?.failures === 1, built.checks);

  // ---- The data, against what's worked out here ----
  const rows = await ask({ op: "preview", dataset: "clean_orders" });
  const sorted = [...rows.body.rows].sort((a, b) => Number(a[0]) - Number(b[0]));
  const expected = [...clean].sort((a, b) => a[0] - b[0]).map((row) => [String(row[0]), row[1], row[2] === null ? null : String(row[2])]);
  check("repeatedRowsAreGoneAndNamesTidied", JSON.stringify(sorted.map((row) => [row[0], row[1], row[2] === null ? null : String(Number(row[2]))])) === JSON.stringify(expected), { sorted, expected });
  check("itSaysTheColumns", rows.body.columns.join() === "order_id,city,amount" && rows.body.built === true && rows.body.truncated === false && rows.body.types?.length === 3, rows.body);
  const cities = await ask({ op: "preview", dataset: "orders_by_city" });
  const totals = new Map(cities.body.rows.map((row) => [row[0], { orders: Number(row[1]), total: Number(row[2]) }]));
  check("totalsMatchWhatsWorkedOutHere", cities.body.rows.length === byCity.size && [...byCity].every(([city, seen]) => totals.get(city)?.orders === seen.orders && totals.get(city)?.total === seen.total), { totals: [...totals], byCity: [...byCity] });
  const python = await ask({ op: "preview", dataset: "top_city" });
  check("aPythonRecipeRanWithPandas", python.body.rows.length === 1 && python.body.rows[0][0] === top[0] && Number(python.body.rows[0][2]) === top[1].total, python.body);

  const profile = await ask({ op: "profile", dataset: "clean_orders" });
  const amount = profile.body.columns?.find((item) => item.name === "amount");
  const city = profile.body.columns?.find((item) => item.name === "city");
  const amounts = clean.map((row) => row[2]).filter((item) => item !== null);
  check("aProfileCountsTheRows", profile.body.rows === clean.length && profile.body.columns?.length === 3, profile.body);
  check("itSaysHowMuchIsEmpty", Math.abs(amount?.nulls - (100 * (clean.length - amounts.length)) / clean.length) < 0.01, amount);
  check("itGivesTheSpread", Number(amount?.min) === Math.min(...amounts) && Number(amount?.max) === Math.max(...amounts) && Math.abs(Number(amount?.mean) - amounts.reduce((a, b) => a + b, 0) / amounts.length) < 0.001, amount);
  check("andTheCommonestValuesOfText", city?.top[0]?.value === "Pune" && city?.top[0]?.count === 3 && amount?.top.length === 0, city);

  const failing = await ask({ op: "failures", check: amountCheck.id });
  check("aCheckKeepsTheRowsItFound", failing.status === 200 && failing.body.rows.length === 1 && failing.body.rows[0].includes("3"), failing.body);
  const noRows = await ask({ op: "failures", check: built.checks.find((item) => item.rule === "unique").id });
  check("oneThatPassedFoundNone", noRows.status === 200 && noRows.body.rows.length === 0, noRows.body);

  // ---- What dbt makes stays out of the room's files, and it tells nobody ----
  const look = await shell(`cd "/workspace/${FOLDER}" && find . -type f | sort; echo; ls "$HOME/flow"; python3 -c "import json; a = json.load(open('$HOME/flow/target/run_results.json'))['args']; print('USAGE', a.get('send_anonymous_usage_stats'), a.get('version_check'))"\n`);
  check("nothingDbtMakesIsInTheFiles", !/\.\/(target|logs|dbt_packages)\//.test(look) && /warehouse\.duckdb/.test(look), look);
  check("norIsItInTheTree", !flatten(listTree(doc)).some((node) => node.path.startsWith(`${FOLDER}/`) && /(^|\/)(target|logs)(\/|$)|\.duckdb$/.test(node.path)));
  check("itSendsNothingAnywhere", /USAGE False False/.test(look), look);

  // ---- Building part of it ----
  // Straight after the last one finished: it says so just before it lets go.
  const part = await ask({ op: "build", dataset: "orders_by_city", scope: "needs" });
  check("aPartialBuildStarts", part.status === 200, part.body);
  const partDone = await finished();
  check("itBuildsThisAndWhatItsMadeFrom", partDone.body.nodes[ids.seed] && partDone.body.nodes[ids.clean] && partDone.body.nodes[ids.byCity] && !partDone.body.nodes[ids.top], partDone.body.nodes);
  await ask({ op: "build", dataset: "orders_by_city", scope: "after" });
  const afterDone = await finished();
  check("orThisAndWhatsMadeFromIt", afterDone.body.nodes[ids.byCity] && afterDone.body.nodes[ids.top] && !afterDone.body.nodes[ids.clean], afterDone.body.nodes);
  await ask({ op: "build", dataset: "clean_orders", scope: "only" });
  const onlyDone = await finished();
  check("orJustThis", onlyDone.body.nodes[ids.clean] && !onlyDone.body.nodes[ids.seed] && !onlyDone.body.nodes[ids.byCity], onlyDone.body.nodes);
  const partial = (await ask({ op: "graph" })).body;
  check("whatWasntBuiltKeepsItsResult", datasetOf(partial, ids.top)?.result?.status === "success", partial.datasets);

  // ---- Knowing what's out of date ----
  write("models/orders_by_city.sql", BY_CITY_SQL.replace("sum(amount) as total", "sum(amount) as total, max(amount) as biggest"));
  const edited = await graphWith((item) => datasetOf(item, ids.byCity)?.changed === true);
  check("itKnowsWhenARecipeHasChanged", datasetOf(edited.body, ids.byCity)?.changed === true && datasetOf(edited.body, ids.clean)?.changed === false, edited.body.datasets);
  await ask({ op: "build", dataset: "orders_by_city", scope: "only" });
  await finished();
  const rebuilt = await graphWith((item) => datasetOf(item, ids.byCity)?.changed === false);
  check("andWhenItsBeenBuiltAgain", datasetOf(rebuilt.body, ids.byCity)?.changed === false, rebuilt.body.datasets);
  const widened = await ask({ op: "preview", dataset: "orders_by_city" });
  check("withTheNewColumn", widened.body.columns.includes("biggest"), widened.body);
  write("models/orders_by_city.sql", BY_CITY_SQL);

  // ---- A recipe that fails, and what's made from it ----
  await sleep(1500);
  write("models/clean_orders.sql", `select no_such_column from {{ ref('raw_orders') }}\n`);
  await graphWith((item) => datasetOf(item, ids.clean)?.changed === true);
  await ask({ op: "build" });
  const broken = await finished();
  check("aBrokenRecipeFailsTheBuild", broken.body.state === "failed" && broken.body.counts?.failed === 1 && broken.body.counts?.skipped > 0, broken.body);
  const afterBroken = await graphWith((item) => datasetOf(item, ids.clean)?.result?.status === "error");
  check("itSaysWhy", /no_such_column/.test(datasetOf(afterBroken.body, ids.clean)?.result?.message ?? ""), datasetOf(afterBroken.body, ids.clean));
  check("andWhatsMadeFromItIsSkipped", datasetOf(afterBroken.body, ids.byCity)?.result?.status === "skipped" && datasetOf(afterBroken.body, ids.top)?.result?.status === "skipped", afterBroken.body.datasets);
  write("models/clean_orders.sql", CLEAN_SQL);

  write("models/top_city.py", `def model(dbt, session):\n    raise ValueError("this recipe is broken on purpose")\n    return dbt.ref("orders_by_city").df()\n`);
  await graphWith((item) => datasetOf(item, ids.top)?.changed === true, 30_000);
  const pythonBuild = await ask({ op: "build" });
  const brokenPython = await finished();
  const pythonFailed = (await ask({ op: "graph" })).body;
  check("aPythonRecipeThatRaisesSaysWhy", pythonBuild.status === 200 && brokenPython.body.state === "failed" && /broken on purpose/.test(datasetOf(pythonFailed, ids.top)?.result?.message ?? ""), { pythonBuild: pythonBuild.body.state ?? pythonBuild.body, nodes: brokenPython.body.nodes, log: brokenPython.body.log?.slice(-12), top: datasetOf(pythonFailed, ids.top)?.result });
  write("models/top_city.py", TOP_PY);

  // ---- A check that fails holds back what's made after it ----
  write("tests/too_few_orders.sql", `select * from {{ ref('clean_orders') }} where order_id = 1\n`);
  const withCheck = await graphWith((item) => item.checks.some((one) => one.name === "too_few_orders") && datasetOf(item, ids.top)?.changed === false, 30_000);
  const strict = withCheck.body.checks.find((item) => item.name === "too_few_orders");
  check("aNewCheckFileIsPickedUp", strict?.of === ids.clean && strict?.severity === "error", withCheck.body.checks);
  await ask({ op: "build" });
  const held = await finished();
  check("aFailingCheckFailsTheBuild", held.body.state === "failed" && held.body.nodes[strict.id] === "fail", held.body);
  check("andHoldsBackWhatsMadeAfter", held.body.nodes[ids.clean] === "success" && held.body.nodes[ids.byCity] === "skipped" && held.body.nodes[ids.top] === "skipped", held.body.nodes);
  const heldRows = await ask({ op: "failures", check: strict.id });
  check("andShowsTheRowsThatBrokeIt", heldRows.body.rows?.length === 1 && heldRows.body.rows[0][0] === "1", heldRows.body);
  remove("tests/too_few_orders.sql");

  // ---- A build from a terminal counts ----
  const gone = await graphWith((item) => !item.checks.some((one) => one.name === "too_few_orders"), 30_000);
  check("aRemovedCheckGoes", !gone.body.checks.some((one) => one.name === "too_few_orders"), gone.body.checks);
  const terminal = await shell(`cd "/workspace/${FOLDER}" && dbt build 2>&1 | tail -3; echo EXIT $?\n`);
  check("dbtWorksFromATerminal", /Completed|Done\./.test(terminal), terminal);
  const fromTerminal = await graphWith((item) => datasetOf(item, ids.top)?.result?.status === "success", 15_000);
  check("andTheToolSeesWhatItDid", datasetOf(fromTerminal.body, ids.top)?.result?.status === "success", fromTerminal.body.datasets);
  await shell(`cd "/workspace/${FOLDER}" && dbt compile > /dev/null 2>&1; echo DONE\n`);
  const compiled = (await ask({ op: "graph" })).body;
  check("butOnlyWhatBuilds", datasetOf(compiled, ids.top)?.result?.status === "success" && compiled.checks.every((item) => item.result?.status !== "success"), compiled.checks);

  // ---- Stopping ----
  write("models/slow.py", `import time\n\ndef model(dbt, session):\n    time.sleep(120)\n    return dbt.ref("clean_orders").df()\n`);
  await graphWith((item) => item.datasets.some((one) => one.name === "slow"), 30_000);
  await ask({ op: "build", dataset: "slow", scope: "only" });
  const slowing = await until(() => ask({ op: "status" }), (r) => r.body.nodes?.["model.flow_test.slow"] === "running", 30_000);
  check("aSlowRecipeShowsAsRunning", slowing.body.nodes?.["model.flow_test.slow"] === "running", slowing.body);
  const whileBuilding = await ask({ op: "preview", dataset: "clean_orders" });
  check("readingWhileItBuildsSaysToWait", whileBuilding.status === 422 && /using the data/.test(whileBuilding.body.error), whileBuilding.body);
  const graphWhileBuilding = await ask({ op: "graph" });
  check("theChartStillComesWhileItBuilds", graphWhileBuilding.status === 200 && graphWhileBuilding.body.datasets.length === 5 && graphWhileBuilding.body.live.state === "running", graphWhileBuilding.body);
  const stopAsked = Date.now();
  const stop = await ask({ op: "stop" });
  check("itCanBeStopped", stop.status === 200, stop.body);
  const stopped = await finished();
  console.log(`      stopping took ${Math.round((Date.now() - stopAsked) / 100) / 10} s`);
  check("andItStops", stopped.body.state === "stopped" && stopped.body.nodes["model.flow_test.slow"] !== "running" && Date.now() - stopAsked < 30_000, stopped.body);
  const noStop = await ask({ op: "stop" });
  check("stoppingNothingSaysSo", noStop.status === 422, noStop.body);
  remove("models/slow.py");
  await graphWith((item) => !item.datasets.some((one) => one.name === "slow"), 30_000);

  // ---- A build whose sandbox went away ----
  await shell(`python3 -c "import json, os, time; p = os.path.expanduser('~/flow/live.json'); d = json.load(open(p)); d.update(state='running', beat=time.time() - 60); json.dump(d, open(p, 'w')); os.mkdir(os.path.expanduser('~/flow/building'))"; echo SET\n`);
  const lost = await ask({ op: "status" });
  check("aBuildThatWentAwaySaysSo", lost.body.state === "failed" && /before it finished/.test(lost.body.message ?? ""), lost.body);
  const afterLost = await ask({ op: "build", dataset: "raw_orders", scope: "only" });
  check("andDoesntBlockTheNext", afterLost.status === 200, afterLost.body);
  await finished();

  // ---- A project dbt can't read ----
  write("models/clean_orders.sql", `select * from {{ ref('no_such_dataset') }}\n`);
  const unreadable = await graphWith((item) => item.problem !== null);
  check("aProjectDbtCantReadSaysWhy", /no_such_dataset/.test(unreadable.body.problem ?? ""), unreadable.body.problem);
  write("models/clean_orders.sql", CLEAN_SQL);
  write("models/schema.yml", `version: 2\nmodels:\n  - name: [not, valid\n`);
  const badYaml = await graphWith((item) => /yaml|parsing|schema\.yml/i.test(item.problem ?? ""));
  check("orBadYaml", /yaml|parsing|schema\.yml/i.test(badYaml.body.problem ?? ""), badYaml.body.problem);
  check("andStillShowsHowItLastWas", badYaml.body.datasets.length === 4, badYaml.body.datasets);
  await ask({ op: "build" });
  const buildBroken = await finished();
  check("buildingItSaysWhyItCant", buildBroken.body.state === "failed" && /yaml|parsing|schema\.yml/i.test(buildBroken.body.message ?? ""), buildBroken.body);
  write("models/schema.yml", SCHEMA);
  const fixed = await graphWith((item) => item.problem === null);
  check("fixingItClearsThat", fixed.body.problem === null, fixed.body.problem);

  // ---- AutoML in a recipe: real FLAML, on what the image has ----
  const people = Array.from({ length: 300 }, (_, i) => {
    const visits = (i * 7) % 31;
    const area = ["Pune", "Agra", "Delhi"][i % 3];
    return [i, visits, area, visits > 12 && area !== "Agra" ? "yes" : "no"];
  });
  write("seeds/people.csv", `id,visits,area,bought\n${people.map((row) => row.join(",")).join("\n")}\n`);
  write("models/will_buy.py", `def model(dbt, session):
    from flaml import AutoML
    from sklearn.model_selection import train_test_split
    frame = dbt.ref("people").df()
    x = frame[["visits", "area"]]
    train_x, test_x, train_y, test_y = train_test_split(x, frame["bought"], test_size=0.25, random_state=1)
    automl = AutoML()
    automl.fit(train_x, train_y, task="classification", time_budget=8, estimator_list=["lgbm", "xgboost", "rf", "extra_tree"], seed=1, n_jobs=1, verbose=0)
    print(f"Best model: {automl.best_estimator}. accuracy: {float((automl.predict(test_x) == test_y.to_numpy()).mean()):.3f}")
    frame["predicted"] = automl.predict(x)
    return frame
`);
  await graphWith((item) => item.datasets.some((one) => one.name === "will_buy"), 30_000);
  await ask({ op: "build", dataset: "will_buy", scope: "needs" });
  const learned = await until(() => ask({ op: "status" }), (r) => r.body.state !== "running", 120_000);
  check("flamlTrainsInARecipe", learned.body.nodes?.["model.flow_test.will_buy"] === "success", learned.body);
  check("whatItPrintsIsInTheLog", /Best model: \w+\. accuracy: [01]\.\d+/.test((learned.body.log ?? []).join("\n")), learned.body.log);
  const guesses = await ask({ op: "preview", dataset: "will_buy" });
  const index = (name) => guesses.body.columns.indexOf(name);
  const right = guesses.body.rows.filter((row) => row[index("bought")] === row[index("predicted")]).length;
  check("itLearnedTheRule", guesses.body.rows.length === 100 && right >= 90, { right, of: guesses.body.rows.length });
  remove("models/will_buy.py");
  remove("seeds/people.csv");
  await graphWith((item) => !item.datasets.some((one) => one.name === "will_buy"), 30_000);

  // ---- Earlier builds ----
  const history = await ask({ op: "runs" });
  check("earlierBuildsAreListedNewestFirst", history.body.runs.length >= 10 && history.body.runs.every((item, index, all) => !index || all[index - 1].id >= item.id), history.body.runs?.map((item) => item.id));
  check("sayingHowEachWent", history.body.runs.some((item) => item.state === "stopped") && history.body.runs.some((item) => item.state === "failed") && history.body.runs.some((item) => item.state === "warned"), history.body.runs?.map((item) => item.state));
  const oneRun = await ask({ op: "run", id: history.body.runs.find((item) => item.state === "warned").id });
  check("oneOpensWithWhatDbtSaid", oneRun.status === 200 && oneRun.body.log.length > 0, oneRun.body);

  // ---- What a request can't do ----
  const missing = await ask({ op: "preview", dataset: "no_such_dataset" });
  check("anUnknownDatasetIsRefused", missing.status === 422 && /no dataset called/.test(missing.body.error), missing.body);
  const injected = await ask({ op: "preview", dataset: `x"; drop table clean_orders; --` });
  check("aNameThatIsntOneNeverGetsThere", injected.status === 400, injected.body);
  const flag = await ask({ op: "build", dataset: "--help" });
  check("norDoesOneThatLooksLikeAFlag", flag.status === 400, flag.body);
  const selector = await ask({ op: "build", dataset: "path:models" });
  check("orASelector", selector.status === 400, selector.body);
  const escaped = await ask({ op: "run", id: "../live" });
  check("aRunCantBeSomeOtherFile", escaped.status === 400, escaped.body);
  const notACheck = await ask({ op: "failures", check: "model.flow_test.clean_orders" });
  check("aCheckHasToBeACheck", notACheck.status === 400, notACheck.body);
  const unknown = await ask({ op: "drop" });
  check("anUnknownRequestIsRefused", unknown.status === 400, unknown.body);
  const forged = await fetch(`${RUNNER}/rooms/${ROOM}/flow`, { method: "POST", headers: { authorization: token("TEAM22"), "content-type": "application/json" }, body: JSON.stringify({ op: "graph" }) });
  check("anotherRoomsTokenIsRefused", forged.status === 401);
  const intact = await ask({ op: "preview", dataset: "raw_orders" });
  check("andTheDataIsAllStillThere", intact.body.rows?.length === ORDERS.length, intact.body);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(1000);
  await shell(`rm -rf "$HOME/flow"; echo CLEAN\n`).catch(() => {});
  await sleep(1000);
  check("theTestsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER) || item.path.startsWith(`flow-${stamp}`)));
  await sleep(500);
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
