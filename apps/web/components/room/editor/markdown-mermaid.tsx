/** Draw a Markdown fence near the viewport, with isolated block state and readable source when its drawing fails. */
"use client";

import { Copy, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

import { useMermaidDrawing } from "./use-mermaid-drawing";

export function MarkdownMermaid({ text, index, compact = false }: { text: string; index: number; compact?: boolean }) {
  const element = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const { drawing, problem, empty } = useMermaidDrawing(text, near);
  const label = `Mermaid diagram ${index}`;

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let active = true;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => { if (active) setNear(true); });
      return () => { active = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (active) setNear(entries.some((entry) => entry.isIntersecting));
    }, { rootMargin: "200px" });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
  }, []);

  async function copy() {
    try {
      if (await copyText(text)) toast.success("Code copied");
      else toast.error("Couldn't copy the code. Try selecting it.");
    } catch {
      toast.error("Couldn't copy the code. Try selecting it.");
    }
  }

  function download() {
    if (!drawing) return;
    const url = URL.createObjectURL(new Blob([drawing.svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `markdown-diagram-${index}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section ref={element} aria-label={label} className="my-3 min-w-0 max-w-full rounded-md border bg-chrome text-xs">
      {!compact && (
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1 text-muted-foreground">
          <span className="mr-auto">{label}</span>
          <Button size="xs" variant="ghost" onClick={() => void copy()}><Copy /> Copy code</Button>
          <Button size="xs" variant="ghost" disabled={!drawing} onClick={download}><Download /> Download SVG</Button>
        </div>
      )}
      {problem && (
        <p role="alert" className="border-b px-3 py-2">
          {problem.line ? `Line ${problem.line}: ` : ""}{problem.message}
        </p>
      )}
      {drawing && !empty && (
        <div role="region" aria-label={`Drawing for ${label}`} tabIndex={0} className="max-h-96 max-w-full overflow-auto p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- shared strict Mermaid renderer; SVG stays isolated as an image */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.svg)}`}
            alt={`Diagram preview of Markdown diagram ${index}`}
            className={problem ? "block max-w-none opacity-40" : "block max-w-none"}
          />
        </div>
      )}
      {(problem || empty) && (
        <pre aria-label={`Code for ${label}`} className="max-h-96 max-w-full overflow-auto px-3 py-2 font-mono leading-relaxed">
          <code>{text.split("\n").map((line, row) => (
            <span key={row} className={problem?.line === row + 1 ? "block bg-accent text-accent-foreground" : "block"}>
              <span aria-hidden="true" className="mr-3 inline-block min-w-5 select-none text-right text-muted-foreground">{row + 1}</span>{line || " "}{"\n"}
            </span>
          ))}</code>
        </pre>
      )}
      {empty ? (
        <p className="px-3 py-2 text-muted-foreground">Write a Mermaid diagram in this block.</p>
      ) : !drawing && !problem ? (
        <p role="status" className="px-3 py-4 text-muted-foreground">{near ? "Drawing the diagram…" : "Diagram will draw when it is near the screen."}</p>
      ) : null}
    </section>
  );
}
