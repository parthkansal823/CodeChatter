/** Manage team membership through Better Auth while keeping personal workspaces private. */
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";

type Member = NonNullable<Awaited<ReturnType<typeof authClient.organization.listMembers>>["data"]>["members"][number];
type Invitation = NonNullable<Awaited<ReturnType<typeof authClient.organization.listInvitations>>["data"]>[number];
type Role = "owner" | "admin" | "member";
type InviteResult = { email: string; sent: boolean; message: string };
type Confirmation = { kind: "remove"; member: Member } | { kind: "leave" };

const ROLES: Role[] = ["member", "admin", "owner"];
const EMAIL = z.email();

function hasRole(value: string, role: Role): boolean { return value.split(",").map((item) => item.trim()).includes(role); }
function roleName(role: string): string { return role.split(",").map((item) => item.charAt(0).toUpperCase() + item.slice(1)).join(", "); }
function dateText(date: string | Date): string { return new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }

function errorText(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }

function unwrap<T>(result: { data: T | null; error: { code?: string; message?: string } | null }, fallback: string): T {
  if (result.error || result.data === null) {
    const messages: Record<string, string> = {
      USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "Already a member.",
      USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "Already invited.",
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: "Make someone else an owner before you leave.",
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: "The organisation must keep an owner.",
    };
    throw new Error(messages[result.error?.code ?? ""] ?? result.error?.message ?? fallback);
  }
  return result.data;
}

async function readMembers(organizationId: string, signal: AbortSignal): Promise<Member[]> {
  const all = new Map<string, Member>();
  let offset = 0;
  for (;;) {
    const page = unwrap(await authClient.organization.listMembers({
      query: { organizationId, limit: 100, offset, sortBy: "createdAt", sortDirection: "asc" },
      fetchOptions: { signal },
    }), "Couldn't load members.");
    for (const member of page.members) if (member.user?.id) all.set(member.id, member);
    offset += page.members.length;
    if (!page.members.length || offset >= page.total) return [...all.values()];
  }
}

function OrganisationMembers({ org }: { org: { id: string; name: string } }) {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [formError, setFormError] = useState("");
  const [results, setResults] = useState<InviteResult[]>([]);
  const [manualLink, setManualLink] = useState("");

  const members = useQuery({
    queryKey: ["org-members", org.id],
    queryFn: ({ signal }) => readMembers(org.id, signal),
    refetchInterval: 15_000,
    retry: 1,
  });
  const people = members.data ?? [];
  const own = people.find((person) => person.userId === me.user.id);
  const isOwner = Boolean(own && hasRole(own.role, "owner"));
  const canManage = !members.isError && Boolean(own && (hasRole(own.role, "owner") || hasRole(own.role, "admin")));
  const owners = people.filter((person) => hasRole(person.role, "owner")).length;
  const lastOwner = isOwner && owners === 1;
  const inviteRole = role === "owner" && !isOwner ? "member" : role;
  const invitations = useQuery({
    queryKey: ["org-invitations", org.id],
    enabled: canManage,
    queryFn: async ({ signal }) => unwrap(await authClient.organization.listInvitations({ query: { organizationId: org.id }, fetchOptions: { signal } }), "Couldn't load invitations."),
    refetchInterval: 15_000,
    retry: 1,
  });
  const pending = (invitations.data ?? []).filter((invitation) => invitation.status === "pending");

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["org-members", org.id] }),
      queryClient.invalidateQueries({ queryKey: ["org-invitations", org.id] }),
    ]);
    // The app shell's /api/me data comes from its server layout, not this query cache.
    router.refresh();
  }

  async function changeRole(person: Member, nextRole: Role) {
    if (busy || nextRole === person.role) return;
    setBusy(`role:${person.id}`);
    try {
      unwrap(await authClient.organization.updateMemberRole({ memberId: person.id, role: nextRole, organizationId: org.id }), "Couldn't change the role.");
      toast.success("Role updated.");
      await refresh();
    } catch (error) { toast.error(errorText(error, "Couldn't change the role.")); }
    finally { setBusy(null); }
  }

  async function confirmAction() {
    if (busy || !confirmation) return;
    setBusy(confirmation.kind);
    try {
      if (confirmation.kind === "leave") {
        unwrap(await authClient.organization.leave({ organizationId: org.id }), "Couldn't leave the organisation.");
        // Select a valid workspace before navigating, even if the plugin cleared the active organisation.
        const active = await authClient.organization.setActive({ organizationId: me.personalOrgId });
        queryClient.removeQueries({ queryKey: ["org-members", org.id] });
        queryClient.removeQueries({ queryKey: ["org-invitations", org.id] });
        if (active.error) toast.error("You left the organisation. Choose a workspace from the menu.");
        else toast.success("You left the organisation.");
        // Remount the shell so its organisation switcher cannot retain the departed team's ID.
        window.location.assign(new URL("/dashboard", window.location.origin).href);
      } else {
        unwrap(await authClient.organization.removeMember({ memberIdOrEmail: confirmation.member.id, organizationId: org.id }), "Couldn't remove this member.");
        toast.success("Member removed.");
        await refresh();
      }
      setConfirmation(null);
    } catch (error) { toast.error(errorText(error, "Couldn't update membership.")); }
    finally { setBusy(null); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError("");
    setResults([]);
    const entries = emails.split(/[,\r\n]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!entries.length) { setFormError("Enter at least one email address."); return; }
    if (entries.length > 20) { setFormError("Invite at most 20 people at once."); return; }
    setBusy("invite");
    const outcomes: InviteResult[] = [];
    const seen = new Set<string>();
    const memberEmails = new Set(people.map((person) => person.user.email.toLowerCase()));
    const invitedEmails = new Set(pending.filter((invitation) => new Date(invitation.expiresAt).getTime() > Date.now()).map((invitation) => invitation.email.toLowerCase()));
    try {
      for (const email of entries) {
        let message = !EMAIL.safeParse(email).success ? "Not a valid email address." : seen.has(email) ? "Repeated in this list." : memberEmails.has(email) ? "Already a member." : invitedEmails.has(email) ? "Already invited." : "";
        seen.add(email);
        let sent = false;
        if (!message) {
          try {
            unwrap(await authClient.organization.inviteMember({ email, role: inviteRole, organizationId: org.id }), "Couldn't send the invitation.");
            sent = true;
            message = "Invitation sent.";
            invitedEmails.add(email);
          } catch (error) { message = errorText(error, "Couldn't send the invitation."); }
        }
        outcomes.push({ email, sent, message });
        setResults([...outcomes]);
      }
      await refresh();
    } finally { setBusy(null); }
  }

  async function cancel(invitation: Invitation) {
    if (busy) return;
    setBusy(`cancel:${invitation.id}`);
    try {
      unwrap(await authClient.organization.cancelInvitation({ invitationId: invitation.id }), "Couldn't cancel this invitation.");
      toast.success("Invitation cancelled.");
      await refresh();
    } catch (error) { toast.error(errorText(error, "Couldn't cancel this invitation.")); }
    finally { setBusy(null); }
  }

  async function copyLink(invitation: Invitation) {
    const link = `${window.location.origin}/invite/${encodeURIComponent(invitation.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      setManualLink("");
      toast.success("Invitation link copied.");
    } catch {
      setManualLink(link);
      toast.error("Copy the invitation link below.");
    }
  }

  return (
    <>
      <PageHeader title="Members" description={`People in ${org.name}. Organisation membership does not grant access to its rooms.`} actions={<Button size="sm" variant="outline" disabled={members.isFetching || Boolean(busy)} onClick={() => void refresh()}><RefreshCw className="size-3.5" /> Refresh</Button>} />
      <div className="grid gap-8 px-6 py-6 sm:px-8">
        <section aria-label="Organisation members" className="grid min-w-0 gap-3">
          <h2 className="font-medium">Members</h2>
          {members.isError ? <p role="alert" className="text-destructive">{errorText(members.error, "Couldn't load members. Try again.")}</p> : (
            <div className="overflow-hidden rounded-md border" aria-busy={members.isPending}>
              <Table className="min-w-xl text-xs">
                <caption className="sr-only">Members of {org.name}</caption>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Joined</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {members.isPending ? <TableRow><TableCell colSpan={5}>Loading members…</TableCell></TableRow> : people.map((person) => {
                    const you = person.userId === me.user.id;
                    const personIsOwner = hasRole(person.role, "owner");
                    const protectedOwner = personIsOwner && owners === 1;
                    const canEdit = canManage && (isOwner || !personIsOwner);
                    return (
                      <TableRow key={person.id}>
                        <TableCell className="max-w-56 whitespace-normal break-words">{person.user.name || "Unnamed person"}{you && <span className="ml-1 text-muted-foreground">(you)</span>}</TableCell>
                        <TableCell className="max-w-72 whitespace-normal break-all">{person.user.email}</TableCell>
                        <TableCell>{canEdit ? (
                          <Select value={ROLES.includes(person.role as Role) ? person.role : undefined} onValueChange={(value) => void changeRole(person, value as Role)} disabled={Boolean(busy) || protectedOwner}>
                            <SelectTrigger size="sm" aria-label={`Role for ${person.user.email}`} className="h-7 w-28 text-xs"><SelectValue placeholder={roleName(person.role)} /></SelectTrigger>
                            <SelectContent>{ROLES.filter((value) => value !== "owner" || isOwner).map((value) => <SelectItem key={value} value={value}>{roleName(value)}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : roleName(person.role)}</TableCell>
                        <TableCell><time dateTime={new Date(person.createdAt).toISOString()}>{dateText(person.createdAt)}</time></TableCell>
                        <TableCell className="text-right">{you ? lastOwner ? <span className="text-muted-foreground">Last owner</span> : <Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmation({ kind: "leave" })}>Leave organisation</Button> : canEdit && <Button size="xs" variant="ghost" className="text-destructive" disabled={Boolean(busy) || protectedOwner} aria-label={`Remove ${person.user.email}`} onClick={() => setConfirmation({ kind: "remove", member: person })}>Remove</Button>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {lastOwner && <p className="text-xs text-muted-foreground">Make someone else an owner before you leave or change your role.</p>}
          {!members.isPending && !members.isError && !canManage && <p className="text-xs text-muted-foreground">Owners and admins manage roles and invitations.</p>}
        </section>

        {canManage && <>
          <section aria-labelledby="invite-people-title" className="grid max-w-2xl gap-3 border-t pt-6">
            <h2 id="invite-people-title" className="font-medium">Invite people</h2>
            <form onSubmit={(event) => void invite(event)} className="grid gap-3" noValidate>
              <Field><FieldLabel htmlFor="invite-emails">Emails</FieldLabel><Textarea id="invite-emails" value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="ana@example.com, sam@example.com" autoComplete="off" aria-describedby="invite-emails-help" disabled={Boolean(busy)} className="min-h-20 text-xs md:text-xs" /><FieldDescription id="invite-emails-help">Separate addresses with commas or new lines. Up to 20 people at once.</FieldDescription></Field>
              <div className="flex flex-wrap items-end gap-3"><Field className="w-40"><FieldLabel htmlFor="invite-role">Invitation role</FieldLabel><Select value={inviteRole} onValueChange={(value) => setRole(value as Role)} disabled={Boolean(busy)}><SelectTrigger id="invite-role" size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger><SelectContent>{ROLES.filter((value) => value !== "owner" || isOwner).map((value) => <SelectItem key={value} value={value}>{roleName(value)}</SelectItem>)}</SelectContent></Select></Field><Button type="submit" size="sm" disabled={Boolean(busy) || invitations.isPending || invitations.isError}>{busy === "invite" ? "Inviting…" : "Invite people"}</Button></div>
              {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
            </form>
            {results.length > 0 && <ul aria-label="Invitation results" aria-live="polite" className="grid min-w-0 gap-1 text-xs">{results.map((result, index) => <li key={`${index}:${result.email}`} className={result.sent ? "break-all text-muted-foreground" : "break-all text-destructive"}><span className="font-medium">{result.email}</span>: {result.message}</li>)}</ul>}
          </section>

          <section aria-labelledby="pending-invitations-title" className="grid min-w-0 gap-3 border-t pt-6">
            <h2 id="pending-invitations-title" className="font-medium">Pending invitations</h2>
            {invitations.isError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><p className="text-destructive">{errorText(invitations.error, "Couldn't load invitations.")}</p><Button size="xs" variant="outline" onClick={() => void invitations.refetch()}>Try again</Button></div> : (
              <div className="overflow-hidden rounded-md border" aria-busy={invitations.isPending}>
                <Table className="min-w-2xl text-xs">
                  <caption className="sr-only">Pending invitations for {org.name}</caption>
                  <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Invited by</TableHead><TableHead>Expires</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
                  <TableBody>{invitations.isPending ? <TableRow><TableCell colSpan={5}>Loading invitations…</TableCell></TableRow> : pending.length ? pending.map((invitation) => {
                    const inviter = people.find((person) => person.userId === invitation.inviterId);
                    const expired = new Date(invitation.expiresAt).getTime() <= invitations.dataUpdatedAt;
                    return <TableRow key={invitation.id}><TableCell className="max-w-72 whitespace-normal break-all">{invitation.email}</TableCell><TableCell>{roleName(invitation.role)}</TableCell><TableCell className="max-w-56 whitespace-normal break-words">{inviter?.user.name || inviter?.user.email || "Former member"}</TableCell><TableCell><time dateTime={new Date(invitation.expiresAt).toISOString()} title={new Date(invitation.expiresAt).toLocaleString()}>{expired ? "Expired" : dateText(invitation.expiresAt)}</time></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="xs" variant="outline" disabled={expired} aria-label={`Copy link for ${invitation.email}`} onClick={() => void copyLink(invitation)}><Copy className="size-3" /> Copy link</Button><Button size="xs" variant="ghost" disabled={Boolean(busy)} aria-label={`Cancel invitation for ${invitation.email}`} onClick={() => void cancel(invitation)}>Cancel</Button></div></TableCell></TableRow>;
                  }) : <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No pending invitations.</TableCell></TableRow>}</TableBody>
                </Table>
              </div>
            )}
            {manualLink && <Field className="max-w-2xl"><FieldLabel htmlFor="manual-invitation-link">Invitation link</FieldLabel><Input id="manual-invitation-link" readOnly value={manualLink} onFocus={(event) => event.target.select()} className="text-xs" /><FieldDescription>Select and copy this link.</FieldDescription></Field>}
          </section>
        </>}
      </div>

      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !busy) setConfirmation(null); }}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader><DialogTitle>{confirmation?.kind === "leave" ? "Leave organisation" : "Remove member"}</DialogTitle><DialogDescription className="break-words">{confirmation?.kind === "leave" ? `Leave ${org.name}? You will need another invitation to rejoin.` : `Remove ${confirmation?.kind === "remove" ? confirmation.member.user.email : "this person"} from ${org.name}?`}</DialogDescription></DialogHeader>
          <DialogFooter><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmation(null)}>Cancel</Button><Button size="sm" variant="destructive" disabled={Boolean(busy)} onClick={() => void confirmAction()}>{busy === "leave" || busy === "remove" ? "Saving…" : confirmation?.kind === "leave" ? "Leave organisation" : "Remove member"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MembersPage() {
  const me = useMe();
  const org = me.organizations.find((item) => item.id === me.session.activeOrganizationId);
  if (!org || org.id === me.personalOrgId) return <><PageHeader title="Members" description="Your personal workspace." /><p className="px-6 py-6 text-muted-foreground sm:px-8">This is your personal workspace, just for you. <Link href="/orgs/new" className="text-foreground underline underline-offset-4">Create an organisation</Link> to work with others.</p></>;
  return <OrganisationMembers key={org.id} org={org} />;
}
