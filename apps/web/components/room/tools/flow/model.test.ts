import assert from "node:assert/strict";
import { test } from "node:test";

import type { FlowCheck, FlowDataset } from "@codechatter/contracts";

import { canRemoveCheck, chartOf, checkLabel, datasetIdOf, isRecipeId, newCheck, newRecipe, outOfDate, recipeIdOf, recipesFolder, sqlRef, statusOf, taskFor, type RecipeForm } from "./model";

const dataset = (id: string, over: Partial<FlowDataset> = {}): FlowDataset => ({ id: `model.p.${id}`, kind: "model", name: id, language: "sql", file: `models/${id}.sql`, description: "", materialized: "table", dependsOn: [], result: null, changed: false, ...over });
const check = (over: Partial<FlowCheck> = {}): FlowCheck => ({ id: "test.p.c", name: "c", rule: null, column: null, values: null, severity: "error", of: null, file: "tests/c.sql", result: null, ...over });
const result = (status: string) => ({ status, at: 1, ms: 1, failures: null, message: null });

const seed = dataset("raw", { id: "seed.p.raw", kind: "seed", language: null, file: "seeds/raw.csv", materialized: "seed" });
const clean = dataset("clean", { dependsOn: ["seed.p.raw"] });
const totals = dataset("totals", { dependsOn: ["model.p.clean"], language: "python" });

test("each model is a recipe and a dataset, and seeds have no recipe", () => {
  const { items, edges } = chartOf({ datasets: [seed, clean, totals], checks: [] }, null);
  assert.deepEqual(items.map((item) => item.id).sort(), ["model.p.clean", "model.p.totals", "recipe:model.p.clean", "recipe:model.p.totals", "seed.p.raw"]);
  assert.deepEqual(items.find((item) => item.id === "recipe:model.p.totals")?.label, "Py");
  assert.equal(items.find((item) => item.id === "recipe:model.p.clean")?.shape, "circle");
  assert.equal(items.find((item) => item.id === "seed.p.raw")?.glyph, "seed");
  assert.deepEqual(edges, [
    { from: "recipe:model.p.clean", to: "model.p.clean" },
    { from: "seed.p.raw", to: "recipe:model.p.clean" },
    { from: "recipe:model.p.totals", to: "model.p.totals" },
    { from: "model.p.clean", to: "recipe:model.p.totals" },
  ]);
});

test("a recipe's id leads back to its dataset", () => {
  assert.equal(datasetIdOf(recipeIdOf("model.p.a")), "model.p.a");
  assert.equal(datasetIdOf("model.p.a"), "model.p.a");
  assert.equal(isRecipeId(recipeIdOf("model.p.a")), true);
  assert.equal(isRecipeId("model.p.a"), false);
});

test("dbt's words become a status", () => {
  assert.equal(statusOf("success"), "ok");
  assert.equal(statusOf("pass"), "ok");
  assert.equal(statusOf("warn"), "warning");
  assert.equal(statusOf("fail"), "failed");
  assert.equal(statusOf("error"), "failed");
  assert.equal(statusOf("skipped"), "skipped");
  assert.equal(statusOf("stopped"), "skipped");
  assert.equal(statusOf(null), "idle");
  assert.equal(statusOf("something new"), "idle");
});

test("a dataset that built fine still shows a failed check on the chart, and says so", () => {
  const built = dataset("clean", { result: result("success") });
  const { items } = chartOf({ datasets: [built], checks: [check({ of: built.id, result: result("fail") }), check({ id: "test.p.d", of: built.id, result: result("pass") })] }, null);
  const box = items.find((item) => item.id === built.id)!;
  const circle = items.find((item) => item.id === recipeIdOf(built.id))!;
  assert.equal(box.status, "failed");
  assert.equal(box.detail, "Checks 1/2");
  assert.equal(circle.status, "ok", "the recipe itself ran fine");
  assert.match(box.description, /failed/);
  assert.match(box.description, /1 of 2 checks passed/);
});

test("what's being built shows over what happened last time, only while it's building", () => {
  const built = dataset("clean", { result: result("success") });
  const nodes = { [built.id]: "running" };
  assert.equal(chartOf({ datasets: [built], checks: [] }, { state: "running", nodes }).items[0]!.status, "running");
  assert.equal(chartOf({ datasets: [built], checks: [] }, { state: "succeeded", nodes }).items[0]!.status, "ok");
});

test("what's made from something changed is out of date too, unless it was never built", () => {
  const changed = dataset("a", { changed: true, result: result("success") });
  const after = dataset("b", { dependsOn: [changed.id], result: result("success") });
  const further = dataset("c", { dependsOn: [after.id], result: result("success") });
  const neverBuilt = dataset("d", { dependsOn: [changed.id] });
  const unrelated = dataset("e", { result: result("success") });
  assert.deepEqual([...outOfDate([changed, after, further, neverBuilt, unrelated])].sort(), [changed.id, after.id, further.id].sort());
  assert.equal(chartOf({ datasets: [changed], checks: [] }, null).items.find((item) => item.id === changed.id)?.detail, "Out of date");
});

test("a loop in the graph can't hang it", () => {
  const a = dataset("a", { dependsOn: ["model.p.b"], result: result("success") });
  const b = dataset("b", { dependsOn: ["model.p.a"], result: result("success") });
  assert.equal(outOfDate([a, b]).size, 0);
});

test("checks are said in plain words", () => {
  assert.equal(checkLabel(check({ rule: "not_null", column: "id" })), "id is never empty");
  assert.equal(checkLabel(check({ rule: "unique", column: "id" })), "id has no duplicates");
  assert.equal(checkLabel(check({ rule: "accepted_values", column: "city", values: ["Pune", "Agra"] })), "city is one of Pune, Agra");
  assert.equal(checkLabel(check({ rule: "relationships", column: "city" })), "city matches another dataset");
  assert.equal(checkLabel(check({ name: "orders__amount__not_null" })), "amount is never empty");
  assert.equal(checkLabel(check({ name: "orders__amount__range" })), "amount stays in its range");
  assert.equal(checkLabel(check({ name: "orders__has_rows" })), "It has rows");
  assert.equal(checkLabel(check({ name: "amounts_are_positive" })), "amounts are positive");
});

test("only a check that's a file of its own can be removed from here", () => {
  assert.equal(canRemoveCheck({ file: "tests/a.sql" }), true);
  assert.equal(canRemoveCheck({ file: "models/schema.yml" }), false);
  assert.equal(canRemoveCheck({ file: null }), false);
});

const base = { name: "out", from: clean, columns: ["id", "city", "amount"], types: ["INTEGER", "VARCHAR", "DOUBLE"] };
const sql = (form: RecipeForm) => {
  const made = newRecipe(form, []);
  assert.ok("content" in made, JSON.stringify(made));
  return made.content;
};

test("a filter compares numbers as numbers, and text as text with its quotes doubled", () => {
  assert.match(sql({ ...base, kind: "filter", column: "amount", test: "above", value: "100" }), /where "amount" > 100\n/);
  assert.match(sql({ ...base, kind: "filter", column: "city", test: "equals", value: "O'Neil" }), /where "city" = 'O''Neil'\n/);
  assert.match(sql({ ...base, kind: "filter", column: "amount", test: "equals", value: "not a number" }), /where "amount" = 'not a number'\n/, "not a number, so it's text");
  assert.match(sql({ ...base, kind: "filter", column: "city", test: "empty", value: "" }), /where "city" is null\n/);
  assert.match(sql({ ...base, kind: "filter", column: "city", test: "contains", value: "un" }), /where contains\("city"::varchar, 'un'\)\n/);
  assert.match(sql({ ...base, kind: "filter", column: "city", test: "differs", value: "Pune" }), /is distinct from 'Pune'/, "a row with nothing in it is different too");
  assert.match(sql({ ...base, kind: "filter", column: "city", test: "equals", value: "x" }), /from \{\{ ref\('clean'\) \}\}/);
});

test("a filter asks for what it needs", () => {
  assert.ok("error" in newRecipe({ ...base, kind: "filter", column: "", test: "equals", value: "x" }, []));
  assert.ok("error" in newRecipe({ ...base, kind: "filter", column: "city", test: "equals", value: "  " }, []));
  assert.ok("content" in newRecipe({ ...base, kind: "filter", column: "city", test: "filled", value: "" }, []));
});

test("nothing in a value runs as a template", () => {
  assert.ok("error" in newRecipe({ ...base, kind: "filter", column: "city", test: "equals", value: "{{ run_query('x') }}" }, []));
  assert.ok("error" in newRecipe({ ...base, kind: "filter", column: "city", test: "equals", value: "{% do x %}" }, []));
  assert.ok("error" in newCheck({ dataset: clean, rule: "accepted", column: "city", values: "{# x #}", min: "", max: "" }));
});

test("a column's name can't break out of its quotes", () => {
  assert.match(sql({ ...base, columns: ['a"b'], types: ["VARCHAR"], kind: "filter", column: 'a"b', test: "filled", value: "" }), /where "a""b" is not null/);
});

test("a group counts rows, and works out what was asked", () => {
  const made = sql({ ...base, kind: "group", by: ["city"], measure: { how: "sum", column: "amount" } });
  assert.match(made, /"city",\n {2}count\(\*\) as "rows",\n {2}sum\("amount"\) as "sum_amount"/);
  assert.match(made, /group by "city"\n/);
  assert.match(sql({ ...base, kind: "group", by: ["city"], measure: { how: "count_distinct", column: "id" } }), /count\(distinct "id"\) as "distinct_id"/);
  assert.doesNotMatch(sql({ ...base, kind: "group", by: [], measure: { how: "max", column: "amount" } }), /group by/);
  assert.ok("error" in newRecipe({ ...base, kind: "group", by: [], measure: null }, []));
});

test("a join doesn't repeat the column it matched on", () => {
  const other = dataset("cities", { id: "seed.p.cities", kind: "seed" });
  const made = sql({ ...base, kind: "join", other, leftKey: "city", rightKey: "name", how: "left" });
  assert.match(made, /r\.\* exclude \("name"\)/);
  assert.match(made, /from \{\{ ref\('clean'\) \}\} as l\nleft join \{\{ ref\('cities'\) \}\} as r\n {2}on l\."city" = r\."name"/);
  assert.match(sql({ ...base, kind: "join", other, leftKey: "city", rightKey: "name", how: "inner" }), /inner join/);
  assert.ok("error" in newRecipe({ ...base, kind: "join", other: null, leftKey: "a", rightKey: "b", how: "left" }, []));
  assert.ok("error" in newRecipe({ ...base, kind: "join", other, leftKey: "", rightKey: "b", how: "left" }, []));
});

test("sources are read as sources", () => {
  const source = dataset("shop.orders", { id: "source.p.shop.orders", kind: "source" });
  assert.equal(sqlRef(source), "{{ source('shop', 'orders') }}");
  assert.match(sql({ ...base, from: source, kind: "python" }), /dbt\.source\("shop", "orders"\)\.df\(\)/);
});

test("blank recipes start from the columns, or from nothing", () => {
  assert.equal(sql({ ...base, kind: "sql" }), `select\n  "id",\n  "city",\n  "amount"\nfrom {{ ref('clean') }}\n`);
  assert.equal(sql({ ...base, columns: [], kind: "sql" }), `select\n  *\nfrom {{ ref('clean') }}\n`);
  assert.equal(sql({ name: "out", from: null, columns: [], kind: "sql" }), "select 1 as a\n");
  const python = newRecipe({ ...base, kind: "python" }, []);
  assert.ok("fileName" in python && python.fileName === "out.py");
  assert.match(python.content, /^def model\(dbt, session\):\n/);
  assert.match(python.content, /dbt\.ref\("clean"\)\.df\(\)/);
});

const automl = { ...base, kind: "automl" as const, target: "city", features: ["id", "amount"], task: "classification" as const, seconds: 30 };

test("an AutoML recipe is a Python recipe that dbt can read", () => {
  const made = newRecipe(automl, []);
  assert.ok("fileName" in made);
  assert.equal(made.fileName, "out.py");
  assert.match(made.content, /^def model\(dbt, session\):\n/);
  assert.equal(made.content.match(/^ {4}return /gm)?.length, 1, "dbt wants exactly one return");
  assert.match(made.content, /dbt\.ref\("clean"\)\.df\(\)/);
  assert.match(made.content, /target = "city"\n/);
  assert.match(made.content, /features = \["id","amount"\]\n/);
  assert.match(made.content, /seconds = 30\n/);
  assert.match(made.content, /task="classification"/);
  assert.match(made.content, /accuracy on the rows held back/);
  assert.match(made.content, /test_size=0\.25/);
});

test("predicting a number is scored as a number", () => {
  const made = newRecipe({ ...automl, target: "amount", features: ["id"], task: "regression" }, []);
  assert.ok("content" in made);
  assert.match(made.content, /task="regression"/);
  assert.match(made.content, /mean_error on the rows held back/);
  assert.match(made.content, /abs\(predicted - test_y\.to_numpy\(\)\)\.mean\(\)/);
});

test("AutoML never learns the answer from the answer", () => {
  const made = newRecipe({ ...automl, features: ["id", "city"] }, []);
  assert.ok("content" in made);
  assert.match(made.content, /features = \["id"\]\n/);
  assert.ok("error" in newRecipe({ ...automl, features: ["city"] }, []), "nothing left to learn from");
});

test("AutoML asks for what it needs", () => {
  assert.ok("error" in newRecipe({ ...automl, target: "" }, []));
  assert.ok("error" in newRecipe({ ...automl, features: [] }, []));
  assert.ok("error" in newRecipe({ ...automl, from: null }, []));
  for (const seconds of [0, 1, 601, 1.5, Number.NaN]) assert.ok("error" in newRecipe({ ...automl, seconds }, []), String(seconds));
});

test("a column's name can't break out of the recipe's strings", () => {
  const made = newRecipe({ ...automl, target: 'a"b', columns: ['a"b', "c"], features: ["c"] }, []);
  assert.ok("content" in made);
  assert.match(made.content, /target = "a\\"b"\n/);
});

test("what's being predicted is guessed from its type", () => {
  assert.equal(taskFor("DOUBLE"), "regression");
  assert.equal(taskFor("INTEGER"), "regression");
  assert.equal(taskFor("DECIMAL(18,3)"), "regression");
  assert.equal(taskFor("VARCHAR"), "classification");
  assert.equal(taskFor("BOOLEAN"), "classification");
  assert.equal(taskFor(undefined), "classification");
});

test("a recipe's name is one dbt can use, and isn't taken", () => {
  for (const name of ["", "Has Caps", "1st", "a-b", "a/b", "../up", "a".repeat(61)]) assert.ok("error" in newRecipe({ ...base, name, kind: "sql" }, []), name);
  assert.ok("error" in newRecipe({ ...base, kind: "sql" }, ["out"]));
  assert.ok("content" in newRecipe({ ...base, kind: "sql" }, ["other"]));
});

const form = { dataset: clean, column: "amount", values: "", min: "", max: "" };

test("a check is a file that finds the rows breaking it", () => {
  const notNull = newCheck({ ...form, rule: "not_null" });
  assert.ok("content" in notNull);
  assert.equal(notNull.fileName, "clean__amount__not_null.sql");
  assert.match(notNull.content, /where "amount" is null\n/);
  const unique = newCheck({ ...form, rule: "unique" });
  assert.ok("content" in unique);
  assert.match(unique.content, /group by "amount"\nhaving count\(\*\) > 1/);
  const has = newCheck({ ...form, rule: "has_rows", column: "" });
  assert.ok("content" in has);
  assert.equal(has.name, "clean__has_rows");
  assert.match(has.content, /where not exists \(select 1 from \{\{ ref\('clean'\) \}\}\)/);
});

test("a check's values and limits are written properly", () => {
  const accepted = newCheck({ ...form, rule: "accepted", column: "city", values: "Pune, O'Neil ,, Agra" });
  assert.ok("content" in accepted);
  assert.match(accepted.content, /"city" not in \('Pune', 'O''Neil', 'Agra'\)/);
  assert.ok("error" in newCheck({ ...form, rule: "accepted", values: " , " }));
  const both = newCheck({ ...form, rule: "range", min: "0", max: "10.5" });
  assert.ok("content" in both);
  assert.match(both.content, /where "amount" < 0 or "amount" > 10\.5\n/);
  const onlyMax = newCheck({ ...form, rule: "range", max: "2026-01-01" });
  assert.ok("content" in onlyMax);
  assert.match(onlyMax.content, /where "amount" > '2026-01-01'\n/);
  assert.ok("error" in newCheck({ ...form, rule: "range" }));
  assert.ok("error" in newCheck({ ...form, rule: "not_null", column: "" }));
});

test("a check's file name is safe whatever the column is called", () => {
  const made = newCheck({ ...form, rule: "not_null", column: "Amount (₹) ../x" });
  assert.ok("name" in made);
  assert.match(made.name, /^clean__[a-z0-9_]+__not_null$/);
});

test("new recipes go where the project keeps them", () => {
  assert.equal(recipesFolder({ path: "flow" }, []), "flow/models");
  assert.equal(recipesFolder({ path: "." }, []), "models");
  assert.equal(recipesFolder({ path: "flow" }, [{ kind: "model", file: "flow/transform/a/x.sql" }]), "flow/transform");
  assert.equal(recipesFolder({ path: "." }, [{ kind: "seed", file: "seeds/a.csv" }, { kind: "model", file: "marts/x.sql" }]), "marts");
});
