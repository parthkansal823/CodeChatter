"use client";

import { lazy, Suspense, type ComponentType } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { ROOM_TOOLS, type RoomTool, type RoomToolProps } from "./registry";

// One lazy component per tool, created once for the page.
const COMPONENTS = new Map<string, ComponentType<RoomToolProps>>(ROOM_TOOLS.map((tool) => [tool.id, lazy(tool.load)]));

export function ToolHost({ tool, ...props }: { tool: RoomTool } & RoomToolProps) {
  // A lookup, not a new component: every lazy component above is created once
  // when this module loads, so its identity (and state) is stable across renders.
  const Component = COMPONENTS.get(tool.id);
  if (!Component) return null;
  return (
    <Suspense
      fallback={
        <div className="grid gap-2 p-4" aria-label={`Loading ${tool.label}`}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      }
    >
      {/* eslint-disable-next-line react-hooks/static-components -- module-level lazy component, see above */}
      <Component {...props} />
    </Suspense>
  );
}
