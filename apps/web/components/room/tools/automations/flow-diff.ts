/**
 * What changed in a flow between two versions, as n8n's workflow history compares them, for Versions (versions.tsx): each step added, removed or
 * changed (its settings, its kind, the name shown, turned off or on, or where it is: what it comes after, or the step and branch it's in), and the
 * flow's own fields (its name, what it's for, settings, error flow, tags, pinned data and notes). Steps are matched by name, which a step keeps.
 */
import { allSteps, parseFlow, type Flow, type FlowStep } from "./model";

export type StepChange = { change: "added" | "removed" | "changed"; name: string; title: string; what: string[] };
export type FlowChanges = { steps: StepChange[]; flow: string[] };

/** JSON with keys in order, so the same value written in another order is the same. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, each]) => each !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, each]) => `${JSON.stringify(key)}:${stable(each)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Where each step is: first in the flow, after a step, or first inside a step's loop or one of its branches. */
function placesOf(flow: Flow): Map<string, string> {
  const places = new Map<string, string>();
  const seen = new Set<FlowStep>();
  const walk = (start: FlowStep | null | undefined, first: string) => {
    let where = first;
    for (let step = start; step && !seen.has(step); step = step.nextAction) {
      seen.add(step);
      places.set(step.name, where);
      if (step.firstLoopAction) walk(step.firstLoopAction, `in ${step.name}`);
      (step.children ?? []).forEach((child, at) => walk(child, `${step.name}, branch ${at + 1}`));
      where = `after ${step.name}`;
    }
  };
  walk(flow.trigger, "first");
  return places;
}

const titleOf = (step: FlowStep) => (step.type === "PIECE_TRIGGER" || step.type === "EMPTY" ? `The trigger, ${step.displayName || step.name}` : step.displayName || step.name);
const behaviour = (step: FlowStep) => stable({ settings: step.settings, builtin: step.builtin ?? null });

/** What changed from `before` to `after`: steps in the order they are now, then those removed. */
export function flowChanges(before: Flow, after: Flow): FlowChanges {
  const was = new Map(allSteps(before.trigger).map((step) => [step.name, step]));
  const now = new Map(allSteps(after.trigger).map((step) => [step.name, step]));
  const wasAt = placesOf(before);
  const nowAt = placesOf(after);
  const steps: StepChange[] = [];
  for (const [name, step] of now) {
    const old = was.get(name);
    if (!old) {
      steps.push({ change: "added", name, title: titleOf(step), what: [] });
      continue;
    }
    const what: string[] = [];
    if (old.type !== step.type) what.push("its kind");
    else if (behaviour(old) !== behaviour(step)) what.push("its settings");
    if (old.displayName !== step.displayName) what.push(`its name, from ${old.displayName || old.name}`);
    if (Boolean(old.skip) !== Boolean(step.skip)) what.push(step.skip ? "turned off" : "turned on");
    if (wasAt.get(name) !== nowAt.get(name)) what.push("where it is");
    if (what.length) steps.push({ change: "changed", name, title: titleOf(step), what });
  }
  for (const [name, step] of was) if (!now.has(name)) steps.push({ change: "removed", name, title: titleOf(step), what: [] });

  const flow: string[] = [];
  const differs = (a: unknown, b: unknown) => stable(a) !== stable(b);
  if (before.displayName !== after.displayName) flow.push(`its name, from ${before.displayName}`);
  if (differs(before.description ?? "", after.description ?? "")) flow.push("what it's for");
  if (differs(before.settings ?? {}, after.settings ?? {})) flow.push("its settings");
  if (differs(before.errorFlow ?? null, after.errorFlow ?? null)) flow.push("its error flow");
  if (differs(before.tags ?? [], after.tags ?? [])) flow.push("its tags");
  if (differs(before.pinned ?? {}, after.pinned ?? {})) flow.push("pinned data");
  if (differs(before.stepNotes ?? {}, after.stepNotes ?? {})) flow.push("notes on steps");
  if (differs(before.stickies ?? [], after.stickies ?? [])) flow.push("notes on the chart");
  return { steps, flow };
}

/** The flow in a checkpoint's files (by path): at the path it has now, or, moved since, the flow file with its id. */
export function flowIn(files: ReadonlyMap<string, string>, path: string, id: string | undefined): { path: string; flow: Flow; text: string } | null {
  const read = (at: string, text: string) => {
    const parsed = parseFlow(text);
    return "flow" in parsed ? { path: at, flow: parsed.flow, text } : null;
  };
  const here = files.get(path);
  if (here !== undefined) return read(path, here);
  if (!id) return null;
  for (const [at, text] of files) {
    if (!/\.flow\.json$/i.test(at) || !text.includes(id)) continue;
    const found = read(at, text);
    if (found?.flow.id === id) return found;
  }
  return null;
}

/** The changes in words, for a screen reader's summary and the list's heading: "2 steps added, 1 changed". */
export function changesInWords(changes: FlowChanges): string {
  const count = (change: StepChange["change"]) => changes.steps.filter((step) => step.change === change).length;
  const parts = (["added", "changed", "removed"] as const).flatMap((change) => {
    const n = count(change);
    return n ? [`${n} ${n === 1 ? "step" : "steps"} ${change}`] : [];
  });
  if (changes.flow.length) parts.push(`the flow's ${changes.flow.length === 1 ? changes.flow[0]!.replace(/^its /, "") : "own fields"}`);
  return parts.length ? parts.join(", ") : "The same as now";
}
