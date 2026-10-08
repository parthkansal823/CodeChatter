"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Marks its subtree `data-inview="true"` the first time it scrolls into view.
 * Children animate with `group-data-[inview=true]/iv:` variants (see
 * ./reveal.ts), so the motion lives in markup next to the content it belongs
 * to. Reduced motion is handled globally (durations and delays collapse), and
 * a <noscript> rule in the marketing layout shows `.reveal` content without JS.
 */
export function InView({ className, children, ...props }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-inview={inView} className={cn("group/iv", className)} {...props}>
      {children}
    </div>
  );
}
