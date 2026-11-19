/**
 * What was copied from a flow, one step or several, for pasting in this one or another in the same tab. It goes to the system clipboard too, as JSON (a
 * step, or a list of them), for another tab or room.
 */
import { asCopiedStep, type FlowStep } from "./model";

let copied: FlowStep[] | null = null;

export function copyStep(step: FlowStep | readonly FlowStep[]): void {
  copied = Array.isArray(step) ? [...step] : [step as FlowStep];
  void navigator.clipboard?.writeText(JSON.stringify(step)).catch(() => {});
}

/** Steps from what the system clipboard has: one, or a list of them; anything else is nothing. */
export function stepsFromClipboard(value: unknown): FlowStep[] {
  const list = Array.isArray(value) ? value : [value];
  const steps = list.map(asCopiedStep);
  return steps.length && steps.every((step): step is FlowStep => step !== null) ? steps : [];
}

/** What was copied here, or else the steps on the system clipboard. Empty when there's nothing to paste. */
export async function stepsToPaste(): Promise<FlowStep[]> {
  if (copied?.length) return copied;
  try {
    return stepsFromClipboard(JSON.parse(await navigator.clipboard.readText()));
  } catch {
    return [];
  }
}
