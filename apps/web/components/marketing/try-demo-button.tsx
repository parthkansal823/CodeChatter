"use client";

import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

/**
 * One click to a real room: the server makes a guest account and a guided
 * tour, signs you in and opens it. No sign-up, no email. If this server has
 * the demo switched off (or there's no API at all, as on a static showcase
 * site), it falls back to sign-up.
 */
export function TryDemoButton({ size = "lg", variant = "outline", label = "Try the demo" }: { size?: "lg" | "sm" | "default"; variant?: "outline" | "ghost" | "brand"; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    try {
      const { roomId } = await api<{ roomId: string }>("/api/demo/start", { method: "POST" });
      router.push(`/rooms/${roomId}` as never);
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.status === 429) toast.error(error.detail);
      else if (error instanceof ApiError && error.status !== 404) toast.error(error.detail || "The demo couldn't start. Try again.");
      else router.push("/sign-up");
    }
  }

  return (
    <Button size={size} variant={variant} onClick={() => void start()} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
      {pending ? "Opening your room…" : label}
    </Button>
  );
}
