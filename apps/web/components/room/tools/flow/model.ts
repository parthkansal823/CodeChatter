/** What the Flow tool works out without a server: the chart from dbt's graph, what's out of date, what to call a check, and the files new recipes and checks are. */
import type { FlowCheck, FlowDataset, FlowGraph, FlowLive } from "@codechatter/contracts";

export type ChartStatus = "idle" | "running" | "ok" | "warning" | "failed" | "skipped";
/** Which picture a thing on the chart gets. */
export type Glyph = "seed" | "source" | "table";
export type ChartItem = { id: string; label: string; detail?: string; shape: "box" | "circle"; glyph?: Glyph; status: ChartStatus; description: string };

const RECIPE = "recipe:";
export const recipeIdOf = (datasetId: string) => `${RECIPE}${datasetId}`;
export const datasetIdOf = (chartId: string) => (chartId.startsWith(RECIPE) ? chartId.slice(RECIPE.length) : chartId);
export const isRecipeId = (chartId: string) => chartId.startsWith(RECIPE);
export const hasRecipe = (dataset: Pick<FlowDataset, "kind">) => dataset.kind === "model" || dataset.kind === "snapshot";

export function statusOf(value: string | null | undefined): ChartStatus {
  switch (value) {
    case "running":
      return "running";
    case "success":
    case "pass":
    case "partial success":
    case "no-op":
      return "ok";
    case "warn":
      return "warning";
    case "error":
    case "fail":
      return "failed";
    case "skipped":
    case "stopped":
      return "skipped";
    default:
      return "idle";
  }
}

const SEVERITY: ChartStatus[] = ["failed", "running", "warning", "skipped", "ok", "idle"];
const worstOf = (statuses: readonly ChartStatus[]): ChartStatus => SEVERITY.find((status) => statuses.includes(status)) ?? "idle";

const STATUS_WORDS: Record<ChartStatus, string> = { idle: "not built yet", running: "running now", ok: "ran fine", warning: "has a warning", failed: "failed", skipped: "skipped" };

/** Built things whose file has changed since, or that are made from something that has. Something never built isn't out of date, just not built. */
export function outOfDate(datasets: readonly FlowDataset[]): Set<string> {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const known = new Map<string, boolean>();
  const stale = (id: string): boolean => {
    const remembered = known.get(id);
    if (remembered !== undefined) return remembered;
    known.set(id, false);
    const dataset = byId.get(id);
    const answer = Boolean(dataset && (dataset.changed || dataset.dependsOn.some(stale)));
    known.set(id, answer);
    return answer;
  };
  return new Set(datasets.filter((dataset) => dataset.result && stale(dataset.id)).map((dataset) => dataset.id));
}

export function checksOf(checks: readonly FlowCheck[], datasetId: string): FlowCheck[] {
  return checks.filter((check) => check.of === datasetId);
}

export function chartOf(graph: Pick<FlowGraph, "datasets" | "checks">, live: Pick<FlowLive, "state" | "nodes"> | null | undefined): { items: ChartItem[]; edges: Array<{ from: string; to: string }> } {
  const building = live?.state === "running" ? live.nodes : {};
  const stale = outOfDate(graph.datasets);
  const names = new Map(graph.datasets.map((dataset) => [dataset.id, dataset.name]));
  const items: ChartItem[] = [];
  const edges: Array<{ from: string; to: string }> = [];
  for (const dataset of graph.datasets) {
    const ran = statusOf(building[dataset.id] ?? dataset.result?.status);
    const checks = checksOf(graph.checks, dataset.id);
    const results = checks.map((check) => statusOf(building[check.id] ?? check.result?.status));
    const passed = results.filter((status) => status === "ok").length;
    const inputs = dataset.dependsOn.map((id) => names.get(id) ?? id);
    const anyRan = results.some((status) => status !== "idle");
    const fallback = dataset.kind === "seed" ? "Uploaded data" : dataset.kind === "source" ? "From outside" : (dataset.materialized ?? "Dataset");
    const state = stale.has(dataset.id) ? ["Out of date"] : [];
    // What fits in a box, and the same said in full.
    const shown = [...state, ...(checks.length ? [anyRan ? `Checks ${passed}/${checks.length}` : `${checks.length} ${checks.length === 1 ? "check" : "checks"}`] : [])];
    const spoken = [...state, ...(checks.length ? [anyRan ? `${passed} of ${checks.length} checks passed` : `${checks.length} ${checks.length === 1 ? "check" : "checks"}`] : [])];
    const status = worstOf([ran, ...results]);
    const said = [`Dataset ${dataset.name}`, STATUS_WORDS[status], ...spoken, ...(inputs.length ? [`made from ${inputs.join(", ")}`] : [])];
    items.push({ id: dataset.id, label: dataset.name, detail: shown.length ? shown.join(" · ") : fallback, shape: "box", glyph: dataset.kind === "seed" ? "seed" : dataset.kind === "source" ? "source" : "table", status, description: said.join(", ") });
    if (hasRecipe(dataset)) {
      const id = recipeIdOf(dataset.id);
      const language = dataset.kind === "snapshot" ? "Snapshot" : dataset.language === "python" ? "Python" : "SQL";
      items.push({ id, label: dataset.kind === "snapshot" ? "Snap" : dataset.language === "python" ? "Py" : "SQL", shape: "circle", status: ran, description: [`${language} recipe that makes ${dataset.name}`, STATUS_WORDS[ran], ...(inputs.length ? [`from ${inputs.join(", ")}`] : [])].join(", ") });
      edges.push({ from: id, to: dataset.id });
      for (const input of dataset.dependsOn) edges.push({ from: input, to: id });
    } else {
      for (const input of dataset.dependsOn) edges.push({ from: input, to: dataset.id });
    }
  }
  return { items, edges };
}

// ---- Checks in plain words ----

const FILE_RULES: Array<[RegExp, (column: string) => string]> = [
  [/^(.+)__(.+)__not_null$/, (column) => `${column} is never empty`],
  [/^(.+)__(.+)__unique$/, (column) => `${column} has no duplicates`],
  [/^(.+)__(.+)__accepted$/, (column) => `${column} only has the allowed values`],
  [/^(.+)__(.+)__range$/, (column) => `${column} stays in its range`],
];

export function checkLabel(check: Pick<FlowCheck, "name" | "rule" | "column" | "values">): string {
  const column = check.column ?? "It";
  switch (check.rule) {
    case "not_null":
      return `${column} is never empty`;
    case "unique":
      return `${column} has no duplicates`;
    case "accepted_values":
      return check.values?.length ? `${column} is one of ${check.values.join(", ")}` : `${column} only has the allowed values`;
    case "relationships":
      return `${column} matches another dataset`;
  }
  if (check.name.endsWith("__has_rows")) return "It has rows";
  for (const [pattern, words] of FILE_RULES) {
    const found = pattern.exec(check.name);
    if (found) return words(found[2]!);
  }
  return check.name.replace(/_+/g, " ");
}

// ---- The files that new recipes and checks are ----

const hasJinja = (text: string) => /\{[{%#]/.test(text);
export const column = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|DECIMAL)/i;
const isNumber = (value: string) => value.trim() !== "" && Number.isFinite(Number(value));

/** How SQL and Python get at a dataset. */
export function sqlRef(dataset: Pick<FlowDataset, "kind" | "name">): string {
  if (dataset.kind !== "source") return `{{ ref('${dataset.name}') }}`;
  const [source, table] = dataset.name.split(".");
  return `{{ source('${source}', '${table}') }}`;
}
function pythonRef(dataset: Pick<FlowDataset, "kind" | "name">): string {
  if (dataset.kind !== "source") return `dbt.ref("${dataset.name}")`;
  const [source, table] = dataset.name.split(".");
  return `dbt.source("${source}", "${table}")`;
}

/** A path in the room for a file in the project. */
export const inProject = (project: { path: string }, relative: string) => (project.path === "." ? relative : `${project.path}/${relative}`);

/** Where this project keeps its recipes: where its first one is, or dbt's usual place. */
export function recipesFolder(project: { path: string }, datasets: ReadonlyArray<Pick<FlowDataset, "kind" | "file">>): string {
  const first = datasets.find((dataset) => dataset.kind === "model" && dataset.file)?.file;
  if (first) {
    const prefix = project.path === "." ? "" : `${project.path}/`;
    const relative = first.startsWith(prefix) ? first.slice(prefix.length) : first;
    const top = relative.split("/")[0];
    if (top && relative.includes("/")) return inProject(project, top);
  }
  return inProject(project, "models");
}

export type RecipeForm = {
  name: string;
  from: FlowDataset | null;
  columns: readonly string[];
  types?: readonly string[];
} & (
  | { kind: "sql" }
  | { kind: "python" }
  | { kind: "filter"; column: string; test: "equals" | "differs" | "above" | "below" | "contains" | "empty" | "filled"; value: string }
  | { kind: "group"; by: readonly string[]; measure: { how: "sum" | "avg" | "min" | "max" | "count_distinct"; column: string } | null }
  | { kind: "join"; other: FlowDataset | null; leftKey: string; rightKey: string; how: "left" | "inner" }
  | { kind: "automl"; target: string; features: readonly string[]; task: AutomlTask; seconds: number }
);

export type AutomlTask = "classification" | "regression";
/** Numbers are usually predicted as numbers, and anything else as one of its values. */
export const taskFor = (type: string | undefined): AutomlTask => (NUMERIC_TYPE.test(type ?? "") ? "regression" : "classification");
export const AUTOML_SECONDS = [15, 30, 60, 300] as const;

function automlSource(form: Extract<RecipeForm, { kind: "automl" }>, from: FlowDataset, features: readonly string[]): string {
  const classifying = form.task === "classification";
  const measure = classifying ? "accuracy" : "mean_error";
  const worked = classifying ? "float((predicted == test_y.to_numpy()).mean())" : "float(abs(predicted - test_y.to_numpy()).mean())";
  const target = JSON.stringify(form.target);
  return `def model(dbt, session):
    # An AutoML recipe: FLAML tries kinds of model for the time below, and keeps the best. This dataset is every row with what that model predicts.
    # A quarter of the rows are held back from training, so how it does on those is the number to trust. It's in the build's log, and when the
    # room has the full image, with MLflow in the Lakehouse tool. This is all of it, so change it as you like.
    from flaml import AutoML
    from sklearn.model_selection import train_test_split

    target = ${target}
    features = ${JSON.stringify(features)}
    seconds = ${form.seconds}

    frame = ${pythonRef(from)}.df().dropna(subset=[target]).reset_index(drop=True)
    train_x, test_x, train_y, test_y = train_test_split(frame[features], frame[target], test_size=0.25, random_state=1)

    automl = AutoML()
    automl.fit(train_x, train_y, task="${form.task}", time_budget=seconds, estimator_list=["lgbm", "xgboost", "rf", "extra_tree"], seed=1, n_jobs=1, verbose=0)

    predicted = automl.predict(test_x)
    score = ${worked}
    print(f"Best model: {automl.best_estimator}. ${measure} on the rows held back: {score:.3f}")

    try:
        import mlflow
    except ImportError:
        mlflow = None
    if mlflow:
        mlflow.set_experiment(${JSON.stringify(`Flow: ${form.name}`)})
        with mlflow.start_run(run_name=automl.best_estimator):
            mlflow.log_params({"target": target, "seconds": seconds, **automl.best_config})
            mlflow.log_metric("${measure}", score)

    result = frame.copy()
    result["predicted_" + target] = automl.predict(frame[features])
    result["held_back"] = result.index.isin(test_x.index)
    return result
`;
}

export const RECIPE_NAME = /^[a-z_][a-z0-9_]{0,59}$/;

function comparedTo(form: Extract<RecipeForm, { kind: "filter" }>): string {
  const type = form.types?.[form.columns.indexOf(form.column)] ?? "";
  return NUMERIC_TYPE.test(type) && isNumber(form.value) ? form.value.trim() : literal(form.value);
}

function filterSql(form: Extract<RecipeForm, { kind: "filter" }>): string {
  const name = column(form.column);
  switch (form.test) {
    case "equals":
      return `${name} = ${comparedTo(form)}`;
    case "differs":
      return `${name} is distinct from ${comparedTo(form)}`;
    case "above":
      return `${name} > ${comparedTo(form)}`;
    case "below":
      return `${name} < ${comparedTo(form)}`;
    case "contains":
      return `contains(${name}::varchar, ${literal(form.value)})`;
    case "empty":
      return `${name} is null`;
    case "filled":
      return `${name} is not null`;
  }
}

/** The file a recipe is, or what's wrong with what was asked for. */
export function newRecipe(form: RecipeForm, taken: readonly string[]): { fileName: string; content: string } | { error: string } {
  if (!RECIPE_NAME.test(form.name)) return { error: "A recipe's name is lower-case letters, numbers and underscores, and doesn't start with a number." };
  if (taken.includes(form.name)) return { error: `There's already a dataset called ${form.name}.` };
  const fileName = `${form.name}.${form.kind === "python" || form.kind === "automl" ? "py" : "sql"}`;
  if (form.kind === "python") {
    const input = form.from ? `    frame = ${pythonRef(form.from)}.df()\n` : `    import pandas as pd\n    frame = pd.DataFrame({"a": [1, 2, 3]})\n`;
    return { fileName, content: `def model(dbt, session):\n    # Whatever this returns becomes the dataset. dbt.ref reads another dataset, and .df() makes it a pandas DataFrame.\n${input}    return frame\n` };
  }
  if (form.kind === "sql") {
    if (!form.from) return { fileName, content: `select 1 as a\n` };
    const shown = form.columns.length ? form.columns.map((name) => `  ${column(name)}`).join(",\n") : "  *";
    return { fileName, content: `select\n${shown}\nfrom ${sqlRef(form.from)}\n` };
  }
  if (!form.from) return { error: "Choose what this recipe starts from." };
  if (form.kind === "automl") {
    if (!form.target) return { error: "Choose the column to predict." };
    const features = form.features.filter((name) => name !== form.target);
    if (!features.length) return { error: "Choose at least one column to learn from." };
    if (!Number.isInteger(form.seconds) || form.seconds < 5 || form.seconds > 600) return { error: "Choose how long to try." };
    return { fileName, content: automlSource(form, form.from, features) };
  }
  const words = JSON.stringify(form);
  if (hasJinja(words)) return { error: "Values can't have {{, {% or {# in them." };
  const from = sqlRef(form.from);
  if (form.kind === "filter") {
    if (!form.column) return { error: "Choose a column." };
    if (!["empty", "filled"].includes(form.test) && !form.value.trim()) return { error: "Say what to compare it with." };
    return { fileName, content: `-- A filter recipe. This is all of it, so change it as you like.\nselect *\nfrom ${from}\nwhere ${filterSql(form)}\n` };
  }
  if (form.kind === "group") {
    if (!form.by.length && !form.measure) return { error: "Choose what to group by, or something to work out." };
    const shown = form.by.map((name) => `  ${column(name)}`);
    shown.push(`  count(*) as "rows"`);
    if (form.measure) {
      const { how, column: measured } = form.measure;
      shown.push(how === "count_distinct" ? `  count(distinct ${column(measured)}) as ${column(`distinct_${measured}`)}` : `  ${how}(${column(measured)}) as ${column(`${how}_${measured}`)}`);
    }
    const grouped = form.by.length ? `group by ${form.by.map(column).join(", ")}\n` : "";
    return { fileName, content: `-- A group recipe. This is all of it, so change it as you like.\nselect\n${shown.join(",\n")}\nfrom ${from}\n${grouped}` };
  }
  if (!form.other) return { error: "Choose what to join it with." };
  if (!form.leftKey || !form.rightKey) return { error: "Choose the column to match on each side." };
  return { fileName, content: `-- A join recipe. This is all of it, so change it as you like.\nselect\n  l.*,\n  r.* exclude (${column(form.rightKey)})\nfrom ${from} as l\n${form.how} join ${sqlRef(form.other)} as r\n  on l.${column(form.leftKey)} = r.${column(form.rightKey)}\n` };
}

export type CheckRule = "not_null" | "unique" | "accepted" | "range" | "has_rows";
export const COLUMN_RULES: ReadonlyArray<{ rule: CheckRule; label: string }> = [
  { rule: "not_null", label: "Never empty" },
  { rule: "unique", label: "No duplicates" },
  { rule: "accepted", label: "Only these values" },
  { rule: "range", label: "Stays in a range" },
  { rule: "has_rows", label: "The dataset has rows" },
];

const safePart = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "x";

const value = (text: string) => (isNumber(text) ? text.trim() : literal(text));

/**
 * A check is one SQL file that finds the rows breaking it, which is how dbt runs any check. Nothing else needs editing to add one or take it away,
 * and a file can't clash with what a project's YAML already says about a dataset, which dbt refuses.
 */
export function newCheck(form: { dataset: Pick<FlowDataset, "kind" | "name">; rule: CheckRule; column: string; values: string; min: string; max: string }): { fileName: string; name: string; content: string } | { error: string } {
  if (hasJinja(JSON.stringify(form))) return { error: "Values can't have {{, {% or {# in them." };
  const from = sqlRef(form.dataset);
  const dataset = safePart(form.dataset.name);
  if (form.rule === "has_rows") {
    const name = `${dataset}__has_rows`;
    return { name, fileName: `${name}.sql`, content: `-- Fails when ${form.dataset.name} has no rows at all.\nselect 1 as problem\nwhere not exists (select 1 from ${from})\n` };
  }
  if (!form.column) return { error: "Choose a column." };
  const target = column(form.column);
  const name = `${dataset}__${safePart(form.column)}__${form.rule}`;
  const fileName = `${name}.sql`;
  switch (form.rule) {
    case "not_null":
      return { name, fileName, content: `-- The rows where ${form.column} is empty.\nselect *\nfrom ${from}\nwhere ${target} is null\n` };
    case "unique":
      return { name, fileName, content: `-- The values of ${form.column} that come up more than once.\nselect ${target}, count(*) as times\nfrom ${from}\nwhere ${target} is not null\ngroup by ${target}\nhaving count(*) > 1\n` };
    case "accepted": {
      const allowed = form.values
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!allowed.length) return { error: "List the allowed values, separated by commas." };
      return { name, fileName, content: `-- The rows where ${form.column} is anything else.\nselect *\nfrom ${from}\nwhere ${target} not in (${allowed.map(literal).join(", ")})\n` };
    }
    case "range": {
      const limits = [form.min.trim() && `${target} < ${value(form.min)}`, form.max.trim() && `${target} > ${value(form.max)}`].filter(Boolean);
      if (!limits.length) return { error: "Give a lowest value, a highest value, or both." };
      return { name, fileName, content: `-- The rows where ${form.column} is out of its range.\nselect *\nfrom ${from}\nwhere ${limits.join(" or ")}\n` };
    }
  }
}

/** A check written as its own file in tests/ can be taken away by deleting the file. One in YAML is edited by hand, as other things may be in that file. */
export const canRemoveCheck = (check: Pick<FlowCheck, "file">) => Boolean(check.file?.endsWith(".sql"));
