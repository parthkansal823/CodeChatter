"use client";

import { PanelLeft, Waypoints, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { useDocs } from "./docs-context";

/** The tool's header: page list toggle, whatever the view puts in the middle, Graph and Close. */
export function DocsHeader({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  const { view, setView, close, sidebar, toggleSidebar } = useDocs();
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-chrome px-1.5">
      <Button variant="ghost" size="icon-xs" aria-label={sidebar ? "Hide page list" : "Show page list"} aria-pressed={sidebar} onClick={toggleSidebar}>
        <PanelLeft />
      </Button>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {actions}
      <Button variant={view === "graph" ? "secondary" : "ghost"} size="xs" aria-pressed={view === "graph"} onClick={() => setView(view === "graph" ? "page" : "graph")}>
        <Waypoints /> Graph
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Close docs" onClick={close}>
        <X />
      </Button>
    </div>
  );
}
