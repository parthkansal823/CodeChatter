/** Fill the bank in one go: paste a spreadsheet or JSON, see what's wrong line by line, and import all of it or none. */
"use client";

import { MOST_IMPORTED, parseQuestionImport } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";

const SAMPLE = `question,a,b,c,d,answer,difficulty,marks,tags
Which join keeps every row of the left table?,INNER,LEFT,CROSS,SELF,b,easy,2,sql;joins
Which are ACID properties?,Atomicity,Speed,Isolation,Caching,a;c,medium,3,databases
Why can a cache make reads stale?,,,,,,medium,5,caching
Design a URL shortener,,,,,,hard,20,system-design`;

export function ImportQuestionsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { questions, problems } = useMemo(() => parseQuestionImport(text), [text]);
  const tooMany = questions.length > MOST_IMPORTED;
  const ready = questions.length > 0 && problems.length === 0 && !tooMany;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { imported } = await api<{ imported: number }>("/api/interview-questions/import", { method: "POST", json: { questions } });
      await queryClient.invalidateQueries({ queryKey: ["interview-questions"] });
      toast.success(`${imported} question${imported === 1 ? "" : "s"} added to the bank.`);
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.detail : "They couldn't be imported. Try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto shadow-none sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import questions</DialogTitle>
          <DialogDescription>
            Paste from a spreadsheet, with a first line naming the columns: <code className="font-mono">question</code>, a column for each choice (<code className="font-mono">a</code>, <code className="font-mono">b</code>...), <code className="font-mono">answer</code> (a letter, or <code className="font-mono">a;c</code> for several), and any of <code className="font-mono">kind</code>, <code className="font-mono">difficulty</code>, <code className="font-mono">marks</code>, <code className="font-mono">tags</code> and <code className="font-mono">model answer</code>. With no choices it&apos;s a short answer. For coding questions, paste a JSON list.
          </DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Questions to import" rows={10} className="font-mono" spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} placeholder={SAMPLE} />
        <Button type="button" size="xs" variant="ghost" className="justify-self-start" onClick={() => setText(SAMPLE)}>Try the example</Button>
        {text.trim() && (
          <p role="status" className="text-muted-foreground">
            {questions.length} question{questions.length === 1 ? "" : "s"} ready{problems.length > 0 && `, ${problems.length} to fix first`}.
          </p>
        )}
        {tooMany && <p role="alert" className="text-destructive">At most {MOST_IMPORTED} at a time.</p>}
        {problems.length > 0 && (
          <ul role="alert" className="max-h-40 list-disc overflow-y-auto pl-5 text-destructive">
            {problems.slice(0, 50).map((problem) => <li key={problem}>{problem}</li>)}
            {problems.length > 50 && <li>And {problems.length - 50} more.</li>}
          </ul>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy || !ready} onClick={() => void send()}>
            {busy ? "Importing…" : `Import ${questions.length} question${questions.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
