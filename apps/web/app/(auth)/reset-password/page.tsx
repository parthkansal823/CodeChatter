"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

const Schema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters.").max(128, "Keep it under 128 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords don't match." });

function ResetPassword() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const form = useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema), defaultValues: { password: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;

  if (!token || params.get("error")) {
    return (
      <>
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">This link has expired</h1>
        <p className="mt-2 text-muted-foreground">Reset links work once and for one hour. Ask for a new one.</p>
        <Button className="mt-8 w-full" asChild>
          <Link href="/forgot-password">Send a new link</Link>
        </Button>
      </>
    );
  }

  async function onSubmit({ password }: z.infer<typeof Schema>) {
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    if (error) {
      form.setError("root", { message: "This link has expired or was already used. Ask for a new one." });
      return;
    }
    toast.success("Password changed. Sign in with your new password.");
    router.replace("/sign-in");
  }

  return (
    <>
      <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">Choose a new password</h1>
      <p className="mt-2 text-muted-foreground">You’ll be signed out everywhere else once it’s changed.</p>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="mt-8">
        <FieldGroup className="gap-5">
          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <PasswordInput id="password" autoComplete="new-password" autoFocus aria-invalid={Boolean(errors.password)} {...form.register("password")} />
            {errors.password ? <FieldError errors={[errors.password]} /> : <FieldDescription>At least 10 characters.</FieldDescription>}
          </Field>
          <Field data-invalid={Boolean(errors.confirm)}>
            <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
            <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={Boolean(errors.confirm)} {...form.register("confirm")} />
            <FieldError errors={[errors.confirm]} />
          </Field>
          {errors.root && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Change password"}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
