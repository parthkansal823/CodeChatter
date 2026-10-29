"use client";

import { LanguageClientWrapper, LcWebSocket } from "monaco-languageclient/lcwrapper";

import { ensureMonaco } from "@/components/room/monaco-setup";

/** Languages with a language server in the room's sandbox (apps/runner/src/lsp.ts). */
export const LSP_LANGUAGES = ["python", "c", "cpp", "go", "rust", "java"] as const;
export type LspLanguage = (typeof LSP_LANGUAGES)[number];

type Running = { roomId: string; wrapper: LanguageClientWrapper; starting: Promise<void> };
const clients = new Map<LspLanguage, Running>();

/**
 * IntelliSense from a language server in the room's sandbox: completions, hover, go to
 * definition and references, rename, and the server's problems marked in the code. One
 * client per language while the room is open, over /ws/lsp (the API checks edit rights,
 * the runner starts the server). It reads the room's files from the sandbox, so
 * imports between files resolve; open files go to it as they are typed.
 */
export function startLanguageClient(roomId: string, language: LspLanguage): Promise<void> {
  const running = clients.get(language);
  if (running?.roomId === roomId) return running.starting;
  if (running) void stopLanguageClient(language);
  const url = new URL("/ws/lsp", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("room", roomId);
  url.searchParams.set("language", language);
  const wrapper = new LanguageClientWrapper({
    languageId: language,
    connection: {
      options: { $family: "WebSocket", webSocketUrl: url.toString(), realization: () => new LcWebSocket() },
      // The first start in a sandbox can take a while (the sandbox itself may be starting).
      retryConfig: { retries: 3, timeout: 60_000 },
    },
    clientOptions: {
      // The room's files only (file:///workspace/...), not notebook cells or diff views.
      documentSelector: [{ language, scheme: "file", pattern: "/workspace/**" }],
      // The server's own log lines (it starts, it found Python) stay out of the way.
      outputChannelName: `CodeChatter ${language} language server`,
    },
  });
  const starting = ensureMonaco()
    .then(() => wrapper.start())
    .catch((error: unknown) => {
      clients.delete(language);
      console.warn(`The ${language} language server didn't start:`, error);
    });
  clients.set(language, { roomId, wrapper, starting });
  return starting;
}

export async function stopLanguageClient(language: LspLanguage): Promise<void> {
  const running = clients.get(language);
  if (!running) return;
  clients.delete(language);
  await running.starting;
  await running.wrapper.dispose().catch(() => {});
}

export async function stopLanguageClients(): Promise<void> {
  await Promise.all(LSP_LANGUAGES.map(stopLanguageClient));
}
