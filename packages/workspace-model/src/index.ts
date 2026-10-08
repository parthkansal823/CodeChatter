export * from "./model.js";
export * from "./templates.js";
export * from "./languages.js";

/**
 * Document names, so the collab server and every client agree. One Yjs
 * document per thing that is edited live; the collab server checks room
 * access the same way for all of them.
 *
 *   room:ROOMID:files            the file tree and file contents (seeded from the template)
 *   room:ROOMID:pages            the room's page tree (docs and notes)
 *   room:ROOMID:api              API studio collections, requests and environments
 *   room:ROOMID:designs          the room's list of design canvases
 *   room:ROOMID:boards           the room's list of whiteboards
 *   room:ROOMID:page:<id>        one doc or note page
 *   room:ROOMID:design:<id>      one design canvas
 *   room:ROOMID:board:<id>       one whiteboard
 */
export type RoomDocKind = "files" | "pages" | "api" | "designs" | "boards" | "page" | "design" | "board";
export type ParsedDocName = { roomId: string; kind: RoomDocKind; id?: string };

const SINGLE = /^room:([A-Z0-9]{6}):(files|pages|api|designs|boards)$/;
const PER_ITEM = /^room:([A-Z0-9]{6}):(page|design|board):([a-z0-9-]{8,64})$/;

export const filesDocName = (roomId: string) => `room:${roomId}:files`;

export function roomDocName(roomId: string, kind: "files" | "pages" | "api" | "designs" | "boards"): string;
export function roomDocName(roomId: string, kind: "page" | "design" | "board", id: string): string;
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
