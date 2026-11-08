/** What was copied from a flow, for pasting in this one or another in the same tab. It goes to the system clipboard too, as JSON, for another tab or room. */
import { asCopiedStep, type FlowStep } from "./model";

let copied: FlowStep | null = null;

export function copyStep(step: FlowStep): void {
  copied = step;
  void navigator.clipboard?.writeText(JSON.stringify(step)).catch(() => {});
}

/** What was copied here, or else a step on the system clipboard. */
export async function stepToPaste(): Promise<FlowStep | null> {
  if (copied) return copied;
  try {
    return asCopiedStep(JSON.parse(await navigator.clipboard.readText()));
  } catch {
    return null;
  }
}
