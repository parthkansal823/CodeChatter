/**
 * A flow's tags, as n8n's workflow tags: words to find it by, kept in its file (`tags`), so they go with it (and with git and History). The tool's
 * chooser narrows to the flows with one of them. Tags follow the same rules as a run's (withTag in model.ts).
 */
"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { withTag, withTags, type Flow } from "./model";

export function FlowTags({ flow, canEdit, onSave }: { flow: Flow; canEdit: boolean; onSave: (flow: Flow) => void }) {
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const tags = flow.tags ?? [];
  const add = () => {
    const next = withTag(tags, typed);
    if ("problem" in next) return setProblem(next.problem);
    setProblem(null);
    setTyped("");
    if (next.tags.length !== tags.length) onSave(withTags(flow, next.tags));
  };

  return (
    <section aria-label="Its tags" className="grid gap-1">
      <h4 className="font-medium">Tags</h4>
      {tags.length > 0 ? (
        <ul aria-label="The flow's tags" className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <li key={tag} className="flex h-6 items-center gap-0.5 rounded-sm border bg-secondary pl-1.5 pr-0.5">
              {tag}
              {canEdit && (
                <button type="button" aria-label={`Remove the tag ${tag}`} className="grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onSave(withTags(flow, tags.filter((each) => each !== tag)))}>
                  <X className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !canEdit && <p className="text-muted-foreground">No tags.</p>
      )}
      {canEdit && (
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input className="h-7 text-xs md:text-xs" aria-label="A tag for this flow" aria-describedby={`${id}-help`} aria-invalid={Boolean(problem)} maxLength={30} placeholder="A tag, such as deploys or reports" value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setProblem(null);
            }}
          />
          <Button type="submit" size="xs" variant="outline" disabled={!typed.trim()}>
            Add
          </Button>
        </form>
      )}
      <span id={`${id}-help`} className={problem ? "text-destructive" : "text-muted-foreground"}>
        {problem ?? "Words to find it by: the list of automations can show only those with one."}
      </span>
    </section>
  );
}
