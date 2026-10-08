"use client";

import { generateSnippet, resolveRequest, SNIPPET_LANGUAGES, type SnippetLanguage } from "@codechatter/contracts";
import { Copy } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { copyText } from "@/lib/clipboard";

import { useRequest } from "./connection";
import { sensitiveNames } from "./local-store";
import { Segmented } from "./segmented";
import { useStudio } from "./studio-context";

export function SnippetsDialog() {
  const { dialog, openDialog } = useStudio();
  const requestId = dialog?.kind === "snippets" ? dialog.requestId : null;
  return (
    <Dialog open={requestId !== null} onOpenChange={(open) => !open && openDialog(null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Code for this request</DialogTitle>
          <DialogDescription>The same request, ready to paste into your own code. Variables are filled in from your environment.</DialogDescription>
        </DialogHeader>
        {requestId && <SnippetBody requestId={requestId} />}
      </DialogContent>
    </Dialog>
  );
}

function SnippetBody({ requestId }: { requestId: string }) {
  const { doc, env, mine, lookup } = useStudio();
  const request = useRequest(doc, requestId);
  const [language, setLanguage] = useState<SnippetLanguage>("curl");
  const [withSecrets, setWithSecrets] = useState(false);
  const uid = useId();

  const hidden = useMemo(() => sensitiveNames(env, mine), [env, mine]);
  const code = useMemo(() => {
    if (!request) return "";
    // Secrets stay as {{name}} unless asked for, so what you paste into a chat isn't a credential.
    const lookupFor = withSecrets ? lookup : (name: string) => (hidden.has(name) ? undefined : lookup(name));
    return generateSnippet(language, resolveRequest(request, lookupFor).input);
  }, [request, language, withSecrets, lookup, hidden]);

  if (!request) return <p className="text-sm text-muted-foreground">This request was deleted.</p>;

  return (
    <div className="grid min-w-0 gap-3">
      <Segmented label="Language" value={language} onChange={setLanguage} options={SNIPPET_LANGUAGES.map((l) => ({ id: l.id, label: l.label }))} />
      <pre aria-label={`${language} code`} className="max-h-80 min-h-32 overflow-auto rounded-md border bg-panel p-3 font-mono text-sm whitespace-pre">
        {code}
      </pre>
      <div className="flex items-center gap-3">
        {hidden.size > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox id={`${uid}-secrets`} checked={withSecrets} onCheckedChange={(checked) => setWithSecrets(checked === true)} />
            <Label htmlFor={`${uid}-secrets`} className="text-sm font-normal">
              Include my secret values
            </Label>
          </div>
        )}
        <Button
          size="sm"
          className="ml-auto"
          onClick={async () => {
            if (await copyText(code)) toast.success("Copied the code.");
            else toast.error("Couldn't copy. Select the code and copy it by hand.");
          }}
        >
          <Copy /> Copy
        </Button>
      </div>
    </div>
  );
}
