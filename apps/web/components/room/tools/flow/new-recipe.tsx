/** Making a recipe in the Flow tool: blank SQL or Python to write by hand, or a filter, group or join chosen from the data's real columns. Each is a file in the project, written as anyone would write it. */
"use client";

import type { FlowDataset, FlowRows } from "@codechatter/contracts";
import { createFileAtPath, findByPath } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import { AUTOML_SECONDS, newRecipe, taskFor, type AutomlTask, type RecipeForm } from "./model";
import { FRESH, field, type Ask } from "./shared";

type Kind = RecipeForm["kind"];
type FilterTest = Extract<RecipeForm, { kind: "filter" }>["test"];
type GroupHow = NonNullable<Extract<RecipeForm, { kind: "group" }>["measure"]>["how"];

const KINDS: Array<{ kind: Kind; label: string; needsData: boolean }> = [
  { kind: "filter", label: "Filter: keep some rows", needsData: true },
  { kind: "group", label: "Group: totals for each value", needsData: true },
  { kind: "join", label: "Join: add columns from another dataset", needsData: true },
  { kind: "automl", label: "AutoML: predict a column", needsData: true },
  { kind: "sql", label: "SQL: write it yourself", needsData: false },
  { kind: "python", label: "Python: write it yourself", needsData: false },
];
const TESTS: Array<{ test: FilterTest; label: string; needsValue: boolean }> = [
  { test: "equals", label: "is", needsValue: true },
  { test: "differs", label: "isn't", needsValue: true },
  { test: "above", label: "is more than", needsValue: true },
  { test: "below", label: "is less than", needsValue: true },
  { test: "contains", label: "contains", needsValue: true },
  { test: "filled", label: "isn't empty", needsValue: false },
  { test: "empty", label: "is empty", needsValue: false },
];
const MEASURES: Array<{ how: GroupHow; label: string }> = [
  { how: "sum", label: "Total" },
  { how: "avg", label: "Average" },
  { how: "min", label: "Lowest" },
  { how: "max", label: "Highest" },
  { how: "count_distinct", label: "Number of different" },
];

export function NewRecipe({ from, datasets, folder, ask, onCancel, onMade }: { from: FlowDataset | null; datasets: FlowDataset[]; folder: string; ask: Ask; onCancel: () => void; onMade: (path: string, openCode: boolean) => void }) {
  const { room, doc, me } = useRoom();
  const [kind, setKind] = useState<Kind>(from ? "filter" : "sql");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [column, setColumn] = useState("");
  const [test, setTest] = useState<FilterTest>("equals");
  const [value, setValue] = useState("");
  const [by, setBy] = useState<string[]>([]);
  const [how, setHow] = useState<GroupHow | "">("");
  const [measured, setMeasured] = useState("");
  const [otherName, setOtherName] = useState("");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [joinHow, setJoinHow] = useState<"left" | "inner">("left");
  const [target, setTarget] = useState("");
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const [chosenTask, setChosenTask] = useState<AutomlTask | null>(null);
  const [seconds, setSeconds] = useState<number>(AUTOML_SECONDS[1]);

  const others = datasets.filter((item) => item.id !== from?.id);
  const other = others.find((item) => item.name === otherName) ?? null;
  const read = (dataset: FlowDataset | null) => ({ queryKey: ["flow", room.id, "preview", dataset?.name, "for-recipe"], queryFn: () => ask<FlowRows>({ op: "preview", dataset: dataset!.name }), ...FRESH, enabled: Boolean(dataset) });
  const fromRows = useQuery(read(from));
  const otherRows = useQuery(read(other));
  const columns = fromRows.data?.columns ?? [];
  const otherColumns = otherRows.data?.columns ?? [];
  const firstColumn = column || columns[0] || "";
  const needsValue = TESTS.find((item) => item.test === test)?.needsValue ?? false;
  const predicted = target || columns[0] || "";
  const task = chosenTask ?? taskFor(fromRows.data?.types[columns.indexOf(predicted)]);

  const make = () => {
    const base = { name: name.trim(), from, columns, types: fromRows.data?.types };
    const form: RecipeForm =
      kind === "filter"
        ? { ...base, kind, column: firstColumn, test, value }
        : kind === "group"
          ? { ...base, kind, by, measure: how ? { how, column: measured || columns[0] || "" } : null }
          : kind === "join"
            ? { ...base, kind, other, leftKey: leftKey || columns[0] || "", rightKey: rightKey || otherColumns[0] || "", how: joinHow }
            : kind === "automl"
              ? { ...base, kind, target: predicted, features: columns.filter((item) => !leftOut.includes(item)), task, seconds }
              : { ...base, kind };
    const made = newRecipe(
      form,
      datasets.map((item) => item.name),
    );
    if ("error" in made) return setProblem(made.error);
    const path = `${folder}/${made.fileName}`;
    if (findByPath(doc, path)) return setProblem(`There's already a file called ${path}.`);
    createFileAtPath(doc, path, made.content, me.user.id);
    onMade(path, kind === "sql" || kind === "python");
  };

  return (
    <form
      aria-label="New recipe"
      className="grid min-w-0 content-start gap-2 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        make();
      }}
    >
      <div>
        <h3 className="text-[13px] font-medium">New recipe</h3>
        {from && (
          <p className="text-muted-foreground">
            Starts from <span className="font-mono">{from.name}</span>.
          </p>
        )}
      </div>
      <label className="grid gap-1">
        What it does
        <select className={field} value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
          {KINDS.filter((item) => from || !item.needsData).map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        Name of the dataset it makes
        <Input className="h-7 font-mono text-xs" placeholder="orders_in_pune" value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      {from && kind !== "sql" && kind !== "python" && !columns.length && <p className="text-muted-foreground">Build {from.name} first, to choose from its columns.</p>}

      {kind === "filter" && columns.length > 0 && (
        <fieldset className="grid gap-1">
          <legend className="mb-1">Keep the rows where</legend>
          <select aria-label="Column" className={field} value={firstColumn} onChange={(event) => setColumn(event.target.value)}>
            {columns.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select aria-label="Test" className={field} value={test} onChange={(event) => setTest(event.target.value as FilterTest)}>
            {TESTS.map((item) => (
              <option key={item.test} value={item.test}>
                {item.label}
              </option>
            ))}
          </select>
          {needsValue && <Input aria-label="Value" className="h-7 text-xs" value={value} onChange={(event) => setValue(event.target.value)} />}
        </fieldset>
      )}

      {kind === "group" && columns.length > 0 && (
        <>
          <fieldset className="grid gap-1">
            <legend className="mb-1">One row for each</legend>
            {columns.map((item) => (
              <label key={item} className="flex items-center gap-2 font-mono">
                <Checkbox checked={by.includes(item)} onCheckedChange={(on) => setBy(on ? [...by, item] : by.filter((other) => other !== item))} />
                {item}
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-1">
            <legend className="mb-1">Also work out (it always counts the rows)</legend>
            <select aria-label="What to work out" className={field} value={how} onChange={(event) => setHow(event.target.value as GroupHow | "")}>
              <option value="">Nothing else</option>
              {MEASURES.map((item) => (
                <option key={item.how} value={item.how}>
                  {item.label}
                </option>
              ))}
            </select>
            {how && (
              <select aria-label="Of which column" className={field} value={measured || columns[0]} onChange={(event) => setMeasured(event.target.value)}>
                {columns.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            )}
          </fieldset>
        </>
      )}

      {kind === "join" && columns.length > 0 && (
        <fieldset className="grid gap-1">
          <legend className="mb-1">Add columns from</legend>
          <select aria-label="Other dataset" className={field} value={otherName} onChange={(event) => setOtherName(event.target.value)}>
            <option value="">Choose a dataset</option>
            {others.map((item) => (
              <option key={item.id}>{item.name}</option>
            ))}
          </select>
          {other && !otherColumns.length && !otherRows.isPending && <p className="text-muted-foreground">Build {other.name} first, to choose from its columns.</p>}
          {other && otherColumns.length > 0 && (
            <>
              <label className="grid gap-1">
                Match this column here
                <select className={field} value={leftKey || columns[0]} onChange={(event) => setLeftKey(event.target.value)}>
                  {columns.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                With this one there
                <select className={field} value={rightKey || otherColumns[0]} onChange={(event) => setRightKey(event.target.value)}>
                  {otherColumns.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                Rows with no match
                <select className={field} value={joinHow} onChange={(event) => setJoinHow(event.target.value as "left" | "inner")}>
                  <option value="left">Keep them</option>
                  <option value="inner">Leave them out</option>
                </select>
              </label>
            </>
          )}
        </fieldset>
      )}

      {kind === "automl" && columns.length > 0 && (
        <>
          <label className="grid gap-1">
            Column to predict
            <select className={field} value={predicted} onChange={(event) => setTarget(event.target.value)}>
              {columns.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            What it is
            <select className={field} value={task} onChange={(event) => setChosenTask(event.target.value as AutomlTask)}>
              <option value="classification">One of a few values</option>
              <option value="regression">A number</option>
            </select>
          </label>
          <fieldset className="grid gap-1">
            <legend className="mb-1">Learn from</legend>
            {columns
              .filter((item) => item !== predicted)
              .map((item) => (
                <label key={item} className="flex items-center gap-2 font-mono">
                  <Checkbox checked={!leftOut.includes(item)} onCheckedChange={(on) => setLeftOut(on ? leftOut.filter((other) => other !== item) : [...leftOut, item])} />
                  {item}
                </label>
              ))}
            <p className="text-muted-foreground">Leave out what gives the answer away, like an id, or anything only known afterwards.</p>
          </fieldset>
          <label className="grid gap-1">
            How long to try
            <select className={field} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
              {AUTOML_SECONDS.map((item) => (
                <option key={item} value={item}>
                  {item < 60 ? `${item} seconds` : `${item / 60} ${item === 60 ? "minute" : "minutes"}`}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-1">
        <Button size="xs" type="submit">
          Make it
        </Button>
        <Button size="xs" type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
