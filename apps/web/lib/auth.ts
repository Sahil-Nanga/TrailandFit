"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { getSupabase } from "@/lib/supabase/client";

/** Current access token for API calls, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export type AuthState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: User };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  useEffect(() => {
    const supabase = getSupabase();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: "signed-in", user: session.user } : { status: "signed-out" });
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

/** Only allow same-site relative paths as post-sign-in destinations. */
export function safeNext(next: string | null | undefined, fallback = "/profiles"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}

export function signInUrl(next: string): string {
  return `/sign-in?next=${encodeURIComponent(next)}`;
}
