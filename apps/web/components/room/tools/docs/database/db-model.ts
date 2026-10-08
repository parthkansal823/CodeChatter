/**
 * Databases (the pure part: types, filters, sorts, groups). A database is a
 * page whose document holds properties, rows and views; see db-doc.ts for how
 * they sit in Yjs. Everything here works on plain objects so it can be tested.
 */
export const PROP_TYPES = ["text", "number", "select", "multiSelect", "person", "date", "checkbox", "status", "relation"] as const;
export type PropType = (typeof PROP_TYPES)[number];

export const PROP_LABEL: Record<PropType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiSelect: "Multi-select",
  person: "Person",
  date: "Date",
  checkbox: "Checkbox",
  status: "Status",
  relation: "Relation",
};

/** Status options are grouped so their marker shows the stage (not started, under way, done). */
export type StatusGroup = "todo" | "doing" | "done";
export type Option = { id: string; name: string; group?: StatusGroup };
export type Prop = { id: string; name: string; type: PropType; options: Option[]; order: number };

/** The row name is a property every database has; it is not stored with the others. */
export const TITLE_PROP: Prop = { id: "title", name: "Name", type: "text", options: [], order: -1 };

export type Row = { id: string; title: string; order: number; createdAt: number; cells: Record<string, unknown> };

export type FilterOp = "contains" | "notContains" | "is" | "isNot" | "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "before" | "after" | "onOrBefore" | "onOrAfter" | "isEmpty" | "notEmpty" | "checked" | "unchecked";
export type Filter = { id: string; prop: string; op: FilterOp; value: unknown };
export type Sort = { prop: string; dir: "asc" | "desc" };

export const VIEW_TYPES = ["table", "board", "calendar", "gallery", "list"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
export const VIEW_LABEL: Record<ViewType, string> = { table: "Table", board: "Board", calendar: "Calendar", gallery: "Gallery", list: "List" };

export type View = {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  sorts: Sort[];
  /** Board columns, and the headings in table, list and gallery views. */
  groupBy: string | null;
  /** The date property a calendar places rows by. */
  dateProp: string | null;
  order: number;
};

export const OPS: Record<PropType, FilterOp[]> = {
  text: ["contains", "notContains", "is", "isEmpty", "notEmpty"],
  number: ["eq", "neq", "gt", "lt", "gte", "lte", "isEmpty", "notEmpty"],
  select: ["is", "isNot", "isEmpty", "notEmpty"],
  status: ["is", "isNot", "isEmpty", "notEmpty"],
  multiSelect: ["contains", "notContains", "isEmpty", "notEmpty"],
  person: ["contains", "notContains", "isEmpty", "notEmpty"],
  relation: ["contains", "notContains", "isEmpty", "notEmpty"],
  date: ["is", "before", "after", "onOrBefore", "onOrAfter", "isEmpty", "notEmpty"],
  checkbox: ["checked", "unchecked"],
};

export const OP_LABEL: Record<FilterOp, string> = {
  contains: "contains",
  notContains: "does not contain",
  is: "is",
  isNot: "is not",
  eq: "equals",
  neq: "does not equal",
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  before: "is before",
  after: "is after",
  onOrBefore: "is on or before",
  onOrAfter: "is on or after",
  isEmpty: "is empty",
  notEmpty: "is not empty",
  checked: "is checked",
  unchecked: "is not checked",
};

/** Operators that need no value. */
export const VALUELESS: FilterOp[] = ["isEmpty", "notEmpty", "checked", "unchecked"];

export const GROUPABLE: PropType[] = ["select", "status", "multiSelect", "person", "checkbox", "text", "date"];
/** Board columns need a fixed set of values. */
export const BOARDABLE: PropType[] = ["select", "status", "multiSelect", "person", "checkbox"];

const asArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" && value ? [value] : []);

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The value of a row's property, with the row name standing in for `title`. */
export const cellOf = (row: Row, propId: string): unknown => (propId === TITLE_PROP.id ? row.title : row.cells[propId]);

export function matches(row: Row, filter: Filter, prop: Prop | undefined): boolean {
  if (!prop) return true;
  const value = cellOf(row, prop.id);
  const operand = filter.value;
  switch (filter.op) {
    case "isEmpty":
      return isEmpty(value);
    case "notEmpty":
      return !isEmpty(value);
    case "checked":
      return value === true;
    case "unchecked":
      return value !== true;
    case "contains":
    case "notContains": {
      const hit =
        prop.type === "text"
          ? String(value ?? "").toLowerCase().includes(String(operand ?? "").toLowerCase())
          : asArray(value).includes(String(operand ?? ""));
      // An empty operand filters nothing, so a half-built filter doesn't hide every row.
      if (operand === undefined || operand === "" || operand === null) return true;
      return filter.op === "contains" ? hit : !hit;
    }
    case "is":
    case "isNot": {
      if (operand === undefined || operand === "" || operand === null) return true;
      const same = prop.type === "date" || prop.type === "text" ? String(value ?? "").toLowerCase() === String(operand).toLowerCase() : value === operand;
      return filter.op === "is" ? same : !same;
    }
    case "eq":
    case "neq":
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      if (operand === undefined || operand === "" || operand === null || Number.isNaN(Number(operand))) return true;
      if (typeof value !== "number") return filter.op === "neq";
      const n = Number(operand);
      return { eq: value === n, neq: value !== n, gt: value > n, lt: value < n, gte: value >= n, lte: value <= n }[filter.op];
    }
    case "before":
    case "after":
    case "onOrBefore":
    case "onOrAfter": {
      if (typeof operand !== "string" || !operand) return true;
      if (typeof value !== "string" || !value) return false;
      return { before: value < operand, after: value > operand, onOrBefore: value <= operand, onOrAfter: value >= operand }[filter.op];
    }
  }
}

export function compareCells(a: unknown, b: unknown, prop: Prop): number {
  const emptyA = isEmpty(a);
  const emptyB = isEmpty(b);
  if (emptyA || emptyB) return Number(emptyA) - Number(emptyB);
  switch (prop.type) {
    case "number":
      return Number(a) - Number(b);
    case "checkbox":
      return Number(a === true) - Number(b === true);
    case "select":
    case "status": {
      const at = prop.options.findIndex((o) => o.id === a);
      const bt = prop.options.findIndex((o) => o.id === b);
      return at - bt;
    }
    case "multiSelect":
    case "person":
    case "relation":
      return asArray(a).join(",").localeCompare(asArray(b).join(","));
    default:
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }
}

/** Rows that pass every filter, in the order the sorts ask for (then by their own order). */
export function visibleRows(rows: Row[], view: Pick<View, "filters" | "sorts">, props: Prop[]): Row[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  const kept = rows.filter((row) => view.filters.every((filter) => matches(row, filter, byId.get(filter.prop))));
  const sorts = view.sorts.filter((sort) => byId.has(sort.prop));
  return kept.sort((a, b) => {
    for (const sort of sorts) {
      const prop = byId.get(sort.prop)!;
      const emptyA = isEmpty(cellOf(a, sort.prop));
      const emptyB = isEmpty(cellOf(b, sort.prop));
      // Empty values go last in both directions.
      if (emptyA || emptyB) {
        if (emptyA !== emptyB) return emptyA ? 1 : -1;
        continue;
      }
      const result = compareCells(cellOf(a, sort.prop), cellOf(b, sort.prop), prop);
      if (result !== 0) return sort.dir === "asc" ? result : -result;
    }
    return a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  });
}

export type Group = { key: string; label: string; rows: Row[] };
export const NO_VALUE = "__none__";

/**
 * Rows split by a property's values: one group per option (in option order)
 * with a "No value" group last. A multi-select row sits in each of its groups.
 * `people` supplies the names for a person property.
 */
export function groupRows(rows: Row[], prop: Prop, people: Array<{ id: string; name: string }> = []): Group[] {
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, row: Row) => {
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  };
  const seed = (key: string, label: string) => groups.set(key, { key, label, rows: [] });

  if (prop.type === "select" || prop.type === "status" || prop.type === "multiSelect") for (const option of prop.options) seed(option.id, option.name);
  if (prop.type === "person") for (const person of people) seed(person.id, person.name);
  if (prop.type === "checkbox") {
    seed("true", "Checked");
    seed("false", "Not checked");
  }

  for (const row of rows) {
    const value = cellOf(row, prop.id);
    if (prop.type === "checkbox") add(value === true ? "true" : "false", value === true ? "Checked" : "Not checked", row);
    else if (isEmpty(value)) add(NO_VALUE, "No value", row);
    else if (prop.type === "multiSelect" || prop.type === "person" || prop.type === "relation") {
      for (const id of asArray(value)) add(id, labelOf(prop, id, people), row);
    } else if (prop.type === "select" || prop.type === "status") add(String(value), labelOf(prop, String(value), people), row);
    else add(String(value), String(value), row);
  }

  const ordered = [...groups.values()];
  const none = ordered.filter((g) => g.key === NO_VALUE);
  const rest = ordered.filter((g) => g.key !== NO_VALUE);
  if (prop.type === "text" || prop.type === "date") rest.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  // Board columns keep empty groups; plain headings drop them.
  return [...rest, ...none];
}

export function labelOf(prop: Prop, id: string, people: Array<{ id: string; name: string }> = []): string {
  if (prop.type === "person") return people.find((p) => p.id === id)?.name ?? "Someone";
  return prop.options.find((o) => o.id === id)?.name ?? id;
}

/** What a card dropped into a group should hold, given what it held before. */
export function valueForDrop(prop: Prop, current: unknown, fromKey: string, toKey: string): unknown {
  const none = toKey === NO_VALUE;
  switch (prop.type) {
    case "checkbox":
      return toKey === "true";
    case "multiSelect":
    case "person": {
      const next = asArray(current).filter((id) => id !== fromKey);
      return none ? next : [...new Set([...next, toKey])];
    }
    default:
      return none ? null : toKey;
  }
}

/** A row's date as "YYYY-MM-DD", or null. */
export const dateOf = (row: Row, propId: string): string | null => {
  const value = cellOf(row, propId);
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

/** Rows keyed by the day they fall on. */
export function rowsByDay(rows: Row[], propId: string): Map<string, Row[]> {
  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const day = dateOf(row, propId);
    if (day) days.set(day, [...(days.get(day) ?? []), row]);
  }
  return days;
}

/** Text for a cell, for cards, CSV and search: names rather than ids. */
export function displayValue(row: Row, prop: Prop, ctx: { people: Array<{ id: string; name: string }>; pageTitle: (id: string) => string | null }): string {
  const value = cellOf(row, prop.id);
  if (isEmpty(value)) return prop.type === "checkbox" ? "false" : "";
  switch (prop.type) {
    case "checkbox":
      return value === true ? "true" : "false";
    case "select":
    case "status":
      return labelOf(prop, String(value));
    case "multiSelect":
      return asArray(value).map((id) => labelOf(prop, id)).join(", ");
    case "person":
      return asArray(value).map((id) => labelOf(prop, id, ctx.people)).join(", ");
    case "relation":
      return asArray(value).map((id) => ctx.pageTitle(id) ?? "Deleted page").join(", ");
    default:
      return String(value);
  }
}

const csvCell = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/** The visible rows as CSV (title first, then the properties in order). */
export function toCsv(rows: Row[], props: Prop[], ctx: Parameters<typeof displayValue>[2]): string {
  const columns = [TITLE_PROP, ...props];
  const lines = [columns.map((c) => csvCell(c.name)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(displayValue(row, c, ctx))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** The next free "Name 2" style name. */
export function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
