"use client";

import type { GithubConnection } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";

const key = ["github-connection"] as const;
/** A classic token with the repo and gist scopes; fine-grained tokens with read access to contents work too. */
const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,gist&description=CodeChatter";

/**
 * Your GitHub token, for importing private repositories. GitHub checks it when it's saved,
 * it's kept encrypted, and it's never shown again: only whose it is.
 */
export function GithubToken() {
  const client = useQueryClient();
  const connection = useQuery({ queryKey: key, queryFn: () => api<GithubConnection>("/api/me/github") });
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: string) =>
      api<GithubConnection>("/api/me/github", { method: "PUT", json: { token: value } }),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      setToken("");
      setReplacing(false);
      toast.success(`GitHub connected as ${data.login}`);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError ? (e.errors?.[0]?.message ?? e.detail) : "Couldn't save the token. Try again.",
      ),
  });
  const remove = useMutation({
    mutationFn: () => api<void>("/api/me/github", { method: "DELETE" }),
    onSuccess: () => {
      client.setQueryData<GithubConnection>(key, { login: null });
      toast.success("GitHub token removed");
    },
  });

  const login = connection.data?.login ?? null;
  return (
    <section aria-labelledby="github-heading" className="grid gap-3">
      <div>
        <h2 id="github-heading" className="font-medium">
          GitHub
        </h2>
        <p className="text-muted-foreground">
          Public repositories import without a token. For private ones, CodeChatter needs one of yours.
        </p>
      </div>
      {connection.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : login && !replacing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          <span className="min-w-0 flex-1">
            Connected as <span className="font-mono">{login}</span>
          </span>
          <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
            Replace token
          </Button>
          <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!token.trim()) return setError("Paste a token first.");
            setError(null);
            save.mutate(token.trim());
          }}
        >
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="github-token">Personal access token</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="github-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setError(null);
                }}
                placeholder="ghp_… or github_pat_…"
                className="min-w-0 flex-1 font-mono"
              />
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Checking…" : "Save"}
              </Button>
              {replacing && (
                <Button type="button" variant="ghost" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <FieldDescription>
              Make one with the <span className="font-mono">repo</span> scope (and{" "}
              <span className="font-mono">gist</span> to share files as gists), or a fine-grained one that can
              read contents.{" "}
              <a
                href={NEW_TOKEN_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                Make a token on GitHub <ExternalLink className="size-3" />
              </a>
              . It’s stored encrypted and never shown again.
            </FieldDescription>
          </Field>
        </form>
      )}
    </section>
  );
}
