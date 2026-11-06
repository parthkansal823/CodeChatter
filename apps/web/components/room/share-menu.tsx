/** Share, in the title bar: the room's code, its invite link for people who may invite, and how people join. */
"use client";

import type { RoomInviteLink } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

type JoinPolicy = "invite" | "approval" | "open";

export function ShareMenu() {
  const { room, can } = useRoom();
  const router = useRouter();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const usable = room.kind !== "interview";
  const invites = usable && can("room.invite");
  const manages = usable && can("room.manage");
  const key = ["room-invite-link", room.id] as const;

  const link = useQuery({
    queryKey: key,
    queryFn: () => api<RoomInviteLink>(`/api/rooms/${room.id}/invite-link`),
    enabled: open && invites,
    staleTime: 60_000,
  });
  const reset = useMutation({
    mutationFn: () => api<RoomInviteLink>(`/api/rooms/${room.id}/invite-link`, { method: "POST" }),
    onSuccess: (fresh) => {
      client.setQueryData(key, fresh);
      setOpen(true); // the confirmation closed the menu: show the new link, ready to copy
      toast.success("New invite link made. The old one no longer works.");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.detail : "Couldn't make a new link."),
  });
  const policy = useMutation({
    mutationFn: (joinPolicy: JoinPolicy) => api(`/api/rooms/${room.id}`, { method: "PATCH", json: { joinPolicy } }),
    onSuccess: () => router.refresh(),
    onError: (error) => toast.error(error instanceof ApiError ? error.detail : "Couldn't change who can join."),
  });

  const url = link.data ? `${window.location.origin}/rooms/${room.id}?invite=${link.data.token}` : null;
  const approves = room.joinPolicy === "approval";
  // "Anyone" means nothing in a private room: only the link gets people there.
  const shownPolicy: JoinPolicy = room.visibility === "private" && room.joinPolicy === "open" ? "invite" : room.joinPolicy;

  async function copy(text: string, what: string) {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.message(`${what}: ${text}`);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Link2 /> Share
          </Button>
        </PopoverTrigger>
        {/* The editor takes focus when it finishes loading: that shouldn't close this on someone who just opened it. Clicking elsewhere still does. */}
        <PopoverContent align="end" className="grid w-80 gap-3 text-xs" aria-label="Share this room" onFocusOutside={(event) => event.preventDefault()}>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-muted-foreground">
              Room code <span className="font-mono text-foreground">{room.id}</span>
            </span>
            <Button variant="ghost" size="icon-xs" aria-label="Copy room code" onClick={() => void copy(room.id, "Room code")}>
              <Copy />
            </Button>
          </div>

          {invites ? (
            <div className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <code data-testid="invite-link" className="min-w-0 flex-1 truncate rounded-md border bg-panel px-2 py-1">
                  {url ?? (link.isError ? "Couldn't load the link" : "Loading…")}
                </code>
                <Button variant="ghost" size="icon-xs" aria-label="Copy invite link" disabled={!url} onClick={() => url && void copy(url, "Invite link")}>
                  <Copy />
                </Button>
              </div>
              <p className="text-muted-foreground">
                {approves ? "People who open it wait for the owner to approve them." : "People who open it join as editors. The owner can change that in People."}
              </p>
            </div>
          ) : (
            usable && <p className="text-muted-foreground">Ask someone who can edit this room for an invite link.</p>
          )}

          {manages && (
            <div className="grid gap-2 border-t pt-3">
              <label className="grid gap-1 text-muted-foreground">
                Who can join
                <Select value={shownPolicy} disabled={policy.isPending} onValueChange={(value) => policy.mutate(value as JoinPolicy)}>
                  <SelectTrigger aria-label="Who can join" size="sm" className="h-7 w-full text-xs text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invite" className="text-xs">
                      People with the link
                    </SelectItem>
                    <SelectItem value="approval" className="text-xs">
                      {room.visibility === "private" ? "People with the link, after you approve" : "Anyone, after you approve"}
                    </SelectItem>
                    {room.visibility === "public" && (
                      <SelectItem value="open" className="text-xs">
                        Anyone, as a viewer
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </label>
              <Button variant="outline" size="xs" className="justify-self-start" disabled={reset.isPending} onClick={() => setConfirming(true)}>
                Make a new link
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make a new invite link?</AlertDialogTitle>
            <AlertDialogDescription>The old link stops working. Anyone already in the room stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => reset.mutate()}>Make a new link</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
