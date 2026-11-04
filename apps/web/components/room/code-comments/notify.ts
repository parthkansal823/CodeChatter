"use client";

import { mentionedIn, type CommentNotifyInput } from "@codechatter/contracts";
import type { CommentThread } from "@codechatter/workspace-model";
import { useQuery } from "@tanstack/react-query";

import { useRoom } from "@/components/room/room-context";
import { api } from "@/lib/api";

export type RoomMember = { id: string; name: string; image: string | null; role: string };

/** Everyone in the room, for @mentions in comments. */
export function useRoomMembers(): RoomMember[] {
  const { room } = useRoom();
  return (
    useQuery({
      queryKey: ["room-members", room.id],
      queryFn: () => api<{ members: RoomMember[] }>(`/api/rooms/${room.id}/members`).then((r) => r.members),
      staleTime: 5 * 60_000,
    }).data ?? []
  );
}

/**
 * Tell people about a comment (the API sends the notifications): a reply goes to everyone
 * in the thread, and anyone a comment mentions by name ("@Ana") hears of it too. Never in
 * the way: a failure is only missed notifications.
 */
export function notifyComment(
  roomId: string,
  input: { kind: CommentNotifyInput["kind"]; thread: Pick<CommentThread, "id" | "by" | "messages"> | null; threadId: string; text: string; path: string; line: number },
  members: RoomMember[],
  myId: string,
): void {
  const recipients = new Set<string>(mentionedIn(input.text, members).map((member) => member.id));
  if (input.kind === "reply" && input.thread) {
    recipients.add(input.thread.by.id);
    for (const message of input.thread.messages) recipients.add(message.by.id);
  }
  recipients.delete(myId);
  recipients.delete("");
  if (!recipients.size) return;
  const body: CommentNotifyInput = {
    kind: input.kind,
    threadId: input.threadId,
    recipients: [...recipients].slice(0, 20),
    path: input.path,
    line: input.line,
    excerpt: input.text.trim().slice(0, 280),
  };
  void api(`/api/rooms/${roomId}/notifications/comment`, { method: "POST", json: body }).catch(() => {});
}
