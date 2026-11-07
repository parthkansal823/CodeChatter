/** What \cite completes from: the workspace says where the room's references are while it's open. On its own so that saying so doesn't load the editor. */
import type { BibEntry } from "@/components/room/tools/references/bibtex";

let source: () => BibEntry[] = () => [];

export function setReferenceSource(next: (() => BibEntry[]) | null): void {
  source = next ?? (() => []);
}

export const referencesNow = (): BibEntry[] => source();
