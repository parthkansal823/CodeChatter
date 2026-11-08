/** What the Automations tool works out without a server: reading a flow in Activepieces' own format, its chart with what ran lit up, and changing it. A flow is a tree: each step has the one after it, a router has its branches, a loop has what's inside it. */
import type { AutomationStepResult, PieceInfo } from "@codechatter/contracts";

export type FlowStep = {
  name: string;
  type: "PIECE_TRIGGER" | "EMPTY" | "CODE" | "PIECE" | "ROUTER" | "LOOP_ON_ITEMS";
  displayName: string;
  valid?: boolean;
  skip?: boolean;
  settings: Record<string, unknown>;
  nextAction?: FlowStep | null;
  firstLoopAction?: FlowStep | null;
  children?: Array<FlowStep | null>;
};
export type Flow = {
  /** Stays with the flow when its file moves, so its runs do too. */
  id?: string;
  displayName: string;
  schemaVersion: string;
  trigger: FlowStep;
  /** What it's for, in a sentence or two. Ours, not the engine's: the host never hands it on. */
  description?: string;
  /** A note on a step, by its name, shown under its box. */
  stepNotes?: Record<string, string>;
};

export const SCHEMA_VERSION = "27";

export function parseFlow(text: string): { flow: Flow } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "This file isn't valid JSON, so it can't be shown as a flow. It can still be fixed by hand." };
  }
  const flow = value as Partial<Flow> | null;
  if (!flow || typeof flow !== "object" || !flow.trigger || typeof flow.trigger !== "object" || typeof flow.trigger.name !== "string") return { error: "This file isn't a flow: it has no trigger." };
  // Whatever else the file has is kept, its id above all: an edit that dropped it would leave the flow's runs behind.
  return { flow: { ...flow, displayName: typeof flow.displayName === "string" ? flow.displayName : "Automation", schemaVersion: typeof flow.schemaVersion === "string" ? flow.schemaVersion : SCHEMA_VERSION, trigger: flow.trigger } };
}

/** Every step, in the order it would run, with what's inside each. */
export function allSteps(start: FlowStep | null | undefined): FlowStep[] {
  const found: FlowStep[] = [];
  const seen = new Set<FlowStep>();
  const walk = (step: FlowStep | null | undefined) => {
    for (let current = step; current && !seen.has(current); current = current.nextAction) {
      seen.add(current);
      found.push(current);
      walk(current.firstLoopAction);
      for (const child of current.children ?? []) walk(child);
    }
  };
  walk(start);
  return found;
}

export const findStep = (flow: Flow, name: string) => allSteps(flow.trigger).find((step) => step.name === name) ?? null;

// ---- What a run did ----

export type ChartStatus = "idle" | "running" | "ok" | "warning" | "failed" | "skipped";

export function statusOfResult(result: Pick<AutomationStepResult, "status"> | null | undefined): ChartStatus {
  switch (result?.status) {
    case "SUCCEEDED":
      return "ok";
    case "RUNNING":
    case "PAUSED":
      return "running";
    case "FAILED":
      return "failed";
    case "STOPPED":
      return "skipped";
    default:
      return "idle";
  }
}

/**
 * Each step's result in a run. A step inside a loop has one for each time round, kept in the loop's own output: it shows the worst of them, and how many there were.
 */
export function resultsOf(steps: Record<string, AutomationStepResult> | undefined): Map<string, { status: ChartStatus; times: number; results: AutomationStepResult[] }> {
  const out = new Map<string, { status: ChartStatus; times: number; results: AutomationStepResult[] }>();
  const add = (name: string, result: AutomationStepResult) => {
    const before = out.get(name);
    const status = statusOfResult(result);
    const worse = before?.status === "failed" || status === "failed" ? "failed" : (before?.status ?? status);
    out.set(name, { status: worse, times: (before?.times ?? 0) + 1, results: [...(before?.results ?? []), result] });
  };
  const walk = (from: Record<string, AutomationStepResult>) => {
    for (const [name, result] of Object.entries(from)) {
      add(name, result);
      const iterations = (result.output as { iterations?: unknown } | undefined)?.iterations;
      if (result.type === "LOOP_ON_ITEMS" && Array.isArray(iterations)) for (const round of iterations) if (round && typeof round === "object") walk(round as Record<string, AutomationStepResult>);
    }
  };
  walk(steps ?? {});
  return out;
}

const KIND_WORDS: Record<string, string> = { CODE: "Code", ROUTER: "Router", LOOP_ON_ITEMS: "Loop", EMPTY: "Choose a trigger" };

/** What a step is, in a few words: its piece's name and what it does there, or its kind. */
export function kindOf(step: FlowStep, pieces?: Record<string, PieceInfo>): string {
  if (step.type === "PIECE" || step.type === "PIECE_TRIGGER") {
    const settings = step.settings as { pieceName?: string; actionName?: string; triggerName?: string };
    const piece = settings.pieceName ? pieces?.[settings.pieceName] : undefined;
    const name = piece?.label ?? settings.pieceName?.replace("@activepieces/piece-", "") ?? "Piece";
    const what = step.type === "PIECE" ? piece?.actions[settings.actionName ?? ""]?.label : piece?.triggers[settings.triggerName ?? ""]?.label;
    return what ? `${name}: ${what}` : name;
  }
  return KIND_WORDS[step.type] ?? step.type;
}

export type Glyph = "trigger" | "code" | "piece" | "router" | "loop";
/** A box on the chart: a step, or a + where one can be added. */
export type ChartItem = { id: string; label: string; detail: string; shape: "box" | "add"; glyph: Glyph; status: ChartStatus; description: string; muted?: boolean; note?: string; place?: Place };
/** An arrow. `place` says where a step put on it goes; `label` is a router's branch. */
export type ChartEdge = { from: string; to: string; label?: string; place?: Place };
const GLYPHS: Record<FlowStep["type"], Glyph> = { PIECE_TRIGGER: "trigger", EMPTY: "trigger", CODE: "code", PIECE: "piece", ROUTER: "router", LOOP_ON_ITEMS: "loop" };
const STATUS_WORDS: Record<ChartStatus, string> = { idle: "didn't run", running: "running now", ok: "ran fine", warning: "has a warning", failed: "failed", skipped: "stopped" };
const title = (step: FlowStep) => step.displayName || step.name;

/**
 * The chart: boxes and arrows, with branches going their own ways and coming back together at the step after the router. With `adds`, there's a + wherever
 * nothing comes next yet (after the last step, in an empty branch or loop), and each arrow says where a step put on it would go.
 */
export function chartOfFlow(flow: Flow, steps: Record<string, AutomationStepResult> | undefined, pieces?: Record<string, PieceInfo>, options: { adds?: boolean } = {}): { items: ChartItem[]; edges: ChartEdge[] } {
  const results = resultsOf(steps);
  const ran = Object.keys(steps ?? {}).length > 0;
  const adds = options.adds === true;
  const items: ChartItem[] = [];
  const edges: ChartEdge[] = [];
  const seen = new Set<string>();
  type End = { id: string; label?: string; place: Place };
  const arrow = (end: End, to: string) => edges.push({ from: end.id, to, ...(end.label ? { label: end.label } : {}), place: end.place });
  const addPoint = (id: string, place: Place, description: string, from: End[]) => {
    items.push({ id, label: "+", detail: "", shape: "add", glyph: "piece", status: "idle", description, place });
    for (const end of from) arrow(end, id);
    return id;
  };

  /** Draws a chain, and returns the arrows that leave its end, and its last step. */
  const chain = (start: FlowStep | null | undefined, from: End[]): { ends: End[]; last: FlowStep | null } => {
    let ends = from;
    let last: FlowStep | null = null;
    for (let step = start; step; step = step.nextAction) {
      if (seen.has(step.name)) break;
      seen.add(step.name);
      last = step;
      for (const end of ends) arrow(end, step.name);
      const result = results.get(step.name);
      const status = result?.status ?? "idle";
      const kind = kindOf(step, pieces);
      const times = result && result.times > 1 ? ` · ${result.times} times` : "";
      const note = flow.stepNotes?.[step.name]?.trim() || undefined;
      items.push({
        id: step.name,
        label: title(step),
        detail: `${step.skip ? "Off · " : ""}${kind}${times}`,
        shape: "box",
        glyph: GLYPHS[step.type] ?? "piece",
        status,
        ...(step.skip ? { muted: true } : {}),
        ...(note ? { note } : {}),
        description: [`Step ${title(step)}`, kind, ...(step.skip ? ["turned off"] : []), ...(ran ? [STATUS_WORDS[status]] : []), ...(result && result.times > 1 ? [`${result.times} times`] : []), ...(note ? [`note: ${note}`] : [])].join(", "),
      });
      if (step.type === "ROUTER") {
        const branches = (step.settings.branches ?? []) as Array<{ branchName?: string }>;
        const children = step.children ?? [];
        const out: End[] = [];
        for (let index = 0; index < Math.max(branches.length, children.length); index++) {
          const into: End = { id: step.name, label: branches[index]?.branchName || `Branch ${index + 1}`, place: { inBranch: step.name, branch: index } };
          const child = children[index];
          if (child) out.push(...chain(child, [into]).ends);
          else if (adds) out.push({ id: addPoint(`+branch:${step.name}:${index}`, into.place, `Add a step to the ${into.label} branch of ${title(step)}`, [into]), place: into.place });
          else out.push(into);
        }
        ends = out;
      } else {
        if (step.type === "LOOP_ON_ITEMS") {
          const into: End = { id: step.name, label: "Each", place: { insideLoop: step.name } };
          if (step.firstLoopAction) {
            const inner = chain(step.firstLoopAction, [into]);
            if (adds && inner.last) addPoint(`+after:${inner.last.name}`, { after: inner.last.name }, `Add a step after ${title(inner.last)}`, inner.ends);
          } else if (adds) addPoint(`+inside:${step.name}`, into.place, `Add a step inside ${title(step)}`, [into]);
        }
        ends = [{ id: step.name, place: { after: step.name } }];
      }
    }
    return { ends, last };
  };
  const main = chain(flow.trigger, []);
  if (adds && main.last) addPoint(`+after:${main.last.name}`, { after: main.last.name }, `Add a step after ${title(main.last)}`, main.ends);
  return { items, edges };
}

/** Every test a router's condition can do, as the engine names it. "Starts with" is TEXT_START_WITH there, without an S. */
export const CONDITIONS: ReadonlyArray<{ value: string; words: string; needsValue: boolean; text?: boolean }> = [
  { value: "TEXT_CONTAINS", words: "contains", needsValue: true, text: true },
  { value: "TEXT_DOES_NOT_CONTAIN", words: "doesn't contain", needsValue: true, text: true },
  { value: "TEXT_EXACTLY_MATCHES", words: "is exactly", needsValue: true, text: true },
  { value: "TEXT_DOES_NOT_EXACTLY_MATCH", words: "isn't exactly", needsValue: true, text: true },
  { value: "TEXT_START_WITH", words: "starts with", needsValue: true, text: true },
  { value: "TEXT_DOES_NOT_START_WITH", words: "doesn't start with", needsValue: true, text: true },
  { value: "TEXT_ENDS_WITH", words: "ends with", needsValue: true, text: true },
  { value: "TEXT_DOES_NOT_END_WITH", words: "doesn't end with", needsValue: true, text: true },
  { value: "NUMBER_IS_GREATER_THAN", words: "is more than", needsValue: true },
  { value: "NUMBER_IS_LESS_THAN", words: "is less than", needsValue: true },
  { value: "NUMBER_IS_EQUAL_TO", words: "is the number", needsValue: true },
  { value: "BOOLEAN_IS_TRUE", words: "is true", needsValue: false },
  { value: "BOOLEAN_IS_FALSE", words: "is false", needsValue: false },
  { value: "DATE_IS_BEFORE", words: "is before the date", needsValue: true },
  { value: "DATE_IS_EQUAL", words: "is the date", needsValue: true },
  { value: "DATE_IS_AFTER", words: "is after the date", needsValue: true },
  { value: "LIST_CONTAINS", words: "is a list that has", needsValue: true, text: true },
  { value: "LIST_DOES_NOT_CONTAIN", words: "is a list without", needsValue: true, text: true },
  { value: "LIST_IS_EMPTY", words: "is an empty list", needsValue: false },
  { value: "LIST_IS_NOT_EMPTY", words: "is a list with something in it", needsValue: false },
  { value: "EXISTS", words: "has a value", needsValue: false },
  { value: "DOES_NOT_EXIST", words: "has no value", needsValue: false },
];
export type Condition = { operator: string; firstValue: string; secondValue?: string; caseSensitive?: boolean };
export type Branch = { branchName: string; branchType: "CONDITION" | "FALLBACK"; conditions?: Condition[][] };
export const newCondition = (): Condition => ({ operator: "TEXT_CONTAINS", firstValue: "", secondValue: "", caseSensitive: false });

// ---- Changing a flow. Each returns a new flow, and leaves the one it was given as it was. ----

const clone = (flow: Flow): Flow => JSON.parse(JSON.stringify(flow)) as Flow;

/** A name no other step has: expressions refer to steps by name. */
export function newStepName(flow: Flow, base = "step"): string {
  const taken = new Set(allSteps(flow.trigger).map((step) => step.name));
  const clean = base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "step";
  for (let index = 1; ; index++) {
    const name = `${clean}_${index}`;
    if (!taken.has(name)) return name;
  }
}

const NO_FAILURE_HANDLING = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };

export function newCodeStep(name: string): FlowStep {
  return { name, type: "CODE", displayName: "Code", valid: true, skip: false, settings: { sourceCode: { code: "export const code = async (inputs) => {\n  return { ok: true };\n};\n", packageJson: "{}" }, input: {}, errorHandlingOptions: NO_FAILURE_HANDLING }, nextAction: null };
}

export function newRouterStep(name: string): FlowStep {
  return { name, type: "ROUTER", displayName: "Router", valid: true, skip: false, settings: { executionType: "EXECUTE_FIRST_MATCH", branches: [{ branchName: "Branch 1", branchType: "CONDITION", conditions: [[newCondition()]] }, { branchName: "Otherwise", branchType: "FALLBACK" }] }, children: [null, null], nextAction: null };
}

export function newLoopStep(name: string): FlowStep {
  return { name, type: "LOOP_ON_ITEMS", displayName: "Loop", valid: true, skip: false, settings: { items: "" }, firstLoopAction: null, nextAction: null };
}

/** A piece's action, with its fields at their defaults. */
export function newPieceStep(name: string, pieceName: string, piece: PieceInfo, actionName: string): FlowStep {
  const action = piece.actions[actionName];
  const input = Object.fromEntries(Object.entries(action?.fields ?? {}).flatMap(([key, field]) => (field.default === undefined ? [] : [[key, field.default]])));
  return { name, type: "PIECE", displayName: action?.label ?? piece.label, valid: true, skip: false, settings: { pieceName, pieceVersion: piece.version, actionName, input, propertySettings: {}, errorHandlingOptions: NO_FAILURE_HANDLING }, nextAction: null };
}

export function newTrigger(pieceName: string, piece: PieceInfo, triggerName: string): FlowStep {
  const trigger = piece.triggers[triggerName];
  const input = Object.fromEntries(Object.entries(trigger?.fields ?? {}).flatMap(([key, field]) => (field.default === undefined ? [] : [[key, field.default]])));
  return { name: "trigger", type: "PIECE_TRIGGER", displayName: trigger?.label ?? piece.label, valid: true, settings: { pieceName, pieceVersion: piece.version, triggerName, input, propertySettings: {} }, nextAction: null };
}

/** Where a new step goes: after a step, as the first in a loop, or as the first in a router's branch. */
export type Place = { after: string } | { insideLoop: string } | { inBranch: string; branch: number };

export function addStep(flow: Flow, place: Place, step: FlowStep): Flow {
  const next = clone(flow);
  const added: FlowStep = { ...step };
  if ("after" in place) {
    const before = findStep(next, place.after);
    if (!before) return flow;
    added.nextAction = before.nextAction ?? null;
    before.nextAction = added;
    return next;
  }
  if ("insideLoop" in place) {
    const loop = findStep(next, place.insideLoop);
    if (!loop || loop.type !== "LOOP_ON_ITEMS") return flow;
    added.nextAction = loop.firstLoopAction ?? null;
    loop.firstLoopAction = added;
    return next;
  }
  const router = findStep(next, place.inBranch);
  if (!router || router.type !== "ROUTER") return flow;
  const children = router.children ?? [];
  added.nextAction = children[place.branch] ?? null;
  children[place.branch] = added;
  router.children = children;
  return next;
}

export function updateStep(flow: Flow, name: string, change: (step: FlowStep) => void): Flow {
  const next = clone(flow);
  const step = findStep(next, name);
  if (step) change(step);
  return next;
}

/** Takes a step out, joining what was before it to what was after it. What's inside a router or a loop goes with it. The trigger stays: a flow has to start somewhere. */
export function removeStep(flow: Flow, name: string): Flow {
  if (flow.trigger.name === name) return flow;
  const next = clone(flow);
  const unlink = (step: FlowStep | null | undefined): FlowStep | null => {
    if (!step) return null;
    if (step.name === name) return unlink(step.nextAction);
    step.nextAction = unlink(step.nextAction);
    if (step.firstLoopAction !== undefined) step.firstLoopAction = unlink(step.firstLoopAction);
    if (step.children) step.children = step.children.map((child) => unlink(child));
    return step;
  };
  next.trigger = unlink(next.trigger)!;
  return withoutLostNotes(next);
}

/** Notes only for steps that are still there. */
function withoutLostNotes(flow: Flow): Flow {
  if (!flow.stepNotes) return flow;
  const names = new Set(allSteps(flow.trigger).map((step) => step.name));
  const kept = Object.fromEntries(Object.entries(flow.stepNotes).filter(([name]) => names.has(name)));
  return { ...flow, stepNotes: kept };
}

/** A step turned off is passed over when the flow runs, as if it weren't there, and what comes after it still runs. The trigger can't be. */
export function toggleStep(flow: Flow, name: string): Flow {
  if (flow.trigger.name === name) return flow;
  return updateStep(flow, name, (step) => void (step.skip = !step.skip));
}

export function setStepNote(flow: Flow, name: string, note: string): Flow {
  const notes = { ...(flow.stepNotes ?? {}) };
  if (note.trim()) notes[name] = note;
  else delete notes[name];
  return { ...flow, stepNotes: notes };
}

/** A step and everything inside it, without what comes after it: what copying takes. The trigger isn't copied. */
export function copyOfStep(flow: Flow, name: string): FlowStep | null {
  const step = findStep(flow, name);
  if (!step || step.type === "PIECE_TRIGGER" || step.type === "EMPTY") return null;
  const copy = JSON.parse(JSON.stringify(step)) as FlowStep;
  copy.nextAction = null;
  return copy;
}

/** Whether something on the clipboard is a step this can paste. */
export function asCopiedStep(value: unknown): FlowStep | null {
  const step = value as FlowStep | null;
  if (!step || typeof step !== "object" || typeof step.name !== "string" || !["CODE", "PIECE", "ROUTER", "LOOP_ON_ITEMS"].includes(step.type) || typeof step.settings !== "object" || !step.settings) return null;
  return { ...step, nextAction: null };
}

/**
 * Puts a copied step in: after a step, or first in a branch or a loop. It and everything inside it get names no step has, and its expressions follow them,
 * so a copied loop still reads its own item. What it reads from outside itself stays as it was.
 */
export function pasteStep(flow: Flow, place: Place, copied: FlowStep): { flow: Flow; name: string } {
  const taken = new Set(allSteps(flow.trigger).map((step) => step.name));
  const fresh = JSON.parse(JSON.stringify(copied)) as FlowStep;
  fresh.nextAction = null;
  const renames = new Map<string, string>();
  for (const step of allSteps(fresh)) {
    const base = step.name.replace(/_\d+$/, "") || "step";
    let name = step.name;
    for (let index = 1; taken.has(name); index++) name = `${base}_${index}`;
    taken.add(name);
    renames.set(step.name, name);
  }
  const rewrite = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replace(/\{\{\s*([A-Za-z0-9_]+)(?=[.\s}[])/g, (match, ref: string) => (renames.has(ref) ? match.replace(ref, renames.get(ref)!) : match)));
  for (const step of allSteps(fresh)) {
    step.name = renames.get(step.name) ?? step.name;
    step.settings = rewrite(step.settings) as Record<string, unknown>;
  }
  const next = addStep(flow, place, fresh);
  const notes = Object.fromEntries(Object.entries(flow.stepNotes ?? {}).flatMap(([old, note]) => (renames.has(old) ? [[renames.get(old)!, note]] : [])));
  return { flow: Object.keys(notes).length ? { ...next, stepNotes: { ...(next.stepNotes ?? {}), ...notes } } : next, name: fresh.name };
}

export function duplicateStep(flow: Flow, name: string): { flow: Flow; name: string } | null {
  const copy = copyOfStep(flow, name);
  return copy ? pasteStep(flow, { after: name }, copy) : null;
}

/**
 * Puts another step in this one's place, keeping its name, so what refers to it still does, and what comes after it. Only for a step with nothing inside
 * (code or a piece's action), or the trigger, which can only become another trigger.
 */
export function replaceStep(flow: Flow, name: string, replacement: FlowStep): Flow {
  const current = findStep(flow, name);
  if (!current) return flow;
  const isTrigger = current.type === "PIECE_TRIGGER" || current.type === "EMPTY";
  if (isTrigger !== (replacement.type === "PIECE_TRIGGER")) return flow;
  if (!isTrigger && current.type !== "CODE" && current.type !== "PIECE") return flow;
  if (replacement.type === "ROUTER" || replacement.type === "LOOP_ON_ITEMS") return flow;
  return updateStep(flow, name, (step) => {
    const nextAction = step.nextAction ?? null;
    for (const key of Object.keys(step)) delete (step as Record<string, unknown>)[key];
    Object.assign(step, JSON.parse(JSON.stringify(replacement)), { name, nextAction });
  });
}

const branchesOf = (step: FlowStep) => (step.settings.branches ?? []) as Branch[];

/** A new branch, before the one taken when nothing matches. */
export function addBranch(flow: Flow, router: string): Flow {
  return updateStep(flow, router, (step) => {
    if (step.type !== "ROUTER") return;
    const branches = branchesOf(step);
    const fallback = branches.findIndex((branch) => branch.branchType === "FALLBACK");
    const at = fallback === -1 ? branches.length : fallback;
    const names = new Set(branches.map((branch) => branch.branchName));
    let number = branches.length;
    while (names.has(`Branch ${number}`)) number++;
    branches.splice(at, 0, { branchName: `Branch ${number}`, branchType: "CONDITION", conditions: [[newCondition()]] });
    const children = [...(step.children ?? [])];
    while (children.length < branches.length - 1) children.push(null);
    children.splice(at, 0, null);
    step.settings.branches = branches;
    step.children = children;
  });
}

/** Takes a branch out, with its steps. The last branch with a test, and the one taken when nothing matches, stay. */
export function removeBranch(flow: Flow, router: string, index: number): Flow {
  const step = findStep(flow, router);
  if (!step || step.type !== "ROUTER") return flow;
  const branches = branchesOf(step);
  if (branches[index]?.branchType !== "CONDITION" || branches.filter((branch) => branch.branchType === "CONDITION").length < 2) return flow;
  const next = updateStep(flow, router, (target) => {
    (target.settings.branches as Branch[]).splice(index, 1);
    const children = [...(target.children ?? [])];
    children.splice(index, 1);
    target.children = children;
  });
  return withoutLostNotes(next);
}

/** The expressions a step can use: what ran before it. Inside a loop, its item too. */
export function expressionsFor(flow: Flow, name: string): string[] {
  const found: string[] = [];
  const visit = (step: FlowStep | null | undefined, known: string[]): boolean => {
    let so_far = known;
    for (let current = step; current; current = current.nextAction) {
      if (current.name === name) {
        found.push(...so_far);
        return true;
      }
      if (current.firstLoopAction && visit(current.firstLoopAction, [...so_far, `{{${current.name}.output.item}}`, `{{${current.name}.output.index}}`])) return true;
      for (const child of current.children ?? []) if (child && visit(child, so_far)) return true;
      so_far = [...so_far, current.type === "PIECE_TRIGGER" ? `{{${current.name}.output.body}}` : `{{${current.name}.output}}`];
    }
    return false;
  };
  visit(flow.trigger, []);
  return found;
}
