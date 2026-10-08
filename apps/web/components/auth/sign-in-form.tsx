"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PasswordInput } from "@/components/auth/password-input";
import { SocialButtons } from "@/components/auth/social-buttons";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { TryDemoButton } from "@/components/marketing/try-demo-button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const Schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type Values = z.infer<typeof Schema>;

export function SignInForm({
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
  const form = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: Values) {
    const { error } = await authClient.signIn.email({ ...values, callbackURL: returnTo, rememberMe: true });
    if (!error) {
      router.replace(returnTo as never);
      router.refresh();
      return;
    }
    if (error.code === "EMAIL_NOT_VERIFIED") {
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}` as never);
      return;
    }
    form.setError("root", {
      message:
        error.status === 429
          ? "Too many attempts. Wait a minute, then try again."
          : error.code === "INVALID_EMAIL_OR_PASSWORD"
            ? "That email and password don't match."
            : (error.message ?? "Couldn't sign in. Try again."),
    });
  }

  return (
    <>
      <h1 className="font-wide text-[28px] leading-tight font-semibold tracking-[-0.025em]">Welcome back</h1>
      <p className="mt-2 text-muted-foreground">Sign in to pick up where you left off.</p>

      <div className="mt-8">
        <SocialButtons google={google} github={github} returnTo={returnTo} showUnconfigured={showUnconfigured} />
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="mt-5">
        <FieldGroup className="gap-4">
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
            <div className="flex items-center">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link href="/forgot-password" className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="Your password"
              className="h-10"
              aria-invalid={Boolean(errors.password)}
              {...form.register("password")}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          {errors.root && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-destructive">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" className="mt-1 h-10 w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-8 text-center text-muted-foreground">
        New to CodeChatter?{" "}
        <Link
          href={`/sign-up${returnTo !== "/dashboard" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}` as never}
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          Create an account
        </Link>
      </p>
      <div className="mt-3 flex justify-center">
        <TryDemoButton size="sm" variant="ghost" label="Just looking? Try the demo" />
      </div>
    </>
  );
}
