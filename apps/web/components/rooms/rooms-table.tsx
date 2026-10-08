"use client";

import type { RoomSummary } from "@codechatter/contracts";
import { Globe2, Lock, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { PresenceAvatar, slotFor } from "@/components/presence/presence";
import { templateName } from "@/components/rooms/templates";
import { useDeleteRoom } from "@/components/rooms/use-rooms";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/format";

const ROLE_LABEL: Record<RoomSummary["role"], string> = {
  owner: "Owner",
  editor: "Editor",
  runner: "Can run",
  viewer: "Viewer",
  interviewer: "Interviewer",
  candidate: "Candidate",
};

export function RoomsTable({ rooms }: { rooms: RoomSummary[] }) {
  const remove = useDeleteRoom();
  const [confirming, setConfirming] = useState<RoomSummary | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-2.5 pr-4 pl-6 font-normal sm:pl-8">Room</th>
              <th className="py-2.5 pr-4 font-normal">People</th>
              <th className="py-2.5 pr-4 font-normal">Access</th>
              <th className="py-2.5 pr-4 font-normal">Active</th>
              <th className="w-12 py-2.5 pr-6 sm:pr-8" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id} className="group relative border-b transition-colors hover:bg-accent/60">
                <td className="py-3 pr-4 pl-6 sm:pl-8">
                  {/* The whole row opens the room; the link sits on the name for a11y. */}
                  <Link href={`/rooms/${room.id}` as never} className="font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring">
                    {room.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{room.id}</span>
                    <span aria-hidden className="h-3 w-px bg-border" />
                    <span>{templateName(room.templateId)}</span>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-1">
                    {room.members.slice(0, 4).map((m) => (
                      <PresenceAvatar key={m.id} name={m.name} image={m.image} size={22} slot={slotFor(m.id)} />
                    ))}
                    {room.memberCount > 4 && <span className="ml-1 text-xs text-muted-foreground">+{room.memberCount - 4}</span>}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    {room.visibility === "private" ? <Lock className="size-3.5" /> : <Globe2 className="size-3.5" />}
                    {room.visibility === "private" ? "Private" : "Public"}
                  </span>
                  <div className="mt-0.5 text-xs text-muted-foreground">{ROLE_LABEL[room.role]}</div>
                </td>
                <td className="py-3 pr-4 text-muted-foreground">{formatRelativeTime(room.lastActiveAt)}</td>
                <td className="relative z-10 py-3 pr-6 text-right sm:pr-8">
                  {room.role === "owner" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${room.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirming(room)}>
                          <Trash2 className="size-4" /> Delete room
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirming?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its files, history and chat are deleted for everyone in the room. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep room</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const room = confirming!;
                remove.mutate(room.id, {
                  onSuccess: () => toast.success(`Deleted ${room.name}`),
                  onError: () => toast.error(`Couldn't delete ${room.name}. Try again.`),
                });
              }}
            >
              Delete room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
