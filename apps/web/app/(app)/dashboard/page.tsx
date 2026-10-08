"use client";

import { LogIn, Plus } from "lucide-react";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { JoinRoomDialog } from "@/components/rooms/join-room-dialog";
import { NewRoomDialog } from "@/components/rooms/new-room-dialog";
import { RoomsTable } from "@/components/rooms/rooms-table";
import { useRooms } from "@/components/rooms/use-rooms";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const me = useMe();
  const rooms = useRooms();
  const firstName = me.user.name.split(" ")[0];

  const actions = (
    <>
      <JoinRoomDialog
        trigger={
          <Button variant="outline">
            <LogIn /> Join
          </Button>
        }
      />
      <NewRoomDialog
        trigger={
          <Button>
            <Plus /> New room
          </Button>
        }
      />
    </>
  );

  return (
    <>
      <PageHeader title="Rooms" description={`Welcome back, ${firstName}. Pick up where you left off.`} actions={actions} />

      {rooms.isPending ? (
        <div className="grid gap-3 px-6 py-6 sm:px-8">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rooms.isError ? (
        <div className="px-6 py-16 text-center sm:px-8">
          <p className="font-medium">Couldn’t load your rooms.</p>
          <p className="mt-1 text-muted-foreground">Check your connection, then try again.</p>
          <Button variant="outline" className="mt-5" onClick={() => rooms.refetch()}>
            Try again
          </Button>
        </div>
      ) : rooms.data.length === 0 ? (
        <div className="mx-auto max-w-md px-6 py-20 text-center">
          <h2 className="font-wide text-xl font-semibold tracking-[-0.015em]">No rooms yet</h2>
          <p className="mt-2 text-muted-foreground">
            A room is a shared workspace: files, a terminal, chat and a sandbox to run code. Start one and send the
            link, or join a room someone shared with you.
          </p>
          <div className="mt-6 flex justify-center gap-2">{actions}</div>
        </div>
      ) : (
        <RoomsTable rooms={rooms.data} />
      )}
    </>
  );
}
