import { errorMessage, type MeasurementProfile, type Measurements } from "@aurora/api-client";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, supabase } from "./client";

export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/** Signed-in user's active Trialandfit profile, and saving adjusted numbers back to it. */
export function useAccount(onProfileLoaded?: (profile: MeasurementProfile) => void) {
  const onLoaded = useRef(onProfileLoaded);
  useEffect(() => {
    onLoaded.current = onProfileLoaded;
  });
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  const [profile, setProfile] = useState<MeasurementProfile | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void Promise.all([
      api.GET("/v1/profiles", { params: { query: { limit: 100 } } }),
      api.GET("/v1/account/settings"),
    ]).then(([list, settings]) => {
      if (cancelled) return;
      const items = list.data?.items ?? [];
      const activeId = settings.data?.active_profile_id;
      const active = items.find((p) => p.id === activeId) ?? items[0] ?? null;
      setProfile(active);
      if (active) onLoaded.current?.(active);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const saveMeasurements = useCallback(
    async (measurements: Partial<Measurements>) => {
      if (!profile) return;
      setSave({ kind: "saving" });
      // Keep the profile's other fields (neck, sleeve, thigh...) and replace the edited ones.
      const merged: Measurements = { ...profile.measurements, ...measurements };
      const { data, error } = await api.PATCH("/v1/profiles/{profile_id}", {
        params: { path: { profile_id: profile.id } },
        body: { measurements: merged },
      });
      if (data) {
        setProfile(data);
        setSave({ kind: "saved" });
      } else {
        setSave({ kind: "error", message: errorMessage(error, "Could not save. Please try again.") });
      }
    },
    [profile],
  );

  return {
    available: supabase !== null,
    session: session ?? null,
    loading: session === undefined,
    profile,
    save,
    saveMeasurements,
    resetSave: () => setSave({ kind: "idle" }),
    signIn: async (email: string, password: string) => {
      const result = await supabase?.auth.signInWithPassword({ email, password });
      return result?.error ? (result.error.message === "Invalid login credentials" ? "Wrong email or password." : result.error.message) : null;
    },
    signOut: async () => {
      await supabase?.auth.signOut();
      setProfile(null);
    },
  };
}
