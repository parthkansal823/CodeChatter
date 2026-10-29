"use client";

import type { PublishResult, SecretFinding } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

import { markSynced, roomTexts } from "./room-files";
import { SecretsFound } from "./secrets-found";
import { repoKey } from "./use-repo";

/** A repository name from the room's: lower case, words joined by dashes. */
export const repoNameFor = (room: string) =>
  room
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100) || "codechatter-room";

/**
 * The Source Control view of a room that isn't on GitHub: publish it as a new repository
 * of yours (private unless you say so), after which the room commits and pulls there.
 */
export function PublishSection() {
  const { room, doc, can } = useRoom();
  const client = useQueryClient();
  const [name, setName] = useState(() => repoNameFor(room.name));
  const [description, setDescription] = useState("");
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<{ message: string; found: SecretFinding[] } | null>(null);
  const nameId = useId();

  /** Publish; with `allowSecrets`, after the secret scan's findings were shown. */
  async function publish(allowSecrets = false) {
    const files = [...roomTexts(doc)].map(([path, content]) => ({ path, content }));
    if (!files.length) return setError("The room has no files to publish.");
    setBusy(true);
    setError(null);
    setSecrets(null);
    try {
      const result = await api<PublishResult>(`/api/rooms/${room.id}/repo/publish`, {
        method: "POST",
        json: { name: name.trim(), private: isPrivate, description, files, allowSecrets },
      });
      markSynced(doc, { branch: result.branch, commit: result.commit });
      await client.invalidateQueries({ queryKey: repoKey(room.id) });
      toast.success(`Published to ${result.repo}`, {
        action: { label: "Open", onClick: () => window.open(result.url, "_blank", "noreferrer") },
      });
    } catch (e) {
      if (e instanceof ApiError && e.secrets?.length) setSecrets({ message: e.detail, found: e.secrets });
      else setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.detail) : "Couldn't publish. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!can("room.manage")) {
    return (
      <p className="px-3 text-xs text-muted-foreground">
        This room isn’t on GitHub. Someone who manages the room can publish it.
      </p>
    );
  }
  return (
    <form
      className="grid gap-2 px-3 pb-3 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        void publish();
      }}
    >
      <p className="text-muted-foreground">
        This room isn’t on GitHub yet. Publish its files as a new repository of yours, then commit, pull and
        open pull requests here.
      </p>
      <label htmlFor={nameId} className="font-medium">
        Repository name
      </label>
      <Input
        id={nameId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-7 font-mono text-xs"
        spellCheck={false}
      />
      <Input
        aria-label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="h-7 text-xs"
      />
      <label className="flex items-center gap-2">
        <Checkbox checked={isPrivate} onCheckedChange={(v) => setPrivate(v === true)} />
        Private
      </label>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {secrets && (
        <SecretsFound
          message={secrets.message}
          secrets={secrets.found}
          action="Publish anyway"
          busy={busy}
          onGoAhead={() => void publish(true)}
          onCancel={() => setSecrets(null)}
        />
      )}
      <Button type="submit" size="sm" disabled={busy || !name.trim()}>
        {busy ? "Publishing…" : "Publish to GitHub"}
      </Button>
      <p className="text-muted-foreground">
        It uses your GitHub token (repo scope):{" "}
        <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
          Settings
        </Link>
        . To start from a repository instead, make a room from New room → GitHub.
      </p>
    </form>
  );
}
