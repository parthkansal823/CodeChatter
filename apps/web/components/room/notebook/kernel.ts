"use client";

import { cellId, cellsOf, cellType, notebookOf } from "@codechatter/workspace-model";
import { toast } from "sonner";
import * as Y from "yjs";

import { api, ApiError } from "@/lib/api";

export type KernelAction = "interrupt" | "restart" | "shutdown";

/** Your edits so far, so the kernel runs the cells as you see them (as Run does). */
function stateVector(doc: Y.Doc): string {
  const vector = Y.encodeStateVector(doc);
  let binary = "";
  for (const byte of vector) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Run cells in the notebook's kernel; their outputs arrive in the room's files document for everyone. */
export async function runCells(roomId: string, doc: Y.Doc, fileId: string, cellIds: string[]): Promise<void> {
  if (!cellIds.length) return;
  try {
    await api(`/api/rooms/${roomId}/notebooks/${fileId}/run`, { method: "POST", json: { cellIds, stateVector: stateVector(doc) } });
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : "The notebook's kernel couldn't run that.");
  }
}

/** Every code cell, top to bottom (the title bar's Run on a notebook). */
export function runAll(roomId: string, doc: Y.Doc, fileId: string): Promise<void> {
  const nb = notebookOf(doc, fileId);
  const ids = nb ? cellsOf(nb).toArray().filter((cell) => cellType(cell) === "code").map(cellId) : [];
  return runCells(roomId, doc, fileId, ids);
}

export async function controlKernel(roomId: string, fileId: string, action: KernelAction): Promise<void> {
  try {
    await api(`/api/rooms/${roomId}/notebooks/${fileId}/${action}`, { method: "POST", json: {} });
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : "The kernel didn't answer.");
  }
}
