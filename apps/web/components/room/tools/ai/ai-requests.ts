"use client";

import type { AiMode } from "@codechatter/contracts";
import { useEffect, useRef } from "react";
import { create } from "zustand";

/** The AI tool's id in the room tool registry (for `setRight(AI_TOOL_ID)`). */
export const AI_TOOL_ID = "ai";

export type AiAttach = { file: boolean; selection: boolean; run: boolean; paths: boolean };

export type AiRequest = {
  mode: AiMode;
  prompt: string;
  /** Send right away (default) or only prefill the message box. */
  send?: boolean;
  /** Override the mode's default context chips, e.g. `{ run: true }`. */
  attach?: Partial<AiAttach>;
};

type AiRequestsState = {
  pending: (AiRequest & { id: number }) | null;
  /** Ask the AI from anywhere in the room; the AI panel picks it up when it's open. */
  ask: (request: AiRequest) => void;
  take: () => (AiRequest & { id: number }) | null;
};

let nextId = 1;

/** "Explain" next to a failed run: what went wrong and how to fix it. */
export const explainRunError = (): void =>
  useAiRequests.getState().ask({ mode: "explain-error", prompt: "Explain the error in my last run and how to fix it.", attach: { run: true, file: true } });

/** "Fix" next to a failed run: the AI proposes a change, shown as a side-by-side diff to accept or reject. */
export const fixRunError = (): void =>
  useAiRequests.getState().ask({ mode: "edit", prompt: "Fix the error from my last run. Change only what is needed.", attach: { run: true, file: true, selection: false } });

/**
 * Call once in the room workspace: switches the right panel to the AI tab
 * whenever another panel asks the AI something.
 *
 *   useOpenAiOnRequest(() => setRight(AI_TOOL_ID));
 */
export function useOpenAiOnRequest(open: () => void): void {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(
    () =>
      useAiRequests.subscribe((state, previous) => {
        if (state.pending && state.pending !== previous.pending) latest.current();
      }),
    [],
  );
}

/**
 * Other panels open the AI with a request, e.g. the Run output's
 * "Explain this error":
 *
 *   useAiRequests.getState().ask({ mode: "explain-error", prompt: "Explain this error and how to fix it." });
 *
 * The workspace switches its right panel to the AI tab when `pending` changes.
 */
export const useAiRequests = create<AiRequestsState>()((set, get) => ({
  pending: null,
  ask: (request) => set({ pending: { ...request, id: nextId++ } }),
  take: () => {
    const pending = get().pending;
    if (pending) set({ pending: null });
    return pending;
  },
}));

// TEMP-TEST: lets the browser test call the store; removed after the run.
if (typeof window !== "undefined") (window as unknown as { __aiRequests: unknown }).__aiRequests = useAiRequests;
