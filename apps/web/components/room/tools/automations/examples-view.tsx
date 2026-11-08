/** The gallery of example automations: search them, see what each needs and whether it's been run for real, and copy one into the room to change. */
"use client";

import type { PieceInfo } from "@codechatter/contracts";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { EXAMPLE_CATEGORIES, EXAMPLES, flowOfExample, matchesExample, servicesOf } from "./examples";
import type { Flow } from "./model";

export function ExamplesView({ pieces, canEdit, onUse }: { pieces: Record<string, PieceInfo>; canEdit: boolean; onUse: (flow: Flow) => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const shown = EXAMPLES.filter((example) => (!category || example.category === category) && matchesExample(example, search));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-2 border-b p-3 text-xs">
        <p className="text-muted-foreground">
          {EXAMPLES.length} automations for coding, written for this tool, and every step is checked against what its service really offers. <strong className="font-medium text-foreground">Runs here</strong> means it has been run for real in a sandbox; the rest need a service&apos;s connection and the internet, which rooms don&apos;t have yet.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input aria-label="Search the examples" className="h-7 pl-6 text-xs" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        <div role="group" aria-label="Kinds of example" className="flex flex-wrap gap-1">
          <Button size="xs" variant={category === null ? "secondary" : "ghost"} aria-pressed={category === null} onClick={() => setCategory(null)}>
            All
          </Button>
          {EXAMPLE_CATEGORIES.map((name) => (
            <Button key={name} size="xs" variant={category === name ? "secondary" : "ghost"} aria-pressed={category === name} onClick={() => setCategory(name)}>
              {name}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!shown.length ? (
          <p className="text-xs text-muted-foreground">Nothing matches that.</p>
        ) : (
          <ul aria-label="Examples" className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((example) => {
              const services = servicesOf(example, pieces);
              return (
                <li key={example.id} className="grid content-start gap-1 rounded-md border p-2 text-xs">
                  <div className="flex items-start gap-2">
                    <h3 className="min-w-0 flex-1 font-medium">{example.title}</h3>
                    {canEdit && (
                      <Button size="xs" variant="outline" aria-label={`Use ${example.title}`} onClick={() => onUse(flowOfExample(example, pieces))}>
                        <Plus /> Use
                      </Button>
                    )}
                  </div>
                  <p className="text-muted-foreground">{example.about}</p>
                  <p className={cn("text-[11px]", example.runsHere ? "font-medium" : "text-muted-foreground")}>{example.runsHere ? "Runs here" : `Needs ${services.join(", ") || "a connection"}`}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
