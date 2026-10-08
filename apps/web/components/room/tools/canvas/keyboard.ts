"use client";

import type { KeyboardEvent } from "react";

import { copySelection } from "./clipboard-io";
import type { ToolId } from "./editor";
import type { CanvasSession } from "./session";
import { hasText } from "./shape";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Canvas shortcuts, attached to the tool's root so they only apply while
 * focus is inside it (Delete in the file tree must never delete shapes).
 * `tools` maps single keys to tools for this canvas's toolbar.
 */
export function handleCanvasKey(event: KeyboardEvent, session: CanvasSession, tools: Record<string, ToolId>): boolean {
  if (isEditable(event.target)) return false;
  // Menus and dialogs render in portals; their keys bubble here through React but aren't ours.
  if (!(event.currentTarget as Node).contains(event.target as Node)) return false;
  const { editor, interaction } = session;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const readOnly = editor.readOnly.get();
  const selection = editor.selection.get();
  const done = () => {
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  // Space and Enter belong to a focused button everywhere but on the canvas itself.
  const onCanvas = event.target instanceof Element && !!event.target.closest("[data-canvas]");
  if (key === " " && onCanvas) {
    editor.spacePan.set(true);
    return done();
  }
  if (key === "escape") {
    if (interaction.busy) interaction.cancel();
    else if (editor.tool.get() !== "select") editor.tool.set("select");
    else editor.select([]);
    return done();
  }

  // Viewing works for everyone.
  if (event.shiftKey && (event.code === "Digit1" || key === "!")) return (editor.zoomToFit(), done());
  if (event.shiftKey && (event.code === "Digit2" || key === "@")) return (editor.zoomToFit(selection.length ? selection : undefined), done());
  if (event.shiftKey && (event.code === "Digit0" || key === ")")) return (editor.zoomBy(1 / editor.camera.get().zoom), done());
  if (mod && (key === "=" || key === "+")) return (editor.zoomBy(1.25), done());
  if (mod && key === "-") return (editor.zoomBy(0.8), done());
  if (mod && key === "0") return (editor.zoomBy(1 / editor.camera.get().zoom), done());
  if (mod && key === "a") return (editor.selectAll(), done());
  if (mod && key === "c") return (void copySelection(editor), done());

  if (!mod && !event.altKey && tools[key]) {
    const tool = tools[key]!;
    if (readOnly && tool !== "select" && tool !== "hand") return false;
    editor.tool.set(tool);
    return done();
  }
  if (readOnly) return false;

  if (mod && key === "z") return (event.shiftKey ? editor.redo() : editor.undo(), done());
  if (mod && key === "y") return (editor.redo(), done());
  if (mod && key === "x") return (void copySelection(editor, true), done());
  if (mod && key === "d") return (editor.duplicate(selection), done());
  if (mod && key === "g" && editor.kind === "design") return (editor.frameSelection(), done());
  if (mod && (key === "]" || event.code === "BracketRight")) return (editor.reorder(selection, event.shiftKey ? "front" : "forward"), done());
  if (mod && (key === "[" || event.code === "BracketLeft")) return (editor.reorder(selection, event.shiftKey ? "back" : "backward"), done());
  if (key === "delete" || key === "backspace") return (editor.deleteShapes(selection), done());
  if (key === "enter" && onCanvas && selection.length === 1) {
    const shape = editor.get(selection[0]!);
    if (shape && hasText(shape.type)) return (editor.startEditing(shape.id), done());
  }
  const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[key] && onCanvas && selection.length) {
    const step = event.shiftKey ? 10 : 1;
    const [dx, dy] = arrows[key]!;
    editor.nudge(selection, dx * step, dy * step);
    return done();
  }
  return false;
}

export function handleCanvasKeyUp(event: KeyboardEvent, session: CanvasSession) {
  if (event.key === " ") session.editor.spacePan.set(false);
}
