"use client";

import type { ExploreRoom } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { GitFork, Search, Users } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { PageHeader } from "@/components/app/app-shell";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

/**
 * Explore: the public rooms, most recently active first, searchable by name or
 * description. Opening one is read-only for anyone who isn't in it; Fork, in the room,
 * makes a copy of its code that's yours.
 */
export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const rooms = useQuery({
    queryKey: ["explore", q],
    queryFn: () => api<{ rooms: ExploreRoom[] }>(`/api/rooms/explore${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.rooms),
  });

  return (
    <>
      <PageHeader title="Explore" description="Public rooms: open one to look around, or fork it to make it yours." />
      <div className="grid gap-4 px-6 py-6 sm:px-8">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search public rooms" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or description" className="pl-8" />
        </div>
        {!rooms.data ? (
          rooms.isError ? (
            <p className="text-sm text-muted-foreground">Couldn’t load the public rooms. Try again.</p>
          ) : (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          )
        ) : rooms.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{q ? `No public room matches “${q}”.` : "No public rooms yet. Make one public from its title bar (the lock beside its code)."}</p>
        ) : (
          <ul aria-label="Public rooms" className="grid gap-2">
            {rooms.data.map((room) => (
              <li key={room.id}>
                <Link href={`/rooms/${room.id}` as never} className="grid gap-1 rounded-md border bg-card px-4 py-3 transition-colors hover:border-foreground/30">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{room.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{room.id}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">active {formatRelativeTime(room.lastActiveAt)}</span>
                  </span>
                  {room.description && <span className="line-clamp-2 text-sm text-muted-foreground">{room.description}</span>}
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {room.owner && <span>by {room.owner}</span>}
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" /> {room.memberCount}
                    </span>
                    {room.forkedFrom && (
                      <span className="flex items-center gap-1">
                        <GitFork className="size-3.5" /> from {room.forkedFrom.name}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
