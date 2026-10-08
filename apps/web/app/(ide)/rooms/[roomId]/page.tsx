import type { JoinResult, RoomSummary } from "@codechatter/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { RoomLoader } from "@/components/room/room-loader";
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

  // Not a member yet but holding an invite link: join, then load cleanly
  // (the token leaves the URL so it isn't kept in history or shared again).
  if (!room && invite) {
    const joined = await serverApiResult<JoinResult>("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code: roomId, inviteToken: invite }),
    });
    if (joined.data?.status === "joined") redirect(`/rooms/${roomId}`);
    if (joined.data?.status === "pending") return <Waiting roomName={joined.data.roomName} />;
    status = joined.status;
  }

  if (!room) {
    if (status === 404 || status === 400 || status === 403) notFound();
    throw new Error(`Couldn't load room ${roomId} (${status})`);
  }
  return <RoomLoader room={room} me={me} />;
}

function Waiting({ roomName }: { roomName: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="max-w-sm">
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Waiting to join {roomName}</h1>
        <p className="mt-2 text-muted-foreground">
          The owner approves new people for this room. You’ll get access as soon as they do; this page doesn’t need
          to stay open.
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/dashboard">Back to rooms</Link>
      </Button>
    </main>
  );
}
