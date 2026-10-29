"use client";

import type { SecretFinding } from "@codechatter/contracts";
import { KeyRound } from "lucide-react";

import { openRoomFile } from "@/components/room/editor/editor-opener";
import { Button } from "@/components/ui/button";

/**
 * What the secret scan found in a commit, publish or gist the API refused: each key or
 * password's file, line and kind (opening the file there), then take them out or go ahead.
 */
export function SecretsFound({
  message,
  secrets,
  action,
  busy,
  onGoAhead,
  onCancel,
}: {
  message: string;
  secrets: SecretFinding[];
  /** What going ahead does: "Commit anyway". */
  action: string;
  busy: boolean;
  onGoAhead: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alert" aria-label="Secrets found" className="grid gap-2 rounded-md border border-destructive/50 p-2 text-xs">
      <p className="flex gap-1.5 text-destructive">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {message}
      </p>
      <ul className="grid max-h-40 gap-0.5 overflow-y-auto">
        {secrets.map((secret) => (
          <li key={`${secret.path}:${secret.line}:${secret.preview}`}>
            <button
              type="button"
              onClick={() => openRoomFile(secret.path, { startLine: secret.line, startColumn: 1, endLine: secret.line, endColumn: 1 })}
              className="grid w-full gap-0.5 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
            >
              <span className="truncate font-mono">
                {secret.path}:{secret.line}
              </span>
              <span className="text-muted-foreground">
                {secret.kind} <span className="font-mono">{secret.preview}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        Anything sent to GitHub stays in its history. Read real keys from environment variables instead, or mark a test
        value with <span className="font-mono">gitleaks:allow</span> on its line.
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="destructive" onClick={onGoAhead} disabled={busy}>
          {action}
        </Button>
      </div>
    </div>
  );
}
