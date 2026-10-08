"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function verify(value = code) {
    if (value.length !== 6) return;
    setPending(true);
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code: value, trustDevice: trust });
    setPending(false);
    if (result.error) {
      setError(result.error.status === 429 ? "Too many attempts. Wait a minute." : "That code didn't work. Codes change every 30 seconds.");
      setCode("");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <>
      <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Enter your code</h1>
      <p className="mt-2 text-muted-foreground">Open your authenticator app and type the 6-digit code for CodeChatter.</p>
      <div className="mt-8">
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          onComplete={(value) => verify(value)}
          autoFocus
          aria-label="6-digit code"
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex items-center gap-2">
        <Checkbox id="trust" checked={trust} onCheckedChange={(v) => setTrust(v === true)} />
        <Label htmlFor="trust" className="font-normal text-muted-foreground">
          Don’t ask again on this device for 30 days
        </Label>
      </div>
      <Button className="mt-8 w-full" disabled={code.length !== 6 || pending} onClick={() => verify()}>
        {pending ? "Checking…" : "Verify"}
      </Button>
    </>
  );
}
