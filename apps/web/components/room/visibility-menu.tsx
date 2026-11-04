"use client";

import { Check, Globe2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, ApiError } from "@/lib/api";

const CHOICES = [
  { value: "private", icon: Lock, label: "Private", hint: "Only people in the room can open it." },
  { value: "public", icon: Globe2, label: "Public", hint: "Anyone signed in can look (read-only) and fork it; it's listed in Explore." },
] as const;

/**
 * Who can see the room, beside its code in the title bar: the lock or the globe. People
 * who manage the room can switch it; for everyone else it only says which it is.
 */
export function VisibilityMenu() {
  const { room, can } = useRoom();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const current = CHOICES.find((choice) => choice.value === room.visibility) ?? CHOICES[0];
  const Icon = current.icon;

  if (!can("room.manage")) return <Icon aria-label={`${current.label} room`} className="size-3.5 text-muted-foreground" />;

  async function choose(visibility: "private" | "public") {
    if (visibility === room.visibility) return;
    setBusy(true);
    try {
      await api(`/api/rooms/${room.id}`, { method: "PATCH", json: { visibility } });
      toast.success(visibility === "public" ? "The room is public: anyone signed in can look and fork it." : "The room is private again.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.detail : "Couldn't change who can see the room.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${current.label} room: change who can see it`}
        disabled={busy}
        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Icon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-xs">Who can see this room</DropdownMenuLabel>
        {CHOICES.map((choice) => (
          <DropdownMenuItem key={choice.value} onSelect={() => void choose(choice.value)} className="items-start gap-2">
            <choice.icon className="mt-0.5 size-3.5" />
            <span className="grid flex-1 gap-0.5">
              <span className="text-xs font-medium">{choice.label}</span>
              <span className="text-xs text-muted-foreground">{choice.hint}</span>
            </span>
            {choice.value === room.visibility && <Check className="mt-0.5 size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
