/** Who belongs to the room, under who's here now. The owner approves people, changes roles and removes them; others can leave. */
"use client";

import type { MemberRoleInput, RoomPerson } from "@codechatter/contracts";
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

function RoleSelect({ label, value, disabled, onChange }: { label: string; value: GivenRole; disabled?: boolean; onChange: (role: GivenRole) => void }) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(role) => onChange(role as GivenRole)}>
      <SelectTrigger aria-label={label} size="sm" className="h-6 w-24 shrink-0 px-2 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GIVEN_ROLES.map((role) => (
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
  const { manages, people } = useRoomPeople();
  const everyone = useRoomMembers();
  const [asked, setAsked] = useState<Record<string, GivenRole>>({});
  const [confirm, setConfirm] = useState<{ title: string; body: string; yes: string; run: () => void } | null>(null);

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
  const canLeave = iAmAMember && room.role !== "owner";

  return (
    <>
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
                  onChange={(role) => setAsked((current) => ({ ...current, [waiting.id]: role }))}
                />
                <Button
                  size="xs"
                  aria-label={`Approve ${waiting.name}`}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ path: `${person(waiting.id)}/approve`, method: "POST", json: { role: asked[waiting.id] ?? given(waiting.role) } })}
                >
                  Approve
                </Button>
                <Button size="xs" variant="ghost" aria-label={`Decline ${waiting.name}`} disabled={act.isPending} onClick={() => act.mutate({ path: person(waiting.id), method: "DELETE" })}>
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
              {member.role === "owner" ? (
                <span className="text-xs text-muted-foreground">Owner</span>
              ) : (
                <>
                  <RoleSelect
                    label={`Role of ${member.name}`}
                    value={given(member.role)}
                    disabled={act.isPending}
                    onChange={(role) => act.mutate({ path: person(member.id), method: "PATCH", json: { role } })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${member.name}`}
                    title={`Remove ${member.name}`}
                    disabled={act.isPending}
                    onClick={() =>
                      setConfirm({
                        title: `Remove ${member.name} from this room?`,
                        body: "They lose access right away: their editor, terminals and place in the call all close, and the invite link stops working for them. You can let them back later. Anything they left running in the background keeps going until the sandbox restarts.",
                        yes: "Remove",
                        run: () => act.mutate({ path: person(member.id), method: "DELETE" }),
                      })
                    }
                  >
                    <UserMinus />
                  </Button>
                </>
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
              <Button size="xs" variant="outline" aria-label={`Let ${removed.name} back`} disabled={act.isPending} onClick={() => act.mutate({ path: `${person(removed.id)}/allow`, method: "POST" })}>
                Let back
              </Button>
            </li>
          ))}
        </Section>
      )}

      {canLeave && (
        <div className="mt-3 border-t px-4 pt-3">
          <Button
            variant="outline"
            size="xs"
            disabled={leave.isPending}
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
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm?.run()}>{confirm?.yes}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
