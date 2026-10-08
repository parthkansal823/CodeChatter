"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useJoinRoom } from "@/components/rooms/use-rooms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";

/** "ABC123" or a full link like https://…/rooms/ABC123?invite=… */
function parse(value: string): { code: string; inviteToken?: string } | null {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const code = url.pathname.split("/").filter(Boolean).at(-1)?.toUpperCase();
    const inviteToken = url.searchParams.get("invite") ?? undefined;
    return code ? { code, ...(inviteToken && { inviteToken }) } : null;
  } catch {
    return /^[A-Za-z0-9]{6}$/.test(trimmed) ? { code: trimmed.toUpperCase() } : null;
  }
}

export function JoinRoomDialog({ trigger }: { trigger: ReactNode }) {
  const router = useRouter();
  const join = useJoinRoom();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const target = parse(value);
    if (!target) return setError("Paste an invite link or type a 6-character room code.");
    setError(null);
    try {
      const result = await join.mutateAsync(target);
      setOpen(false);
      setValue("");
      if (result.status === "pending") {
        toast.message(`Asked to join ${result.roomName}`, { description: "You’ll get in once the owner approves." });
      } else {
        router.push(`/rooms/${result.room.id}` as never);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't join that room. Try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Join a room</DialogTitle>
            <DialogDescription>Paste the invite link someone sent you, or type the room code.</DialogDescription>
          </DialogHeader>
          <Field className="mt-6" data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="join-value">Invite link or room code</FieldLabel>
            <Input id="join-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ABC123" className="font-mono" autoFocus />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </Field>
          <DialogFooter className="mt-8">
            <Button type="submit" disabled={join.isPending || !value.trim()}>
              {join.isPending ? "Joining…" : "Join room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
