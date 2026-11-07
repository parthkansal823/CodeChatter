// The lakehouse for real, in E2ETST on the full image: a script makes Delta tables with Spark and logs runs with MLflow, inside the jail
// with no network, and the Lakehouse tool's reads see them: rows, every version, and runs. A table's name can't reach outside the
// warehouse. The test's tables, runs and files are removed. Needs SANDBOX_IMAGE to be the full image, and pnpm sandbox:build:full.
//   node --env-file=../../.env test/lakehouse.e2e.mjs        (from apps/runner, with the dev stack running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 600)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const ask = async (body) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/lakehouse`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
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
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ path, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }), signal: AbortSignal.timeout(400_000) });
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
const table = `test_orders_${stamp}`;
const experiment = `test experiment ${stamp}`;
const script = `lh-${stamp}.py`;
const cleanup = `lh-${stamp}-clean.sh`;
const SCRIPT = `
import os, time
started = time.time()
from lakehouse import session, heap_mb, memory_limit_mb, WAREHOUSE
# As a write leaves things when it's killed before its first commit: this mustn't stop Spark for the whole room.
os.makedirs(os.path.join(WAREHOUSE, "${table}_broken", "_delta_log"), exist_ok=True)
print("LIMIT", memory_limit_mb(), "HEAP", heap_mb(memory_limit_mb()))
spark = session()
print("SPARK", spark.version, "started in", round(time.time() - started), "s")
rows = [(i, "city%d" % (i % 3), float(i)) for i in range(1, 11)]
print("STARTED WITH A BROKEN TABLE")
spark.createDataFrame(rows, ["id", "city", "amount"]).write.format("delta").mode("overwrite").saveAsTable("${table}")
spark.sql("UPDATE ${table} SET amount = 0 WHERE id = 1")
spark.sql("DELETE FROM ${table} WHERE id = 2")
print("ROWS", spark.table("${table}").count())
print("WAS", spark.read.option("versionAsOf", 0).table("${table}").filter("id = 1").first()["amount"])
import mlflow
mlflow.set_experiment("${experiment}")
for alpha in [0.1, 0.5]:
    with mlflow.start_run(run_name=f"alpha {alpha}"):
        mlflow.log_param("alpha", alpha)
        mlflow.log_metric("rmse", alpha * 2)
print("TRACKING", mlflow.get_tracking_uri())
spark.stop()

# A second session finds the table again: it keeps its list in memory, so this is what restarting a kernel is like.
from pyspark.sql import SparkSession
again = session()
print("AGAIN", again.table("${table}").count())
again.stop()
print("TOOK", round(time.time() - started), "s")
`;

try {
  createFileAtPath(doc, script, SCRIPT, null);
  createFileAtPath(doc, cleanup, `rm -rf "$HOME/lakehouse/warehouse/${table}" "$HOME/lakehouse/warehouse/${table}_broken"; for f in "$HOME"/lakehouse/mlruns/*/meta.yaml; do grep -q "${experiment}" "$f" 2>/dev/null && rm -rf "$(dirname "$f")"; done; ls /workspace/spark-warehouse 2>/dev/null | wc -l | sed 's/^/STRAY /'; echo CLEANED\n`, null);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const output = await run(script);
  console.log(output.split("\n").filter((line) => /^(LIMIT|SPARK|ROWS|WAS|TRACKING|AGAIN|TOOK)/.test(line)).map((line) => `      ${line}`).join("\n"));
  check("sparkStartsInTheJailWithNoNetwork", /^SPARK 4\./m.test(output), output.slice(-700));
  check("aHalfWrittenTableDoesntStopIt", /^STARTED WITH A BROKEN TABLE$/m.test(output), output.slice(-500));
  check("deltaTablesCanBeChanged", /^ROWS 9$/m.test(output), output.slice(-500));
  check("anOldVersionCanBeRead", /^WAS 1\.0$/m.test(output), output.slice(-500));
  check("mlflowGoesToTheLakehouseNotTheFiles", /^TRACKING file:\/\/\/home\/ccuser\/lakehouse\/mlruns$/m.test(output), output.slice(-300));
  check("aNewSessionFindsTheTableAgain", /^AGAIN 9$/m.test(output), output.slice(-300));

  // A room short of memory is told so: starting anyway ends with the sandbox killing Spark, which looks like a stuck notebook.
  const memory = `lh-${stamp}-memory.py`;
  createFileAtPath(doc, memory, `
from lakehouse import heap_mb, too_little_memory
print("TOOSMALL", too_little_memory(512, 0))
print("HELDUP", too_little_memory(2048, 1800))
print("FINE", too_little_memory(2048, 300), too_little_memory(None, 5000))
print("HEAP", heap_mb(2048, 0), heap_mb(2048, 900), heap_mb(768, 50), heap_mb(None, 0), heap_mb(100000, 0))
`, null);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const words = await run(memory);
  check("aSmallRoomIsToldWhatToChange", /^TOOSMALL .*SANDBOX_MEMORY_MB/m.test(words), words);
  check("aRoomThatsFullIsToldWhatToStop", /^HELDUP .*248 MB free.*shut down that notebook's kernel/m.test(words), words);
  check("aRoomWithRoomIsFine", /^FINE None None$/m.test(words), words);
  check("theHeapFitsWhatsFree", /^HEAP 1365 765 512 2048 8192$/m.test(words), words);
  trash(doc, findByPath(doc, memory).id);

  // What the tool reads, without starting Spark.
  const started = Date.now();
  const overview = await ask({ op: "overview" });
  console.log(`      overview took ${Date.now() - started} ms`);
  const found = overview.body.tables?.find((item) => item.name === table);
  check("itListsTheTable", overview.status === 200 && Boolean(found), JSON.stringify(overview.body).slice(0, 400));
  const broken = overview.body.tables?.find((item) => item.name === `${table}_broken`);
  check("itSaysWhatsWrongWithAHalfWrittenOne", /never finished/.test(broken?.problem ?? "") && broken.versions === 0, JSON.stringify(broken));
  check("withItsRowsAndColumns", found?.rows === 9 && found.columns.map((column) => column.name).join() === "id,city,amount", JSON.stringify(found));
  check("andHowManyVersions", found?.versions === 3 && found.version === 2, JSON.stringify(found));
  const history = await ask({ op: "history", table });
  check("itsHistorySaysWhatHappened", history.body.commits?.map((commit) => commit.operation).join() === "DELETE,UPDATE,CREATE OR REPLACE TABLE AS SELECT" || history.body.commits?.[0]?.operation === "DELETE", JSON.stringify(history.body.commits?.map((commit) => commit.operation)));
  check("newestFirst", history.body.commits?.[0]?.version === 2 && history.body.commits.at(-1).version === 0, JSON.stringify(history.body).slice(0, 300));
  const latest = await ask({ op: "preview", table, version: null });
  const row = (preview, id) => preview.rows?.find((item) => item[0] === String(id));
  check("theLatestRowsAreThere", latest.body.rows?.length === 9 && row(latest.body, 1)?.[2] === "0.0" && !row(latest.body, 2), JSON.stringify(latest.body).slice(0, 300));
  const first = await ask({ op: "preview", table, version: 0 });
  check("anOldVersionOpens", first.body.rows?.length === 10 && row(first.body, 1)?.[2] === "1.0" && Boolean(row(first.body, 2)), JSON.stringify(first.body).slice(0, 300));
  const middle = await ask({ op: "preview", table, version: 1 });
  check("soDoesTheOneBetween", middle.body.rows?.length === 10 && row(middle.body, 1)?.[2] === "0.0", JSON.stringify(middle.body).slice(0, 300));
  const never = await ask({ op: "preview", table, version: 99 });
  check("aVersionThatNeverWasSaysSo", never.status === 422 && /version/.test(never.body.error), JSON.stringify(never));

  const runs = await ask({ op: "runs" });
  const mine = runs.body.runs?.filter((item) => item.experiment === experiment);
  check("runsAreListed", mine?.length === 2, JSON.stringify(runs.body).slice(0, 400));
  const alpha = mine?.find((item) => item.name === "alpha 0.5");
  check("withWhatEachTriedAndGot", alpha?.params.alpha === "0.5" && alpha.metrics.rmse === 1 && alpha.status === "FINISHED", JSON.stringify(alpha));

  // A table's name can't go anywhere else.
  for (const bad of ["../mlruns", "..", "a/b", "/etc", ".ssh"]) check(`theName ${bad} isRefused`, (await ask({ op: "preview", table: bad })).status === 400);
  const missing = await ask({ op: "history", table: "no_such_table" });
  check("aTableThatIsntThereSaysSo", missing.status === 422 && /no table called/.test(missing.body.error), JSON.stringify(missing));
  check("anythingElseIsRefused", (await ask({ op: "delete", table })).status === 400);
  const forged = await fetch(`${RUNNER}/rooms/${ROOM}/lakehouse`, { method: "POST", headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: "TEAM22", uid: "x", name: "X" })}`, "content-type": "application/json" }, body: JSON.stringify({ op: "overview" }) });
  check("anotherRoomsTokenIsRefused", forged.status === 401, forged.status);

  const cleaned = await run(cleanup);
  check("nothingLandsInTheRoomsFiles", /STRAY 0/.test(cleaned), cleaned);
  check("itsTablesAreRemoved", /CLEANED/.test(cleaned) && !(await ask({ op: "overview" })).body.tables?.some((item) => item.name === table));
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  for (const path of [script, cleanup]) {
    const node = findByPath(doc, path);
    if (node) trash(doc, node.id);
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
