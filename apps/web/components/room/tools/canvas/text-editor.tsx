"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { fontOf, STICKY_TEXT, textFrame } from "./draw";
import type { Camera, Editor } from "./editor";
import { useAtom, useEditor, useShape } from "./hooks";
import type { Shape } from "./shape";
import { lineHeight } from "./text-layout";

/**
 * Editing a text box or sticky note: a textarea laid exactly over the shape,
 * scaled with the camera, writing every keystroke to the shared document so
 * others watch the text appear.
 */
export function TextEditor() {
  const editor = useEditor();
  const id = useAtom(editor.editingId);
  const shape = useShape(editor, id);
  const cam = useAtom(editor.camera);
  if (!id || !shape) return null;
  return <EditingArea key={id} editor={editor} shape={shape} cam={cam} />;
}

function EditingArea({ editor, shape, cam }: { editor: Editor; shape: Shape; cam: Camera }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
    // When the box goes away, focus would fall to the page and shortcuts (V, R, Ctrl+Z) would stop
    // working; hand it back to the canvas unless the user clicked into something else.
    const canvas = area.closest<HTMLElement>("[data-canvas]");
    return () => {
      queueMicrotask(() => {
        if (document.activeElement === document.body || document.activeElement === null) canvas?.focus({ preventScroll: true });
      });
    };
  }, []);

  const font = fontOf(shape);
  const frame = textFrame(shape);
  const lh = lineHeight(font.size);
  const width = frame.width ?? Math.max(shape.w + font.size, 40);
  const height = shape.type === "sticky" ? shape.h - (frame.y - shape.y) * 2 : Math.max(shape.h, lh) + lh;
  return (
    <textarea
      ref={ref}
      aria-label={shape.type === "sticky" ? "Sticky note text" : "Text"}
      value={shape.text}
      spellCheck={false}
      onChange={(e) => editor.setText(shape.id, e.target.value)}
      onBlur={() => editor.stopEditing()}
      onKeyDown={(e) => {
        // Typing stays in the box: canvas shortcuts (Delete, V, arrows) must not fire.
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          editor.stopEditing();
        }
      }}
      onPaste={(e) => e.stopPropagation()}
      onCopy={(e) => e.stopPropagation()}
      onCut={(e) => e.stopPropagation()}
      className={cn(
        "absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-none",
        font.family === "note" ? "font-note" : "font-sans",
        frame.width === null ? "whitespace-pre" : "whitespace-pre-wrap break-words",
      )}
      style={{
        left: frame.x * cam.zoom + cam.x,
        top: frame.y * cam.zoom + cam.y,
        width,
        height,
        transform: `scale(${cam.zoom})`,
        transformOrigin: "0 0",
        fontSize: font.size,
        fontWeight: font.weight,
        lineHeight: `${lh}px`,
        textAlign: shape.textAlign,
        color: shape.type === "sticky" ? STICKY_TEXT : shape.fill === "none" ? "var(--foreground)" : shape.fill,
        caretColor: "var(--brand)",
      }}
    />
  );
}
