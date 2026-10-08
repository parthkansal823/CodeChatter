import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="max-w-sm">
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Nothing here</h1>
        <p className="mt-2 text-muted-foreground">
          This page or room doesn’t exist, or you don’t have access to it. If someone shared a room with you, ask
          them for a fresh invite link.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Go to your rooms</Link>
      </Button>
    </main>
  );
}
