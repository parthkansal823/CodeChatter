import type { JoinResult, RoomSummary } from "@codechatter/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { RoomLoader } from "@/components/room/room-loader";
import { RefreshWhileWaiting } from "@/components/rooms/refresh-while-waiting";
import { Button } from "@/components/ui/button";
import type { Me } from "@/lib/me";
import { serverApi, serverApiResult } from "@/lib/server-api";

type Params = { params: Promise<{ roomId: string }>; searchParams: Promise<{ invite?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { roomId } = await params;
  return { title: roomId.toUpperCase() };
}

export default async function RoomPage({ params, searchParams }: Params) {
  const [{ roomId: raw }, { invite }] = await Promise.all([params, searchParams]);
  const roomId = raw.toUpperCase();
  const back = `/rooms/${roomId}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;

  const me = await serverApi<Me>("/api/me");
  if (!me) redirect(`/sign-in?returnTo=${encodeURIComponent(back)}`);

  let { status, data: room } = await serverApiResult<RoomSummary>(`/api/rooms/${roomId}`);

  // Holding an invite link: join, then load cleanly (the token leaves the URL so it isn't kept
  // in history or shared again). A public room can be looked at without joining, but the link
  // is still how you become a member of it.
  if (invite) {
    const joined = await serverApiResult<JoinResult>("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code: roomId, inviteToken: invite }),
    });
    if (joined.data?.status === "joined") redirect(`/rooms/${roomId}`);
    if (joined.data?.status === "pending") return <Waiting roomName={joined.data.roomName} />;
    if (room) redirect(`/rooms/${roomId}`); // anyone may look at a public room, whatever came of the link
    if (joined.data?.status === "refused") return <Refused roomName={joined.data.roomName} />;
    status = joined.status;
  }

  if (!room) {
    if (status === 404 || status === 400 || status === 403) notFound();
    throw new Error(`Couldn't load room ${roomId} (${status})`);
  }
  return <RoomLoader room={room} me={me} />;
}

function Refused({ roomName }: { roomName: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="max-w-sm">
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">You can’t join {roomName}</h1>
        <p className="mt-2 text-muted-foreground">The owner removed you from this room or declined your request. Ask them if you think that’s a mistake.</p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/dashboard">Back to rooms</Link>
      </Button>
    </main>
  );
}

function Waiting({ roomName }: { roomName: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <RefreshWhileWaiting />
      <Logo />
      <div className="max-w-sm">
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Waiting to join {roomName}</h1>
        <p className="mt-2 text-muted-foreground">
          The owner approves new people for this room. The room opens here as soon as they do. You can also leave
          this page: you’ll get a notification.
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/dashboard">Back to rooms</Link>
      </Button>
    </main>
  );
}
