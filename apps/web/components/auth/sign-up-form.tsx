"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { SocialButtons } from "@/components/auth/social-buttons";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const Schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Keep it under 80 characters."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(128, "Keep it under 128 characters."),
});
type Values = z.infer<typeof Schema>;

export function SignUpForm({
  returnTo,
  google,
  github,
  showUnconfigured,
}: {
  returnTo: string;
  google: boolean;
  github: boolean;
  showUnconfigured: boolean;
}) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: { name: "", email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;
  const password = useWatch({ control: form.control, name: "password" });

  async function onSubmit(values: Values) {
    const { error } = await authClient.signUp.email({ ...values, callbackURL: returnTo });
    if (!error) {
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}` as never);
      return;
    }
    form.setError(error.code === "USER_ALREADY_EXISTS" ? "email" : "root", {
      message:
        error.code === "USER_ALREADY_EXISTS"
          ? "An account with this email already exists. Sign in instead."
          : error.status === 429
            ? "Too many sign-ups from this network. Try again later."
            : (error.message ?? "Couldn't create the account. Try again."),
    });
  }

  return (
    <>
      <h1 className="font-wide text-[28px] leading-tight font-semibold tracking-[-0.025em]">Create your account</h1>
      <p className="mt-2 text-muted-foreground">Start a room, send the link, and code together.</p>

      <div className="mt-8">
        <SocialButtons google={google} github={github} returnTo={returnTo} showUnconfigured={showUnconfigured} />
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="mt-5">
        <FieldGroup className="gap-4">
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" autoComplete="name" placeholder="Ada Lovelace" className="h-10" aria-invalid={Boolean(errors.name)} {...form.register("name")} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={Boolean(errors.email)}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className="h-10"
              aria-invalid={Boolean(errors.email)}
              {...form.register("email")}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={Boolean(errors.password)}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
              className="h-10"
              aria-invalid={Boolean(errors.password)}
              {...form.register("password")}
            />
            {errors.password ? (
              <FieldError errors={[errors.password]} />
            ) : password ? (
              <PasswordStrength password={password} />
            ) : (
              <FieldDescription>A short sentence you’ll remember works well.</FieldDescription>
            )}
          </Field>
          {errors.root && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" className="mt-1 h-10 w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            By creating an account you agree to the Terms and Privacy Policy. We’ll email you a link to confirm your
            address.
          </p>
        </FieldGroup>
      </form>

      <p className="mt-8 text-center text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Sign in
        </Link>
      </p>
    </>
  );
}
