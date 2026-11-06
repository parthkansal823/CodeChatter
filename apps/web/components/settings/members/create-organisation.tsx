/** Create and activate a team through the installed Better Auth client, with a debounced editable slug check. */
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

import { navigateFresh } from "./org-actions";

function slugFromName(name: string): string {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (slug.startsWith("u-") ? `team-${slug}` : slug).slice(0, 64).replace(/-+$/g, "");
}

export function CreateOrganisation() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editedSlug, setEditedSlug] = useState(false);
  const [checkedSlug, setCheckedSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const validSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64 && !slug.startsWith("u-");

  useEffect(() => {
    const timer = setTimeout(() => setCheckedSlug(slug), 350);
    return () => clearTimeout(timer);
  }, [slug]);

  const availability = useQuery({
    queryKey: ["organisation-slug", checkedSlug],
    enabled: Boolean(validSlug && checkedSlug === slug && !createdId),
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const result = await authClient.organization.checkSlug({ slug: checkedSlug, fetchOptions: { signal } });
      if (result.error?.code === "ORGANIZATION_SLUG_ALREADY_TAKEN") return false;
      if (result.error) throw new Error("Couldn't check this slug. Try again.");
      return result.data?.status === true;
    },
  });
  const checked = checkedSlug === slug;
  const available = checked && availability.data === true && !availability.isFetching;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) { setError("Give the organisation a name."); return; }
    if (!createdId && (!validSlug || !available)) { setError("Choose an available slug first."); return; }
    setBusy(true);
    setError("");
    try {
      let id = createdId;
      if (!id) {
        const result = await authClient.organization.create({ name: name.trim(), slug });
        if (result.error || !result.data) {
          setError(result.error?.code === "ORGANIZATION_ALREADY_EXISTS" || result.error?.code === "ORGANIZATION_SLUG_ALREADY_TAKEN"
            ? "That slug is already in use. Choose another."
            : result.error?.message ?? "Couldn't create the organisation. Try again.");
          return;
        }
        id = result.data.id;
        setCreatedId(id);
      }
      const active = await authClient.organization.setActive({ organizationId: id });
      if (active.error) { setError("The organisation was created. Try opening it again."); return; }
      toast.success("Organisation created.");
      navigateFresh(queryClient, "/dashboard");
    } catch { setError(createdId ? "Couldn't open the organisation. Try again." : "Couldn't finish the request. Check your connection before trying again."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="New organisation" description="Create a shared workspace for your team." />
      <form onSubmit={submit} className="grid max-w-xl gap-5 px-6 py-6 sm:px-8">
        <Field>
          <FieldLabel htmlFor="organisation-name">Organisation name</FieldLabel>
          <Input id="organisation-name" value={name} maxLength={80} autoComplete="organization" disabled={busy || Boolean(createdId)} onChange={(event) => {
            setName(event.target.value);
            if (!editedSlug) setSlug(slugFromName(event.target.value));
            setError("");
          }} required />
          {!name.trim() && <FieldDescription>Give the organisation a name before creating it.</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor="organisation-slug">Slug</FieldLabel>
          <Input id="organisation-slug" value={slug} maxLength={64} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy || Boolean(createdId)} onChange={(event) => {
            setEditedSlug(true);
            setSlug(event.target.value.toLowerCase());
            setError("");
          }} aria-describedby="organisation-slug-status" aria-invalid={Boolean(slug && (!validSlug || (checked && availability.data === false)))} required />
          <FieldDescription id="organisation-slug-status" aria-live="polite">
            {!slug ? "Use lowercase letters, numbers and hyphens." : !validSlug ? (slug.startsWith("u-") ? "Slugs starting with u- are reserved for personal workspaces." : "Use lowercase letters and numbers, separated by single hyphens.")
              : createdId ? "This is your organisation's slug." : !checked || availability.isFetching ? "Checking availability…" : availability.isError ? "Couldn't check this slug. Try again."
                : availability.data === false ? "That slug is already in use." : available ? "This slug is available." : "Checking availability…"}
          </FieldDescription>
          {availability.isError && <div><Button type="button" size="xs" variant="outline" onClick={() => void availability.refetch()}>Check slug again</Button></div>}
        </Field>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy || (!createdId && (!name.trim() || !validSlug || !available))}>{busy ? "Saving…" : createdId ? "Open organisation" : "Create organisation"}</Button>
          <Button type="button" size="sm" variant="outline" asChild><Link href="/dashboard">Cancel</Link></Button>
        </div>
      </form>
    </>
  );
}
