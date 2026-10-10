"use client";

import type { AiCompleteInput, AiCompletion } from "@codechatter/contracts";
import * as monaco from "monaco-editor";
import { create } from "zustand";

import { completionWindow, languageId, windowRange, worthAsking } from "@/components/room/editor/inline-text";
import { useEditorSettings } from "@/components/room/editor/settings-store";

/** A pause in typing this long asks the AI. A key pressed sooner cancels the wait, and any request in flight. */
const DEBOUNCE_MS = 350;
/** After an error, wait this long before asking again, so a missing or broken model isn't asked at every pause. */
const ERROR_PAUSE_S = 30;
const CACHE_SIZE = 30;

type InlineAiState = {
  /** A suggestion is on its way. */
  busy: boolean;
  /** Suggestions are paused (the limit, or an error) until `until`, because of `reason`. */
  pause: { until: number; reason: string } | null;
};

/** What the status bar shows about AI suggestions. */
export const useInlineAi = create<InlineAiState>(() => ({ busy: false, pause: null }));

/** The open room, and whether this person gets suggestions in it (set by useInlineCompletions). */
let gate: { roomId: string; allowed: boolean } | null = null;
export const setInlineCompletionsRoom = (next: typeof gate): void => {
  gate = next;
};

const WORKSPACE = "/workspace/";
/** Room files only (file:///workspace/<path>, see file-models.ts), not other Monaco editors. */
const roomPath = (uri: monaco.Uri) => (uri.scheme === "file" && uri.path.startsWith(WORKSPACE) ? uri.path.slice(WORKSPACE.length) : null);

/** Recent answers by their exact surroundings: coming back to a spot shows its suggestion again without asking. */
const answers = new Map<string, string>();
function remember(key: string, text: string) {
  answers.delete(key);
  answers.set(key, text);
  const oldest = answers.keys().next().value;
  if (answers.size > CACHE_SIZE && oldest !== undefined) answers.delete(oldest);
}

let resume: ReturnType<typeof setTimeout> | undefined;
function pauseFor(seconds: number, reason: string) {
  clearTimeout(resume);
  useInlineAi.setState({ pause: { until: Date.now() + seconds * 1000, reason } });
  resume = setTimeout(() => useInlineAi.setState({ pause: null }), seconds * 1000);
}

/** True once the person has stopped typing for a moment; false if they typed on (Monaco cancels the token). */
const quiet = (token: monaco.CancellationToken) =>
  new Promise<boolean>((resolve) => {
    if (token.isCancellationRequested) return resolve(false);
    const timer = setTimeout(() => {
      cancel.dispose();
      resolve(!token.isCancellationRequested);
    }, DEBOUNCE_MS);
    const cancel = token.onCancellationRequested(() => {
      clearTimeout(timer);
      cancel.dispose();
      resolve(false);
    });
  });

let inFlight = 0;

/** The suggestion from the API, or null when cancelled or refused (refusals pause suggestions for a while). */
async function fetchSuggestion(roomId: string, input: AiCompleteInput, token: monaco.CancellationToken): Promise<string | null> {
  const controller = new AbortController();
  const cancel = token.onCancellationRequested(() => controller.abort());
  useInlineAi.setState({ busy: ++inFlight > 0 });
  try {
    const response = await fetch(`/api/rooms/${roomId}/ai/complete`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (response.ok) return ((await response.json()) as AiCompletion).text;
    const detail = await response.json().then(
      (problem: { detail?: unknown }) => (typeof problem.detail === "string" ? problem.detail : ""),
      () => "",
    );
    if (response.status === 429) pauseFor(Number(response.headers.get("retry-after")) || ERROR_PAUSE_S, detail || "AI suggestions are paused for a moment.");
    else if (response.status !== 400) pauseFor(ERROR_PAUSE_S, detail || "AI suggestions aren't working right now.");
    return null;
  } catch {
    return null; // Cancelled because the person typed on, or offline.
  } finally {
    cancel.dispose();
    useInlineAi.setState({ busy: --inFlight > 0 });
  }
}

const provider: monaco.languages.InlineCompletionsProvider = {
  displayName: "AI suggestions",

  async provideInlineCompletions(model, position, context, token) {
    const none: monaco.languages.InlineCompletions = { items: [] };
    const room = gate;
    const path = roomPath(model.uri);
    // With the suggestion list open, the list decides.
    if (!room?.allowed || !path || !context.includeInlineCompletions || context.selectedSuggestionInfo) return none;
    if (!useEditorSettings.getState().aiCompletions) return none;
    const pause = useInlineAi.getState().pause;
    if (pause && pause.until > Date.now()) return none;

    const offset = model.getOffsetAt(position);
    const range = windowRange(offset);
    const from = model.getPositionAt(range.start);
    const around = model.getValueInRange(monaco.Range.fromPositions(from, model.getPositionAt(range.end)));
    // From where the slice really starts: an offset inside a \r\n lands on the \r.
    const { prefix, suffix } = completionWindow(around, offset - model.getOffsetAt(from));
    if (!worthAsking(prefix, model.getLineContent(position.lineNumber).slice(position.column - 1))) return none;
    const key = `${room.roomId}\n${path}\n${prefix}\u0000${suffix}`;
    let text = answers.get(key);
    if (text === undefined) {
      if (!(await quiet(token))) return none;
      const fetched = await fetchSuggestion(room.roomId, { path, language: languageId(model.getLanguageId()), prefix, suffix }, token);
      if (fetched === null) return none;
      remember(key, fetched);
      text = fetched;
    }
    if (!text || token.isCancellationRequested) return none;
    const cursor = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
    return { items: [{ insertText: text, range: cursor }] };
  },

  disposeInlineCompletions() {
    // Nothing is held per suggestion.
  },
};

let registered = false;

/**
 * Ghost text from the room's AI as you type (Monaco shows it; Tab accepts,
 * Escape dismisses). One provider for every editor and language, registered
 * once by ensureMonaco; it asks only in a room where AI is set up and you may
 * edit, with suggestions on in this browser.
 */
export function registerInlineCompletions(): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerInlineCompletionsProvider("*", provider);
}
