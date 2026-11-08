/** Manage active room owners and members, with explicit promotion and handover confirmations and a last-owner explanation. */
"use client";

import { assignableMemberRoles, type MemberRoleInput, type RoomPerson, type RoomRole } from "@codechatter/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PresenceAvatar, slotFor } from "@/components/presence/presence";
import { useRoomMembers } from "@/components/room/code-comments/notify";
import { useRoom } from "@/components/room/room-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";

import { peopleKey, useRoomPeople } from "./use-room-people";

type GivenRole = MemberRoleInput["role"];

const ROLE_LABEL: Record<string, string> = { owner: "Owner", editor: "Editor", runner: "Can run", viewer: "Viewer", interviewer: "Interviewer", candidate: "Candidate" };
const GIVEN_ROLES: GivenRole[] = ["editor", "runner", "viewer"];
const given = (role: string): GivenRole => (GIVEN_ROLES.includes(role as GivenRole) ? (role as GivenRole) : "viewer");

function RoleSelect<Role extends RoomRole>({ label, value, roles, disabled, onChange }: { label: string; value: Role; roles: readonly Role[]; disabled?: boolean; onChange: (role: Role) => void }) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(role) => onChange(role as Role)}>
      <SelectTrigger aria-label={label} size="sm" className="h-6 w-24 shrink-0 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role} className="text-xs">
            {ROLE_LABEL[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-3 border-t px-2 pt-3">
      <h3 className="px-2 text-xs font-medium text-muted-foreground">{title}</h3>
      {hint && <p className="mt-1 px-2 text-xs text-muted-foreground">{hint}</p>}
      <ul className="mt-1.5 grid gap-0.5">{children}</ul>
    </section>
  );
}

function Who({ person, detail }: { person: Pick<RoomPerson, "id" | "name" | "image">; detail?: string }) {
  return (
    <>
      <PresenceAvatar name={person.name} image={person.image} slot={slotFor(person.id)} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{person.name}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
    </>
  );
}

export function RoomMembers() {
  const { room, me } = useRoom();
  const router = useRouter();
  const client = useQueryClient();
  const { manages, people, loading, refreshing, error } = useRoomPeople();
  const everyone = useRoomMembers();
  const [asked, setAsked] = useState<Record<string, GivenRole>>({});
  const [confirm, setConfirm] = useState<{ title: string; body: string; yes: string; run?: () => void; handover?: boolean; management?: boolean } | null>(null);
  const [nextOwner, setNextOwner] = useState("");

  const act = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: "POST" | "PATCH" | "DELETE"; json?: unknown }) => api(`/api/rooms/${room.id}/${path}`, { method, ...(json !== undefined && { json }) }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: peopleKey(room.id) });
      void client.invalidateQueries({ queryKey: ["room-members", room.id] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.detail : "That didn't work. Try again."),
  });
  const leave = useMutation({
    mutationFn: () => api(`/api/rooms/${room.id}/leave`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`You left ${room.name}.`);
      router.push("/dashboard");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.detail : "Couldn't leave the room. Try again."),
  });

  if (room.kind === "interview") return null;
  const person = (id: string) => `people/${encodeURIComponent(id)}`;
  const iAmAMember = everyone.some((member) => member.id === me.user.id);
  const activeOwners = people?.members.filter((member) => member.role === "owner") ?? [];
  const myMembership = people?.members.find((member) => member.id === me.user.id);
  const owner = room.role === "owner" && myMembership?.role === "owner";
  const busy = act.isPending || leave.isPending;
  const canManage = Boolean(manages && owner && people && !error && !loading && !refreshing && !busy);
  const lastOwner = owner && activeOwners.length === 1;
  const canLeave = iAmAMember && (room.role !== "owner" || (owner && activeOwners.length > 1));
  const handoverCandidates = people?.members.filter((member) => member.id !== me.user.id) ?? [];
  const chosenOwner = handoverCandidates.find((member) => member.id === nextOwner);
  const memberRoles = assignableMemberRoles(room.role);

  function changeRole(member: RoomPerson, role: RoomRole) {
    if (!canManage || role === member.role) return;
    if (role === "owner") {
      setConfirm({
        title: `Make ${member.name} an owner?`,
        body: "An owner can delete this room, change everyone's role and remove anyone, including you.",
        yes: "Make owner",
        management: true,
        run: () => act.mutate({ path: person(member.id), method: "PATCH", json: { role: "owner" } }),
      });
    } else {
      act.mutate({ path: person(member.id), method: "PATCH", json: { role } });
    }
  }

  return (
    <>
      {manages && loading && <p role="status" className="px-4 py-2 text-xs text-muted-foreground">Loading room members…</p>}
      {manages && error && <p role="alert" className="px-4 py-2 text-xs text-muted-foreground">Couldn&apos;t refresh room members. Try again in a moment.</p>}
      {manages && Boolean(people?.waiting.length) && (
        <Section title="Waiting to join" hint="Check it's someone you expect before you let them in.">
          {people!.waiting.map((waiting) => (
            <li key={waiting.id} className="grid gap-1.5 rounded-md px-2 py-1.5">
              <div className="flex items-center gap-2.5">
                <Who person={waiting} detail={waiting.email} />
              </div>
              <div className="flex items-center gap-1.5">
                <RoleSelect
                  label={`Role for ${waiting.name}`}
                  value={asked[waiting.id] ?? given(waiting.role)}
                  roles={GIVEN_ROLES}
                  disabled={!canManage}
                  onChange={(role) => setAsked((current) => ({ ...current, [waiting.id]: role }))}
                />
                <Button
                  size="xs"
                  aria-label={`Approve ${waiting.name}`}
                  disabled={!canManage}
                  onClick={() => act.mutate({ path: `${person(waiting.id)}/approve`, method: "POST", json: { role: asked[waiting.id] ?? given(waiting.role) } })}
                >
                  Approve
                </Button>
                <Button size="xs" variant="ghost" aria-label={`Decline ${waiting.name}`} disabled={!canManage} onClick={() => act.mutate({ path: person(waiting.id), method: "DELETE" })}>
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </Section>
      )}

      {manages && people ? (
        <Section title="Members" hint="Editors change files and use terminals. Can run: runs code, no editing. Viewers look and chat.">
          {people.members.map((member) => (
            <li key={member.id} className="flex items-center gap-2.5 rounded-md px-2 py-1">
              <Who person={member} />
              <RoleSelect
                label={`Role of ${member.name}`}
                value={member.role}
                roles={member.id === me.user.id ? ["owner", "editor"] : memberRoles}
                disabled={!canManage || (member.role === "owner" && activeOwners.length <= 1)}
                onChange={(role) => changeRole(member, role)}
              />
              {member.id !== me.user.id && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${member.name}`}
                    title={`Remove ${member.name}`}
                    disabled={!canManage || (member.role === "owner" && activeOwners.length <= 1)}
                    onClick={() =>
                      setConfirm({
                        title: `Remove ${member.name} from this room?`,
                        body: "They lose access right away: their editor, terminals and place in the call all close, and the invite link stops working for them. You can let them back later. Anything they left running in the background keeps going until the sandbox restarts.",
                        yes: "Remove",
                        management: true,
                        run: () => act.mutate({ path: person(member.id), method: "DELETE" }),
                      })
                    }
                  >
                    <UserMinus />
                  </Button>
              )}
            </li>
          ))}
        </Section>
      ) : (
        everyone.length > 0 && (
          <Section title="Members">
            {everyone.map((member) => (
              <li key={member.id} className="flex items-center gap-2.5 rounded-md px-2 py-1">
                <Who person={member} />
                <span className="text-xs text-muted-foreground">{ROLE_LABEL[member.role] ?? member.role}</span>
              </li>
            ))}
          </Section>
        )
      )}

      {manages && Boolean(people?.removed.length) && (
        <Section title="Removed" hint="They can't join again, even with the link, until you let them back.">
          {people!.removed.map((removed) => (
            <li key={removed.id} className="flex items-center gap-2.5 rounded-md px-2 py-1">
              <Who person={removed} />
              <Button size="xs" variant="outline" aria-label={`Let ${removed.name} back`} disabled={!canManage} onClick={() => act.mutate({ path: `${person(removed.id)}/allow`, method: "POST" })}>
                Let back
              </Button>
            </li>
          ))}
        </Section>
      )}

      {owner && (
        <div className="mt-3 grid gap-2 border-t px-4 pt-3">
          {lastOwner && <p className="text-xs text-muted-foreground">Make someone else an owner before you step down or leave. You can still delete the room.</p>}
          <div><Button size="xs" variant="outline" disabled={!canManage || handoverCandidates.length === 0} onClick={() => { setNextOwner(""); setConfirm({ title: "Hand this room to someone else?", body: "They become an owner and you become an editor together. Other owners keep their role. An owner can delete the room, change everyone's role and remove anyone, including you.", yes: "Hand over room", handover: true, management: true }); }}>Hand this room to…</Button></div>
        </div>
      )}

      {canLeave && (
        <div className="mt-3 border-t px-4 pt-3">
          <Button
            variant="outline"
            size="xs"
            disabled={busy || (room.role === "owner" && !canManage)}
            onClick={() =>
              setConfirm({
                title: `Leave ${room.name}?`,
                body: "It leaves your rooms and your terminals here close. You can come back with an invite link.",
                yes: "Leave",
                run: () => leave.mutate(),
              })
            }
          >
            Leave room
          </Button>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.handover && <Select value={nextOwner} onValueChange={setNextOwner} disabled={!canManage}><SelectTrigger aria-label="New room owner"><SelectValue placeholder="Choose an active member" /></SelectTrigger><SelectContent>{handoverCandidates.map((member) => <SelectItem value={member.id} key={member.id}>{member.name}</SelectItem>)}</SelectContent></Select>}
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction disabled={busy || (confirm?.management && !canManage) || (confirm?.handover && !chosenOwner)} onClick={() => { if (confirm?.handover) { if (canManage && chosenOwner) act.mutate({ path: `${person(chosenOwner.id)}/handover`, method: "POST" }); } else confirm?.run?.(); }}>{confirm?.yes}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
