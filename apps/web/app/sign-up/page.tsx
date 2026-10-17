import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-sm space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground">Save your measurements and use them anywhere you shop.</p>
      </div>
      {/* Reads ?next= from the URL, which is request-time data. */}
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </div>
  );
}
