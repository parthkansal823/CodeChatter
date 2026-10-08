"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

function VerifyEmail() {
  const email = useSearchParams().get("email") ?? "";
  const [sending, setSending] = useState(false);

  async function resend() {
    setSending(true);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/dashboard" });
    setSending(false);
    if (error) toast.error(error.status === 429 ? "Please wait a few minutes before asking again." : "Couldn't send the email. Try again.");
    else toast.success("Sent. Check your inbox.");
  }

  return (
    <>
      <span className="inline-flex size-10 items-center justify-center rounded-md border">
        <MailCheck className="size-5" />
      </span>
      <h1 className="mt-6 font-wide text-2xl font-semibold tracking-[-0.02em]">Check your inbox</h1>
      <p className="mt-2 text-muted-foreground">
        We sent a link to {email ? <span className="font-medium text-foreground">{email}</span> : "your email"}. Open it
        to finish creating your account. The link works for 24 hours.
      </p>
      <div className="mt-8 grid gap-2">
        <Button variant="outline" onClick={resend} disabled={!email || sending}>
          {sending ? "Sending…" : "Send the link again"}
        </Button>
      </div>
      <p className="mt-8 text-muted-foreground">
        Wrong address?{" "}
        <Link href="/sign-up" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Start over
        </Link>
      </p>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
