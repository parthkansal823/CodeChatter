"use client";

import type { CreatedRoom } from "@codechatter/contracts";
import { Check, Copy, Lock, Globe2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { TEMPLATES, type TemplateId } from "@/components/rooms/templates";
import { useCreateRoom } from "@/components/rooms/use-rooms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

type Visibility = "private" | "public";
type JoinPolicy = "invite" | "approval" | "open";

export function NewRoomDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedRoom | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCreated(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? <CreatedStep room={created} /> : <FormStep onCreated={setCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function FormStep({ onCreated }: { onCreated: (room: CreatedRoom) => void }) {
  const create = useCreateRoom();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("blank");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("invite");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Give the room a name.");
    setError(null);
    try {
      onCreated(await create.mutateAsync({ name: name.trim(), templateId, visibility, joinPolicy }));
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't create the room. Try again.");
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>New room</DialogTitle>
        <DialogDescription>Pick a starting point. You can add files and invite people once it’s open.</DialogDescription>
      </DialogHeader>

      <div className="mt-6 grid gap-5">
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="room-name">Name</FieldLabel>
          <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="checkout-service" autoFocus maxLength={80} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Template</legend>
          <div role="radiogroup" className="overflow-hidden rounded-md border">
            {TEMPLATES.map((template) => {
              const selected = template.id === templateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTemplateId(template.id)}
                  className={cn(
                    "relative flex w-full items-center gap-3 border-t px-3 py-2 text-left first:border-t-0 hover:bg-accent",
                    selected && "bg-accent",
                  )}
                >
                  {selected && <span aria-hidden className="absolute inset-y-1.5 left-0 w-thread rounded-full bg-brand" />}
                  <template.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block font-medium">{template.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{template.description}</span>
                  </span>
                  {selected && <Check className="ml-auto size-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Access</legend>
            <div role="radiogroup" className="grid grid-cols-2 rounded-md border p-0.5">
              {(["private", "public"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={visibility === value}
                  onClick={() => {
                    setVisibility(value);
                    if (value === "private") setJoinPolicy("invite");
                  }}
                  className={cn(
                    "flex h-7 items-center justify-center gap-1.5 rounded-sm text-sm text-muted-foreground",
                    visibility === value && "bg-primary text-primary-foreground",
                  )}
                >
                  {value === "private" ? <Lock className="size-3.5" /> : <Globe2 className="size-3.5" />}
                  {value === "private" ? "Private" : "Public"}
                </button>
              ))}
            </div>
          </fieldset>
          <Field>
            <FieldLabel htmlFor="join-policy">Who can join</FieldLabel>
            <Select value={joinPolicy} onValueChange={(v) => setJoinPolicy(v as JoinPolicy)} disabled={visibility === "private"}>
              <SelectTrigger id="join-policy" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invite">People with the invite link</SelectItem>
                <SelectItem value="approval">Anyone, after you approve</SelectItem>
                <SelectItem value="open">Anyone, as a viewer</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <DialogFooter className="mt-8">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create room"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CreatedStep({ room }: { room: CreatedRoom }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/rooms/${room.id}?invite=${room.inviteToken}`;

  async function copy() {
    if (!(await copyText(link))) return void toast.error("Couldn’t copy. Select the link and copy it by hand.");
    setCopied(true);
    toast.success("Invite link copied");
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{room.name} is ready</DialogTitle>
        <DialogDescription>
          Send this link to anyone you want in the room. They join as editors. You can change roles later.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-6 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-panel px-3 py-2 text-xs">{link}</code>
        <Button variant="outline" size="icon" onClick={copy} aria-label="Copy invite link">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Room code <span className="font-mono text-foreground">{room.id}</span>. The link is shown once; you can make a new one from the room.
      </p>
      <DialogFooter className="mt-8">
        <Button onClick={() => router.push(`/rooms/${room.id}` as never)}>Open room</Button>
      </DialogFooter>
    </>
  );
}
