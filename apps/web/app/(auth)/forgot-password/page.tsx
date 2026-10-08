"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const Schema = z.object({ email: z.email("Enter a valid email address.") });

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ email }: z.infer<typeof Schema>) {
    // The answer is the same whether or not the account exists, so this page
    // can't be used to discover who has an account.
    await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <>
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Check your inbox</h1>
        <p className="mt-2 text-muted-foreground">
          If <span className="font-medium text-foreground">{sentTo}</span> has an account, a reset link is on its way. It
          expires in one hour.
        </p>
        <Button variant="outline" className="mt-8 w-full" asChild>
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Reset your password</h1>
      <p className="mt-2 text-muted-foreground">Enter your email and we’ll send you a link to choose a new one.</p>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="mt-8">
        <FieldGroup className="gap-5">
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={Boolean(errors.email)} {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-8 text-muted-foreground">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Sign in
        </Link>
      </p>
    </>
  );
}
