"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase/client";

const linkClass =
  "rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function AuthNav() {
  const auth = useAuth();
  const router = useRouter();

  if (auth.status === "loading") return <span className="h-7 w-24" aria-hidden />;

  if (auth.status === "signed-out") {
    return (
      <Link href="/sign-in" className={linkClass}>
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link href="/profiles" className={linkClass}>
        My profiles
      </Link>
      <button
        type="button"
        className={linkClass}
        onClick={async () => {
          await getSupabase().auth.signOut();
          router.push("/");
          router.refresh();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
