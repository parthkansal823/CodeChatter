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
export type Flow = { /** Stays with the flow when its file moves, so its runs do too. */ id?: string; displayName: string; schemaVersion: string; trigger: FlowStep };

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
export type ChartItem = { id: string; label: string; detail: string; shape: "box"; glyph: Glyph; status: ChartStatus; description: string };
const GLYPHS: Record<FlowStep["type"], Glyph> = { PIECE_TRIGGER: "trigger", EMPTY: "trigger", CODE: "code", PIECE: "piece", ROUTER: "router", LOOP_ON_ITEMS: "loop" };
const STATUS_WORDS: Record<ChartStatus, string> = { idle: "didn't run", running: "running now", ok: "ran fine", warning: "has a warning", failed: "failed", skipped: "stopped" };

/** The chart: boxes and arrows, with branches going their own ways and coming back together at the step after the router. */
export function chartOfFlow(flow: Flow, steps: Record<string, AutomationStepResult> | undefined, pieces?: Record<string, PieceInfo>): { items: ChartItem[]; edges: Array<{ from: string; to: string }> } {
  const results = resultsOf(steps);
  const ran = Object.keys(steps ?? {}).length > 0;
  const items: ChartItem[] = [];
  const edges: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();

  /** Draws a chain, and returns the steps a next one follows from. */
  const chain = (start: FlowStep | null | undefined, from: string[]): string[] => {
    let ends = from;
    for (let step = start; step; step = step.nextAction) {
      if (seen.has(step.name)) break;
      seen.add(step.name);
      for (const end of ends) edges.push({ from: end, to: step.name });
      const result = results.get(step.name);
      const status = result?.status ?? "idle";
      const kind = kindOf(step, pieces);
      const times = result && result.times > 1 ? ` · ${result.times} times` : "";
      items.push({ id: step.name, label: step.displayName || step.name, detail: `${kind}${times}`, shape: "box", glyph: GLYPHS[step.type] ?? "piece", status, description: [`Step ${step.displayName || step.name}`, kind, ...(ran ? [STATUS_WORDS[status]] : []), ...(result && result.times > 1 ? [`${result.times} times`] : [])].join(", ") });
      if (step.type === "ROUTER") {
        const branchEnds: string[] = [];
        const children = step.children ?? [];
        let emptyBranch = children.length === 0;
        for (const child of children) {
          if (child) branchEnds.push(...chain(child, [step.name]));
          else emptyBranch = true;
        }
        ends = emptyBranch ? [step.name, ...branchEnds] : branchEnds;
      } else {
        if (step.type === "LOOP_ON_ITEMS" && step.firstLoopAction) chain(step.firstLoopAction, [step.name]);
        ends = [step.name];
      }
    }
    return ends;
  };
  chain(flow.trigger, []);
  return { items, edges };
}

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
  return { name, type: "ROUTER", displayName: "Router", valid: true, skip: false, settings: { executionType: "EXECUTE_FIRST_MATCH", branches: [{ branchName: "Branch 1", branchType: "CONDITION", conditions: [[{ operator: "TEXT_CONTAINS", firstValue: "", secondValue: "", caseSensitive: false }]] }, { branchName: "Otherwise", branchType: "FALLBACK" }] }, children: [null, null], nextAction: null };
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
  return next;
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
