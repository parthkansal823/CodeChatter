import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { roomDocName } from "@codechatter/workspace-model";
import * as Y from "yjs";

/** Documents that sit beside a page's own: its saved versions and its published copy. */
export const historyDocName = (roomId: string, pageId: string) => roomDocName(roomId, "page", `${pageId}-history`);
export const publicDocName = (roomId: string, pageId: string) => roomDocName(roomId, "page", `${pageId}-pub`);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open one room document just long enough to read or change it, on its own
 * socket, then close it. Writes wait until the server has them.
 */
export async function withDoc<T>(name: string, run: (doc: Y.Doc) => T | Promise<T>, options: { write?: boolean } = {}): Promise<T> {
  const { protocol, host } = window.location;
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${protocol === "https:" ? "wss" : "ws"}://${host}/collab` });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: "session" });
  provider.attach();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The room didn't answer. Check your connection and try again.")), 15_000);
      provider.on("synced", () => {
        clearTimeout(timer);
        resolve();
      });
      provider.on("authenticationFailed", () => {
        clearTimeout(timer);
        reject(new Error("You don't have access to this document."));
      });
    });
    const result = await run(doc);
    if (options.write) {
      await wait(150);
      for (let waited = 0; provider.unsyncedChanges > 0 && waited < 8_000; waited += 50) await wait(50);
    }
    return result;
  } finally {
    provider.destroy();
    socket.destroy();
    doc.destroy();
  }
}
