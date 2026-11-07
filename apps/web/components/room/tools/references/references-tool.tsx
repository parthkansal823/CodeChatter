/** The References tool: what's in a room's .bib files, searchable, cited with a click, and added by DOI or arXiv id. The server fetches those, as rooms have no internet, and they're written to a .bib file like any other text. */
"use client";

import type { ReferenceLookup } from "@codechatter/contracts";
import { createFileAtPath, flatten, textOf } from "@codechatter/workspace-model";
import { BookMarked, Copy, Loader2, Plus, Quote, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getActiveEditor } from "@/components/room/editor/active-editor";
import { openRoomFile } from "@/components/room/editor/editor-opener";
import { useFileTree } from "@/components/room/hooks";
import { isTexName, rootTexOf } from "@/components/room/paper/model";
import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

import { entryToAdd, matchesSearch, parseBibtex, placeOf, shortAuthors, type BibEntry } from "./bibtex";

const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");

export default function ReferencesTool({ activeFile }: RoomToolProps) {
  const { room, doc, me, can } = useRoom();
  const tree = useFileTree();
  const canEdit = can("files.edit");
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState("");
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const files = flatten(tree).filter((node) => node.kind === "file" && !node.blob);
  const bibs = files.filter((node) => /\.bib$/i.test(node.name));
  const entries: Array<BibEntry & { path: string }> = bibs.flatMap((node) => parseBibtex(textOf(doc, node.id)?.toString() ?? "").map((entry) => ({ ...entry, path: node.path })));
  const shown = entries.filter((entry) => matchesSearch(entry, search));

  const cite = async (key: string) => {
    const command = `\\cite{${key}}`;
    const editor = activeFile && isTexName(activeFile.name) ? getActiveEditor() : null;
    const place = editor?.getSelection();
    if (editor && place) {
      editor.executeEdits("references", [{ range: place, text: command, forceMoveMarkers: true }]);
      editor.focus();
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      toast.success(`Copied ${command}`);
    } catch {
      toast.error("Couldn't copy it. Open a .tex file to put it there instead.");
    }
  };

  /** The .bib beside the paper being edited, or a new one there. */
  const addTo = (text: string) => {
    const papers = files.filter((node) => isTexName(node.name)).map((node) => ({ path: node.path, text: textOf(doc, node.id)?.toString() ?? "" }));
    const root = rootTexOf(papers, activeFile?.path ?? null);
    const folder = root?.includes("/") ? root.slice(0, root.lastIndexOf("/")) : "";
    const target = bibs.find((node) => folder && node.path.startsWith(`${folder}/`)) ?? bibs[0];
    if (!target) {
      createFileAtPath(doc, folder ? `${folder}/references.bib` : "references.bib", `${text}\n`, me.user.id);
      return folder ? `${folder}/references.bib` : "references.bib";
    }
    const body = textOf(doc, target.id);
    if (body) {
      const before = body.toString();
      body.insert(before.length, `${before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : ""}${text}\n`);
    }
    return target.path;
  };

  const add = async () => {
    if (!lookup.trim() || adding) return;
    setAdding(true);
    setProblem(null);
    try {
      const { bibtex } = await api<ReferenceLookup>(`/api/rooms/${room.id}/references/lookup`, { method: "POST", json: { id: lookup } });
      const made = entryToAdd(bibtex, entries);
      if ("error" in made) setProblem(made.error);
      else if ("duplicateOf" in made) setProblem(`It's already here, as ${made.duplicateOf}.`);
      else {
        const path = addTo(made.text);
        setLookup("");
        toast.success(`Added ${made.key} to ${path}`);
      }
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setAdding(false);
    }
  };

  return (
    <section aria-label="References" className="flex h-full min-h-0 flex-col bg-background text-xs">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <BookMarked className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-[13px] font-medium">References</h2>
        <span className="ml-auto text-muted-foreground tabular-nums">{entries.length}</span>
      </header>

      {canEdit && (
        <form
          className="grid shrink-0 gap-1 border-b p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label htmlFor="reference-id">Add by DOI or arXiv id</label>
          <div className="flex gap-1">
            <Input id="reference-id" className="h-7 min-w-0 flex-1 font-mono text-xs" placeholder="10.1038/nature14539" value={lookup} onChange={(event) => setLookup(event.target.value)} />
            <Button size="xs" type="submit" disabled={adding || !lookup.trim()}>
              {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add
            </Button>
          </div>
          {problem && (
            <p role="alert" className="text-destructive">
              {problem}
            </p>
          )}
        </form>
      )}

      {entries.length > 0 && (
        <div className="relative shrink-0 border-b p-2">
          <Search className="absolute top-1/2 left-4 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search references" className="h-7 pl-7 text-xs" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!entries.length ? (
          <p className="max-w-prose p-3 text-muted-foreground">No references yet. They&apos;re kept in a .bib file in this room, which LaTeX reads when it builds the paper.{canEdit && " Add one by its DOI or arXiv id, and a file is made for it."}</p>
        ) : !shown.length ? (
          <p className="p-3 text-muted-foreground">Nothing matches that.</p>
        ) : (
          <ul aria-label="References in this room" className="grid">
            {shown.map((entry) => {
              const about = [shortAuthors(entry), entry.fields.year, placeOf(entry)].filter(Boolean).join(" · ");
              return (
                <li key={`${entry.path}:${entry.key}`} className="grid gap-0.5 border-b p-2">
                  <button type="button" className="rounded-sm text-left font-medium hover:underline" title={`Open it in ${entry.path}`} onClick={() => openRoomFile(entry.path, { startLine: entry.line, startColumn: 1, endLine: entry.line, endColumn: 1 })}>
                    {entry.fields.title || entry.key}
                  </button>
                  {about && <p className="text-muted-foreground">{about}</p>}
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{entry.key}</span>
                    <Button size="xs" variant="ghost" aria-label={`Cite ${entry.key}`} title={activeFile && isTexName(activeFile.name) ? "Put \\cite in the paper, where the cursor is" : "Copy \\cite"} onClick={() => void cite(entry.key)}>
                      {activeFile && isTexName(activeFile.name) ? <Quote /> : <Copy />} Cite
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
