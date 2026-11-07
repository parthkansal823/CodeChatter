export * from "./model.js";
export * from "./templates.js";
export * from "./languages.js";
export * from "./notebook.js";
export * from "./breakpoints.js";
export * from "./comments.js";
export * from "./tasks.js";

/**
 * Document names, so the collab server and every client agree. One Yjs
 * document per thing that is edited live; the collab server checks room
 * access the same way for all of them.
 *
 *   room:ROOMID:files            the file tree and file contents (seeded from the template)
 *   room:ROOMID:pages            the room's page tree (docs and notes)
 *   room:ROOMID:api              API studio collections, requests and environments
 *   room:ROOMID:prompts          the Prompt Playground's prompts and their runs
 *   room:ROOMID:designs          the room's list of design canvases
 *   room:ROOMID:boards           the room's list of whiteboards
 *   room:ROOMID:comments         comment threads on the code (anyone who can chat may write it)
 *   room:ROOMID:notes            the room's shared notes and focus timer (anyone who can chat may write it)
 *   room:ROOMID:tasks            the room's task board (file editors may write it)
 *   room:ROOMID:page:<id>        one doc or note page
 *   room:ROOMID:design:<id>      one design canvas
 *   room:ROOMID:board:<id>       one whiteboard
 *   room:ROOMID:mine:<userId>    one person's private notes in the room (only they may open it)
 */
export type RoomDocKind = "files" | "pages" | "api" | "prompts" | "designs" | "boards" | "diagrams" | "comments" | "notes" | "tasks" | "page" | "design" | "board" | "diagram" | "mine";
export type ParsedDocName = { roomId: string; kind: RoomDocKind; id?: string };

const SINGLE = /^room:([A-Z0-9]{6}):(files|pages|api|prompts|designs|boards|diagrams|comments|notes|tasks)$/;
const PER_ITEM = /^room:([A-Z0-9]{6}):(page|design|board|diagram|mine):([A-Za-z0-9_-]{8,64})$/;

export const filesDocName = (roomId: string) => `room:${roomId}:files`;

export function roomDocName(roomId: string, kind: "files" | "pages" | "api" | "prompts" | "designs" | "boards" | "diagrams" | "comments" | "notes" | "tasks"): string;
export function roomDocName(roomId: string, kind: "page" | "design" | "board" | "diagram" | "mine", id: string): string;
export function roomDocName(roomId: string, kind: RoomDocKind, id?: string): string {
  return id ? `room:${roomId}:${kind}:${id}` : `room:${roomId}:${kind}`;
}

export function parseDocName(name: string): ParsedDocName | null {
  const single = SINGLE.exec(name);
  if (single) return { roomId: single[1]!, kind: single[2] as RoomDocKind };
  const item = PER_ITEM.exec(name);
  if (item) return { roomId: item[1]!, kind: item[2] as RoomDocKind, id: item[3]! };
  return null;
}
