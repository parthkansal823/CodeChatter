/** One press of Run: a prompt sent to each column's model, streaming into its column. */
"use client";

import type { AiPromptInput } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { createSseParser } from "@/components/room/tools/ai/sse";

import type { ColumnResult, PromptColumn, PromptText } from "./model";

const waiting = (column: PromptColumn): ColumnResult => ({ column, text: "", status: "waiting", error: null, firstMs: null, totalMs: null, usage: null });

async function refusal(response: Response): Promise<string> {
  if (response.status === 401) return "Your session ended. Sign in again to use the AI.";
  if (response.status === 413) return "That's too much to send at once.";
  try {
    const problem = (await response.json()) as { detail?: string };
    if (problem.detail) return problem.detail;
  } catch {
    // Not a problem+json body (a proxy error page).
  }
  return `The AI request failed (${response.status}). Try again.`;
}

async function ask(roomId: string, prompt: Pick<PromptText, "system" | "messages">, column: PromptColumn, signal: AbortSignal, onText: (text: string) => void): Promise<ColumnResult> {
  const result = waiting(column);
  let text = "";
  const started = Date.now();
  const body: AiPromptInput = {
    system: prompt.system,
    messages: prompt.messages,
    model: column.model,
    ...(column.temperature !== null && { temperature: column.temperature }),
    ...(column.maxTokens !== null && { maxTokens: column.maxTokens }),
    ...(column.json && { json: true }),
  };
  try {
    const response = await fetch(`/api/rooms/${roomId}/ai/prompt`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) return { ...result, status: "error", error: await refusal(response) };
    let ending: ColumnResult["status"] | null = null;
    let failure: string | null = null;
    const parse = createSseParser((event) => {
      if (event.type === "delta") {
        text += event.text;
        onText(text);
      } else if (event.type === "done") {
        ending = event.stop === "length" ? "cut" : event.stop === "refusal" ? "refused" : "done";
        result.usage = event.usage ?? null;
        result.firstMs = event.timing?.firstMs ?? null;
        result.totalMs = event.timing?.totalMs ?? null;
      } else {
        failure = event.message;
      }
    });
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parse(value);
    }
    if (failure) return { ...result, text, status: "error", error: failure };
    if (!ending) return { ...result, text, status: "error", error: "The connection dropped before the answer finished. Try again." };
    return { ...result, text, status: ending };
  } catch {
    if (signal.aborted) return { ...result, text, status: "stopped", totalMs: Date.now() - started };
    return { ...result, text, status: "error", error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Leaving (closing the tool or the room) stops the run: nobody would read the rest. */
export function usePromptRun(roomId: string) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState<Record<string, ColumnResult> | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);

  const start = useCallback(
    async (prompt: Pick<PromptText, "system" | "messages">, columns: readonly PromptColumn[], oneAtATime: boolean): Promise<ColumnResult[] | null> => {
      if (controller.current) return null;
      const abort = new AbortController();
      controller.current = abort;
      const state = Object.fromEntries(columns.map((column) => [column.id, waiting(column)]));
      let frame = 0;
      const paint = () => {
        frame = 0;
        setLive({ ...state });
      };
      const later = () => {
        frame ||= requestAnimationFrame(paint);
      };
      paint();
      const one = async (column: PromptColumn) => {
        if (abort.signal.aborted) {
          state[column.id] = { ...waiting(column), status: "stopped" };
          return;
        }
        state[column.id] = { ...waiting(column), status: "running" };
        later();
        state[column.id] = await ask(roomId, prompt, column, abort.signal, (text) => {
          state[column.id] = { ...state[column.id]!, text };
          later();
        });
        later();
      };
      if (oneAtATime) for (const column of columns) await one(column);
      else await Promise.all(columns.map(one));
      cancelAnimationFrame(frame);
      controller.current = null;
      setLive(null);
      void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      return columns.map((column) => state[column.id]!);
    },
    [queryClient, roomId],
  );

  return { live, running: live !== null, start, stop };
}
