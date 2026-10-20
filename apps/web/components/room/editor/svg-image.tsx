"use client";

import { useDeferredValue, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * An SVG file drawn as an image, live as anyone edits it. As an <img> it runs no
 * scripts and loads nothing, whatever the file contains. Fit to the pane or actual size,
 * on a checkerboard so transparent parts show.
 */
export function SvgImage({ text, name }: { text: string; name: string }) {
  const deferred = useDeferredValue(text);
  const [fit, setFit] = useState(true);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(deferred)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <div role="group" aria-label="Zoom" className="flex">
          <Button size="xs" variant={fit ? "secondary" : "ghost"} aria-pressed={fit} onClick={() => setFit(true)}>
            Fit
          </Button>
          <Button size="xs" variant={!fit ? "secondary" : "ghost"} aria-pressed={!fit} onClick={() => setFit(false)}>
            Actual size
          </Button>
        </div>
        <span role="status" className="ml-auto tabular-nums">
          {broken ? "Not a picture the browser can draw" : size ? `${size.width} × ${size.height}` : ""}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-size-[16px_16px] p-4">
        {broken ? (
          <p className="text-xs text-muted-foreground">
            {name} isn&apos;t a valid SVG yet: the browser couldn&apos;t draw it. Check it in the code.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- the file's own text as a data URL
          <img
            key={src}
            src={src}
            alt={name}
            onLoad={(e) => {
              setBroken(false);
              setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight });
            }}
            onError={() => setBroken(true)}
            className={cn("mx-auto block", fit && "h-full max-h-full w-full max-w-full object-contain")}
          />
        )}
      </div>
    </div>
  );
}
