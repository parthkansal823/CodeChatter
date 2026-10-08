"use client";

import type { AiChatInput, AiMode, AiTokenCount } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { clearHistory, loadHistory, saveHistory, turnsToSend, type ChatEntry, type EditTarget } from "./history";
import type { PastedImage } from "./image";
import { createSseParser } from "./sse";

export type SendOptions = {
  text: string;
  mode: AiMode;
  context: AiChatInput["context"];
  /** Short labels of what's attached, shown on the message. */
  labels: string[];
  image: PastedImage | null;
  /** Edit mode: where the answer applies. */
  target?: EditTarget;
};

class ChatError extends Error {}

async function problemDetail(response: Response): Promise<string> {
  if (response.status === 413) return "That's too much to send at once. Turn off some context or use a smaller image.";
  if (response.status === 401) return "Your session ended. Sign in again to use the AI.";
  try {
    const problem = (await response.json()) as { detail?: string };
    if (problem.detail) return problem.detail;
  } catch {
    // Not a problem+json body (a proxy error page).
  }
  return `The AI request failed (${response.status}). Try again.`;
}

/**
 * One conversation with the room's AI, kept per room in sessionStorage.
 * Answers stream in over SSE; text is flushed to state once per frame so a
 * fast model doesn't re-render the panel hundreds of times a second.
 */
export function useAiChat(roomId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => loadHistory(roomId) ?? { mode: "assistant" as AiMode, entries: [] as ChatEntry[] });
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // Saved when an answer settles, not on every streamed word.
  useEffect(() => {
    if (!busy) saveHistory(roomId, state);
  }, [busy, roomId, state]);

  // Leaving the room stops the answer nobody will read.
  useEffect(() => () => controller.current?.abort(), []);

  const setMode = useCallback((mode: AiMode) => setState((s) => ({ ...s, mode })), []);

  const clear = useCallback(() => {
    controller.current?.abort();
    clearHistory(roomId);
    setState((s) => ({ mode: s.mode, entries: [] }));
  }, [roomId]);

  /** Change one entry, from a button on it or from a step finishing. */
  const patchEntry = useCallback((id: string, patch: Partial<ChatEntry> | ((entry: ChatEntry) => Partial<ChatEntry>)) => {
    setState((s) => ({
      ...s,
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...(typeof patch === "function" ? patch(e) : patch) } : e)),
    }));
  }, []);

  /** Drop an entry and everything after it (for Retry). */
  const truncateFrom = useCallback((id: string) => {
    setState((s) => {
      const index = s.entries.findIndex((e) => e.id === id);
      return index === -1 ? s : { ...s, entries: s.entries.slice(0, index) };
    });
  }, []);

  const stop = useCallback(() => controller.current?.abort(), []);

  const send = useCallback(
    async (options: SendOptions, history: ChatEntry[]) => {
      if (controller.current) return;
      const question: ChatEntry = {
        id: randomId(),
        role: "user",
        content: options.text,
        mode: options.mode,
        ...(options.labels.length && { context: options.labels }),
        ...(options.image && { image: true }),
      };
      const answer: ChatEntry = {
        id: randomId(),
        role: "assistant",
        content: "",
        mode: options.mode,
        status: "streaming",
        ...(options.target && { target: options.target }),
      };
      setState((s) => ({ ...s, entries: [...s.entries, question, answer] }));

      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      let text = "";
      let frame = 0;
      // Filled in by the stream's events.
      const outcome: { ending: ChatEntry["status"] | null; failure: string | null; usage?: AiTokenCount } = { ending: null, failure: null };
      const update = (patch: Partial<ChatEntry>) =>
        setState((s) => ({ ...s, entries: s.entries.map((e) => (e.id === answer.id ? { ...e, ...patch } : e)) }));
      const flush = () => {
        frame = 0;
        update({ content: text });
      };

      try {
        const body: AiChatInput = {
          mode: options.mode,
          messages: turnsToSend([...history, question]),
          context: { ...options.context, ...(options.image && { image: { mediaType: options.image.mediaType, data: options.image.data } }) },
        };
        const response = await fetch(`/api/rooms/${roomId}/ai/chat`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          // AI may have been switched off since the panel checked.
          if (response.status === 503) void queryClient.invalidateQueries({ queryKey: ["ai-status"] });
          throw new ChatError(await problemDetail(response));
        }
        const parse = createSseParser((event) => {
          if (event.type === "delta") {
            text += event.text;
            frame ||= requestAnimationFrame(flush);
          } else if (event.type === "done") {
            outcome.ending = event.stop === "length" ? "cut" : event.stop === "refusal" ? "refused" : "done";
            outcome.usage = event.usage;
          } else {
            outcome.failure = event.message;
          }
        });
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parse(value);
        }
        cancelAnimationFrame(frame);
        if (outcome.failure) update({ content: text, status: "error", error: outcome.failure });
        else if (outcome.ending) update({ content: text, status: outcome.ending, ...(outcome.usage && { usage: outcome.usage }) });
        else update({ content: text, status: "error", error: "The connection dropped before the answer finished. Try again." });
      } catch (error) {
        cancelAnimationFrame(frame);
        if (abort.signal.aborted) update({ content: text, status: "stopped" });
        else {
          const message = error instanceof ChatError ? error.message : "Couldn't reach the server. Check your connection and try again.";
          update({ content: text, status: "error", error: message });
        }
      } finally {
        controller.current = null;
        setBusy(false);
        // Every request, even a refused or stopped one, moves the counters.
        void queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      }
    },
    [queryClient, roomId],
  );

  return { mode: state.mode, entries: state.entries, busy, setMode, send, stop, clear, truncateFrom, patchEntry };
}
