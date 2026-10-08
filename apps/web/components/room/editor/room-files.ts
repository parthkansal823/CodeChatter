"use client";

import { flatten, type TreeNode } from "@codechatter/workspace-model";
import { useMemo } from "react";

import { useFileTree } from "@/components/room/hooks";

/** The room's files (no folders), in tree order. */
export function useRoomFiles(): TreeNode[] {
  const tree = useFileTree();
  return useMemo(() => flatten(tree).filter((node) => node.kind === "file"), [tree]);
}

/** Everything before the last slash, or "" for a file at the top level. */
export const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
