"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNext } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase/client";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
});
type Values = z.infer<typeof schema>;

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(
    params.get("error") === "confirm" ? "That confirmation link is invalid or has expired." : null,
  );
  const [checkEmail, setCheckEmail] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched" });
  const { errors, isSubmitting } = form.formState;

  async function submit({ email, password }: Values) {
    setError(null);
    const auth = getSupabase().auth;
    if (mode === "sign-in") {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
        return;
      }
    } else {
      const { data, error } = await auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
      });
      if (error) {
        setError(error.message);
        return;
      }
      if (!data.session) {
        // Email confirmation is on (typical for Supabase Cloud).
        setCheckEmail(true);
        return;
      }
    }
    router.replace(next);
    router.refresh();
  }

  if (checkEmail) {
    return (
      <Alert role="status">
        <MailCheck aria-hidden />
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>We sent you a link to confirm your account.</AlertDescription>
      </Alert>
    );
  }

  const isSignUp = mode === "sign-up";
  const other = isSignUp ? "/sign-in" : "/sign-up";
  const query = params.get("next") ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "email-error" : undefined}
          {...form.register("email")}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={["password-help", errors.password && "password-error"].filter(Boolean).join(" ")}
          {...form.register("password")}
        />
        {isSignUp && (
          <p id="password-help" className="text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        )}
        {errors.password && (
          <p id="password-error" className="text-sm text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? "Already have an account? " : "New here? "}
        <Link href={`${other}${query}`} className="font-medium text-foreground underline underline-offset-4">
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
