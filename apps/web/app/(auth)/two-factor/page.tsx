"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [backup, setBackup] = useState(false);

  async function verify(value = code) {
    if (pending || (backup ? !value.trim() : !/^\d{6}$/.test(value))) return;
    setPending(true);
    setError(null);
    try {
      const result = backup
        ? await authClient.twoFactor.verifyBackupCode({ code: value.trim(), trustDevice: trust })
        : await authClient.twoFactor.verifyTotp({ code: value, trustDevice: trust });
      if (result.error) {
        setError(result.error.status === 429 ? "Too many attempts. Wait a minute." : backup ? "That backup code didn't work. Each code can only be used once." : "That code didn't work. Codes change every 30 seconds.");
        setCode("");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch { setError("Couldn't connect. Check your connection and try again."); }
    finally { setPending(false); }
  }

  return (
    <>
      <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">{backup ? "Use a backup code" : "Enter your code"}</h1>
      <p className="mt-2 text-muted-foreground">{backup ? "Enter one of the backup codes you saved. Each code works once." : "Open your authenticator app and type the 6-digit code for CodeChatter."}</p>
      <div className="mt-8">
        {backup ? <div className="grid gap-2"><Label htmlFor="sign-in-backup-code">Backup code</Label><Input id="sign-in-backup-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={128} autoComplete="one-time-code" autoFocus className="font-mono" onKeyDown={(event) => { if (event.key === "Enter") void verify(); }} /></div> : <InputOTP
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
        </InputOTP>}
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
      <Button className="mt-8 w-full" disabled={(backup ? !code.trim() : !/^\d{6}$/.test(code)) || pending} onClick={() => verify()}>
        {pending ? "Checking…" : "Verify"}
      </Button>
      <Button className="mt-2 w-full" variant="ghost" disabled={pending} onClick={() => { setBackup(!backup); setCode(""); setError(null); }}>{backup ? "Use an authenticator code" : "Use a backup code"}</Button>
    </>
  );
}
