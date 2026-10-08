"use client";

import { isDynamicVariable, splitVariables } from "@codechatter/contracts";
import { useRef } from "react";

import { cn } from "@/lib/utils";

import { nodeMap, setUrl, yText } from "./model";
import { useStudio } from "./studio-context";
import { useYText } from "./use-y-text";

/**
 * The URL field. {{variables}} are highlighted as you type: orange when the
 * variable has a value, yellow when it doesn't. The text itself is an
 * ordinary input drawn transparent over a mirror that shows the highlights.
 */
export function UrlInput({ requestId, onSubmit, placeholder }: { requestId: string; onSubmit: () => void; placeholder?: string }) {
  const { doc, lookup, canEdit } = useStudio();
  const node = nodeMap(doc, requestId);
  const { value, onChange, ref } = useYText<HTMLInputElement>(node && yText(node, "url"), (next) => setUrl(doc, requestId, next));
  const mirror = useRef<HTMLDivElement>(null);

  const syncScroll = () => {
    if (mirror.current && ref.current) mirror.current.scrollLeft = ref.current.scrollLeft;
  };

  return (
    <div className="relative h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
      <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-2.5 font-mono text-sm whitespace-pre">
        <span className="shrink-0">
          {splitVariables(value).map((part, i) =>
            part.name === undefined ? (
              <span key={i}>{part.text}</span>
            ) : (
              <span
                key={i}
                className={cn("rounded-sm", lookup(part.name) !== undefined || isDynamicVariable(part.name) ? "bg-brand-muted" : "bg-warning/25")}
              >
                {part.text}
              </span>
            ),
          )}
        </span>
      </div>
      <input
        ref={ref}
        value={value}
        readOnly={!canEdit}
        aria-label="Request URL"
        placeholder={placeholder ?? "https://api.example.com/items or {{baseUrl}}/items"}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          syncScroll();
        }}
        onScroll={syncScroll}
        onKeyUp={syncScroll}
        onClick={syncScroll}
        onSelect={syncScroll}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        className="relative h-full w-full bg-transparent px-2.5 font-mono text-sm text-transparent caret-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
