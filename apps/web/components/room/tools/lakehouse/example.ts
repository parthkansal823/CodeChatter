/** The Lakehouse tool's example: a notebook that goes from messy data to a clean table with Spark and Delta Lake, then logs a run with MLflow. */
import { cellsOf, createFileAtPath, deleteCell, cellId, ensureNotebook, insertCell } from "@codechatter/workspace-model";
import type * as Y from "yjs";

export const EXAMPLE_NOTEBOOK = "lakehouse-example.ipynb";

const CELLS: Array<["markdown" | "code", string]> = [
  [
    "markdown",
    `# A small lakehouse

The same tools Databricks is built on, running in this room: **Apache Spark** to process data, **Delta Lake** for tables with versions, and **MLflow** to keep track of experiments.

Data goes through three stages: **bronze** as it arrived, **silver** cleaned, and **gold** ready to use. Run each cell in turn. The first one takes a while, as Spark starts up. Then open the Lakehouse tool to see the tables and their versions.`,
  ],
  [
    "code",
    `from lakehouse import session

spark = session()
print("Spark", spark.version)`,
  ],
  [
    "markdown",
    `## Bronze: as it arrived

Duplicates, a city in the wrong case, a missing amount and one that isn't a number.`,
  ],
  [
    "code",
    `raw = [
    ("1", "Pune", "120.50"),
    ("2", "Delhi", "80"),
    ("2", "Delhi", "80"),
    ("3", "pune", ""),
    ("4", "Agra", "not a number"),
    ("5", "Delhi", "300"),
    ("6", "Pune", "45"),
]
bronze = spark.createDataFrame(raw, ["order_id", "city", "amount"])
bronze.write.format("delta").mode("overwrite").saveAsTable("bronze_orders")
spark.table("bronze_orders").toPandas()`,
  ],
  [
    "markdown",
    `## Silver: cleaned

No duplicates, cities in one form, and amounts as numbers. What can't be read is dropped.`,
  ],
  [
    "code",
    `from pyspark.sql import functions as F

silver = (
    spark.table("bronze_orders")
    .dropDuplicates(["order_id"])
    .withColumn("city", F.initcap("city"))
    .withColumn("amount", F.expr("try_cast(amount AS DOUBLE)"))
    .dropna(subset=["amount"])
)
silver.write.format("delta").mode("overwrite").saveAsTable("silver_orders")
spark.table("silver_orders").orderBy("order_id").toPandas()`,
  ],
  [
    "markdown",
    `## Gold: ready to use

Totals by city. Press **Explain this data** under the table to have the AI explain it, from numbers DuckDB works out.`,
  ],
  [
    "code",
    `gold = spark.table("silver_orders").groupBy("city").agg(F.count("*").alias("orders"), F.sum("amount").alias("total"))
gold.write.format("delta").mode("overwrite").saveAsTable("gold_city_totals")
spark.table("gold_city_totals").orderBy("city").toPandas()`,
  ],
  [
    "markdown",
    `## Versions: going back in time

Every change to a Delta table is a new version, and the old ones can still be read. Change a total, then read the table as it was.`,
  ],
  [
    "code",
    `spark.sql("UPDATE gold_city_totals SET total = 0 WHERE city = 'Agra' OR city = 'Pune'")
print("Now:")
spark.table("gold_city_totals").orderBy("city").show()
print("As it was, at version 0:")
spark.read.option("versionAsOf", 0).table("gold_city_totals").orderBy("city").show()`,
  ],
  [
    "markdown",
    `## Experiments: keeping track of what you tried

MLflow records each run's settings and results. They show up in the Lakehouse tool's Experiments, side by side.`,
  ],
  [
    "code",
    `import mlflow

mlflow.set_experiment("big orders")
for threshold in [50, 100, 200]:
    big = spark.table("silver_orders").filter(F.col("amount") >= threshold).count()
    with mlflow.start_run(run_name=f"over {threshold}"):
        mlflow.log_param("threshold", threshold)
        mlflow.log_metric("big_orders", big)
print("Logged 3 runs.")`,
  ],
];

/** The notebook's file, made if it isn't there. */
export function createExampleNotebook(doc: Y.Doc, by: string | null): string {
  const fileId = createFileAtPath(doc, EXAMPLE_NOTEBOOK, "", by);
  const notebook = ensureNotebook(doc, fileId);
  doc.transact(() => {
    const blank = cellsOf(notebook).toArray().map(cellId);
    for (const [index, [type, source]] of CELLS.entries()) insertCell(notebook, index, type, source);
    for (const id of blank) deleteCell(notebook, id);
  });
  return fileId;
}
