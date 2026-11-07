// Explain this data's numbers for real, in E2ETST: DuckDB in the sandbox works out a table's types and spread, and they're right, down
// to values worked out here to compare with. Awkward names and values don't break it, and bad input says so.
//   node --env-file=../../.env test/data-summary.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 500)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const summarize = async (columns, rows) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/data-summary`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ columns, rows }), signal: AbortSignal.timeout(100_000) });
  return { status: response.status, body: await response.json() };
};

try {
  // Ages 1 to 100, with one far outlier, salary exactly following age, a city with common values, some empties and duplicates.
  const rows = [];
  for (let age = 1; age <= 100; age += 1) rows.push([String(age), String(age * 1000), age % 4 === 0 ? "Pune" : age % 4 === 1 ? "Delhi" : "Agra", age % 10 === 0 ? null : "yes"]);
  rows.push(["5000", "5000000", "Pune", "yes"]);
  rows.push(["1", "1000", "Delhi", "yes"]);
  const started = Date.now();
  const { status, body } = await summarize(["age", "salary", "city", "active"], rows);
  console.log(`      took ${Date.now() - started} ms: ${body.engine}`);
  check("itAnswers", status === 200 && Array.isArray(body.columns), JSON.stringify(body).slice(0, 300));
  const column = (name) => body.columns?.find((item) => item.name === name);
  const age = column("age");
  check("itSaysWhoWorkedItOut", /^DuckDB \d/.test(body.engine), body.engine);
  check("itCountsTheRows", body.rows === 102, body.rows);
  check("itFindsDuplicates", body.duplicates === 1, body.duplicates);
  check("itWorksOutTypesFromText", /INT/.test(age?.type) && column("city")?.type === "VARCHAR", JSON.stringify([age?.type, column("city")?.type]));
  check("theMinAndMaxAreRight", age?.min === "1" && age?.max === "5000", JSON.stringify(age));
  const mean = rows.reduce((sum, row) => sum + Number(row[0]), 0) / rows.length;
  check("theMeanIsRight", Math.abs(Number(age?.mean) - mean) < 0.001, `${age?.mean} against ${mean}`);
  check("itFindsTheOutlier", age?.outliers === 1, age?.outliers);
  check("emptyValuesAreCounted", Math.abs(column("active")?.nullPercent - (10 / 102) * 100) < 0.1, column("active")?.nullPercent);
  const city = column("city");
  check("textGetsItsCommonValues", city?.top[0]?.value === "Agra" && city.top[0].count === 50, JSON.stringify(city?.top));
  check("andNoMean", city?.mean === null);
  const strong = body.correlations?.find((item) => item.a === "age" && item.b === "salary");
  check("itFindsWhatMovesTogether", strong?.r > 0.99, JSON.stringify(body.correlations));

  // Awkward tables.
  const awkward = await summarize(["a", "a", "with space", 'quo"te', "", "semi;colon"], [["1", "2", "x,y", 'say "hi"', "line\none", "a;b"], ["3", "4", "z", "", null, "c"]]);
  check("awkwardNamesAndValuesWork", awkward.status === 200 && awkward.body.columns?.length === 6, JSON.stringify(awkward.body).slice(0, 400));
  check("twoColumnsCalledTheSameBothCount", awkward.body.columns?.[1]?.name === "a (2)" && awkward.body.columns[1].max === "4", JSON.stringify(awkward.body.columns?.[1]));
  check("aColumnWithNoNameGetsOne", awkward.body.columns?.[4]?.name === "column 5");
  const dates = await summarize(["when", "ok"], [["2026-01-02", "true"], ["2026-03-04", "false"]]);
  check("datesAndTrueFalseAreRecognised", dates.body.columns?.[0]?.type === "DATE" && dates.body.columns[1].type === "BOOLEAN" && dates.body.columns[0].max === "2026-03-04", JSON.stringify(dates.body.columns?.map((item) => item.type)));
  const allEmpty = await summarize(["a"], [[null], [null]]);
  check("aColumnThatsAllEmptyIsSaid", allEmpty.status === 200 && allEmpty.body.columns?.[0]?.nullPercent === 100, JSON.stringify(allEmpty.body).slice(0, 300));
  const injected = await summarize(['x"; DROP TABLE t; --'], [["1"]]);
  check("aColumnNameCantBecomeSql", injected.status === 200 && injected.body.columns?.[0]?.name === 'x"; DROP TABLE t; --', JSON.stringify(injected.body).slice(0, 300));

  // Refused.
  check("noRowsIsRefused", (await summarize(["a"], [])).status === 400);
  check("anythingButTextIsRefused", (await summarize(["a"], [[5]])).status === 400);
  const forged = await fetch(`${RUNNER}/rooms/${ROOM}/data-summary`, { method: "POST", headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: "TEAM22", uid: "x", name: "X" })}`, "content-type": "application/json" }, body: JSON.stringify({ columns: ["a"], rows: [["1"]] }) });
  check("anotherRoomsTokenIsRefused", forged.status === 401, forged.status);
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
