import { publicDocName, withDoc } from "./headless";

/**
 * Publishing a page read-only has two halves.
 *
 * Here, in the room's own documents:
 *   - the page's index entry gets `publishToken` and `publishedAt` (the link
 *     carries the token, and unpublishing clears it);
 *   - a copy of the page is kept in `room:{id}:page:{pageId}-pub`, a Y.Map
 *     "public" of { title, markdown, updatedAt }, refreshed a few seconds after
 *     each edit while the page is published.
 *
 * On the server (not part of the room tool; see the report): an unauthenticated
 * route that checks the token against the index entry and serves that copy.
 */
export type PublishedCopy = { title: string; markdown: string; updatedAt: number };

export const publicUrl = (roomId: string, pageId: string, token: string) => `${window.location.origin}/p/${roomId}/${pageId}/${token}`;

export async function writePublished(roomId: string, pageId: string, copy: PublishedCopy | null): Promise<void> {
  await withDoc(
    publicDocName(roomId, pageId),
    (doc) => {
      const shared = doc.getMap<unknown>("public");
      doc.transact(() => {
        shared.clear();
        if (copy) {
          shared.set("title", copy.title);
          shared.set("markdown", copy.markdown);
          shared.set("updatedAt", copy.updatedAt);
        }
      });
    },
    { write: true },
  );
}
