"""
Explain this data: the numbers behind a table of results, worked out by DuckDB, so the model explains them instead of guessing at them
(apps/runner/src/data-summary.ts runs this inside the sandbox).

Takes {"columns", "rows"} on stdin, rows of text or null, and prints one JSON object. DuckDB works out each column's type, then SUMMARIZE
gives its spread; duplicates, outliers beyond 1.5 times the interquartile range, common values and correlations are plain SQL.
"""
import csv
import json
import os
import sys
import tempfile

import duckdb

NULL = "__cc_null_7f3a9d__"
MOST_TOP = 5
MOST_TOP_UNIQUE = 50
MOST_NUMERIC = 12
MOST_VALUE_CHARS = 200
STRONG = 0.5
NUMERIC = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "FLOAT", "DOUBLE", "DECIMAL")


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def text(value):
    return None if value is None else str(value)[:MOST_VALUE_CHARS]


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def unique_names(columns):
    """A query can name two columns the same, and a table can't."""
    seen = {}
    names = []
    for index, column in enumerate(columns):
        name = str(column).strip() or f"column {index + 1}"
        seen[name] = seen.get(name, 0) + 1
        names.append(name if seen[name] == 1 else f"{name} ({seen[name]})")
    return names


def main():
    request = json.load(sys.stdin)
    names = unique_names(request["columns"])
    rows = request["rows"]
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "data.csv")
        with open(path, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(names)
            for row in rows:
                writer.writerow([NULL if value is None else value for value in row])
        db = duckdb.connect()
        db.execute(
            "CREATE TABLE t AS SELECT * FROM read_csv(?, header = true, auto_detect = true, nullstr = ?, sample_size = -1, max_line_size = 33554432, quote = '\"', escape = '\"', normalize_names = false, ignore_errors = false)",
            [path, NULL],
        )
    cursor = db.execute("SUMMARIZE t")
    fields = [item[0] for item in cursor.description]
    summary = [dict(zip(fields, row)) for row in cursor.fetchall()]
    total = db.execute("SELECT count(*) FROM t").fetchone()[0]
    distinct = db.execute("SELECT count(*) FROM (SELECT DISTINCT * FROM t)").fetchone()[0]
    columns = []
    numeric = []
    for item in summary:
        name, kind = item["column_name"], item["column_type"]
        is_number = kind.startswith(NUMERIC)
        column = {
            "name": name,
            "type": kind,
            "nullPercent": number(item.get("null_percentage")) or 0,
            "unique": int(item.get("approx_unique") or 0),
            "min": text(item.get("min")),
            "max": text(item.get("max")),
            "mean": text(item.get("avg")) if is_number else None,
            "std": text(item.get("std")) if is_number else None,
            "q25": text(item.get("q25")) if is_number else None,
            "q50": text(item.get("q50")) if is_number else None,
            "q75": text(item.get("q75")) if is_number else None,
            "outliers": 0,
            "top": [],
        }
        if is_number:
            numeric.append(name)
            low, high = number(item.get("q25")), number(item.get("q75"))
            if low is not None and high is not None:
                spread = high - low
                column["outliers"] = db.execute(f"SELECT count(*) FROM t WHERE {quoted(name)} < ? OR {quoted(name)} > ?", [low - 1.5 * spread, high + 1.5 * spread]).fetchone()[0]
        if not is_number or column["unique"] <= MOST_TOP_UNIQUE:
            found = db.execute(f"SELECT {quoted(name)}, count(*) AS n FROM t WHERE {quoted(name)} IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT {MOST_TOP}").fetchall()
            column["top"] = [{"value": text(value), "count": count} for value, count in found]
        columns.append(column)
    correlations = []
    usable = numeric[:MOST_NUMERIC]
    if total >= 3:
        for index, first in enumerate(usable):
            for second in usable[index + 1 :]:
                value = db.execute(f"SELECT corr({quoted(first)}, {quoted(second)}) FROM t").fetchone()[0]
                if value is not None and value == value and abs(value) >= STRONG:
                    correlations.append({"a": first, "b": second, "r": round(value, 3)})
    correlations.sort(key=lambda item: -abs(item["r"]))
    print(json.dumps({"engine": f"DuckDB {duckdb.__version__}", "rows": total, "duplicates": total - distinct, "columns": columns, "correlations": correlations[:20]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # What DuckDB says is the person's to read: it doesn't hold anything theirs they haven't sent.
        print(json.dumps({"error": f"DuckDB couldn't read this table: {str(error)[:300]}"}))
