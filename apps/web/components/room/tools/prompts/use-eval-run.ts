/** One run of a prompt's evals: promptfoo in the sandbox, sending how far it's got, then its report. */
"use client";

import type { EvalEvent, EvalInput, EvalReport } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

async function refusal(response: Response): Promise<string> {
  if (response.status === 401) return "Your session ended. Sign in again.";
  if (response.status === 413) return "That's too much to send at once.";
  try {
    const problem = (await response.json()) as { detail?: string; errors?: Array<{ message?: string }> };
    return problem.errors?.[0]?.message ?? problem.detail ?? `The evals couldn't start (${response.status}).`;
  } catch {
    return `The evals couldn't start (${response.status}).`;
  }
}

export type EvalOutcome = { report: EvalReport } | { error: string } | { stopped: true };

/** Leaving (closing the tool or the room) stops the run: nobody would see its results. */
export function useEvalRun(roomId: string) {
  const queryClient = useQueryClient();
  const [calls, setCalls] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);

  const start = useCallback(
    async (input: EvalInput): Promise<EvalOutcome | null> => {
      if (controller.current) return null;
      const abort = new AbortController();
      controller.current = abort;
      setCalls(0);
      try {
        const response = await fetch(`/api/rooms/${roomId}/evals`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify(input),
          signal: abort.signal,
        });
        if (!response.ok || !response.body) return { error: await refusal(response) };
        let outcome: EvalOutcome = { error: "The connection dropped before the evals finished. Try again." };
        let buffer = "";
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line) as EvalEvent;
            if (event.type === "progress") setCalls(event.calls);
            else if (event.type === "done") outcome = { report: event.report };
            else outcome = { error: event.message };
          }
        }
        return outcome;
      } catch {
        return abort.signal.aborted ? { stopped: true } : { error: "Couldn't reach the server. Check your connection and try again." };
      } finally {
        controller.current = null;
        setCalls(null);
        void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      }
    },
    [queryClient, roomId],
  );

  return { calls, running: calls !== null, start, stop };
}
