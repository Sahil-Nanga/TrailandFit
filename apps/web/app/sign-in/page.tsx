import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground">Welcome back.</p>
      </div>
      {/* Reads ?next= from the URL, which is request-time data. */}
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </div>
  );
}
