"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** Accepts a room code (ABC123) or a full invite link and opens the room. */
export function JoinWithCode() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function join(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      if (url.origin === window.location.origin) return router.push(`${url.pathname}${url.search}` as never);
    } catch {
      // Not a URL: treat it as a room code.
    }
    router.push(`/rooms/${encodeURIComponent(trimmed.toUpperCase())}` as never);
  }

  return (
    // One focus ring for the whole control: the box outlines itself while the
    // field is focused; the bare input draws none of its own.
    <form
      onSubmit={join}
      className="flex h-11 items-center rounded-md border bg-background has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring"
    >
      <label htmlFor="join-code" className="sr-only">
        Room code or invite link
      </label>
      <input
        id="join-code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Room code or link"
        autoComplete="off"
        spellCheck={false}
        className="h-full w-48 min-w-0 bg-transparent pl-3 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
      />
      <Button type="submit" variant="ghost" className="h-full rounded-l-none border-l px-4 text-foreground">
        Join
      </Button>
    </form>
  );
}
