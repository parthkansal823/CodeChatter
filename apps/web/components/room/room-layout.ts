/** A room's layout, each person's own choice: Code, or Research, which puts a paper, its PDF, references, notebooks and data in front. Nothing is taken away: the command palette still has every tool. */
"use client";

import { useCallback, useState } from "react";

export type RoomLayout = "code" | "research";

/** The apps Research shows in the activity bar, in this order, and only those a person may use. */
export const RESEARCH_APPS = ["docs", "databases", "flow", "lakehouse", "diagrams", "board"];

const keyOf = (roomId: string) => `cc:layout:${roomId}`;

/** A room made for research starts in Research, until someone chooses otherwise. An interview always stays in Code. */
export function useRoomLayout(room: { id: string; kind: string; templateId: string | null }): [RoomLayout, (next: RoomLayout) => void] {
  const fallback: RoomLayout = room.templateId === "research" ? "research" : "code";
  const [layout, setLayout] = useState<RoomLayout>(() => {
    if (room.kind === "interview") return "code";
    try {
      const saved = localStorage.getItem(keyOf(room.id));
      return saved === "research" || saved === "code" ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = useCallback(
    (next: RoomLayout) => {
      setLayout(next);
      try {
        localStorage.setItem(keyOf(room.id), next);
      } catch {
        // Storage can be off (private windows); the layout still works for this visit.
      }
    },
    [room.id],
  );
  return [layout, choose];
}

/** The apps to show, from those a person has. */
export function appsFor<T extends { id: string }>(layout: RoomLayout, tools: readonly T[]): T[] {
  if (layout === "code") return [...tools];
  return RESEARCH_APPS.flatMap((id) => tools.filter((tool) => tool.id === id));
}
