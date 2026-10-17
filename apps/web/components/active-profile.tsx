"use client";

import type { MeasurementProfile } from "@aurora/api-client";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface ActiveProfileState {
  /** null while loading or signed out. */
  profiles: MeasurementProfile[] | null;
  active: MeasurementProfile | null;
  setActive: (id: string) => Promise<void>;
}

const Context = createContext<ActiveProfileState>({
  profiles: null,
  active: null,
  setActive: async () => undefined,
});

const CHANGED = "trialandfit:profiles-changed";

/** Call after creating, editing or deleting a profile so the header switcher refreshes. */
export function notifyProfilesChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Loads the user's profiles and the account's active profile (stored on the account, so the
 * extension uses the same one). Refreshes when notifyProfilesChanged() is called.
 */
export function ActiveProfileProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [version, setVersion] = useState(0);
  const [profiles, setProfiles] = useState<MeasurementProfile[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);

  useEffect(() => {
    if (auth.status !== "signed-in") return;
    let cancelled = false;
    void Promise.all([
      api.GET("/v1/profiles", { params: { query: { limit: 100 } } }).catch(() => null),
      api.GET("/v1/account/settings").catch(() => null),
    ]).then(([list, settings]) => {
      if (cancelled) return;
      setProfiles(list?.data?.items ?? []);
      setActiveId(settings?.data?.active_profile_id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, version]);

  const setActive = useCallback(async (id: string) => {
    setActiveId(id);
    await api.PATCH("/v1/account/settings", { body: { active_profile_id: id } });
  }, []);

  const visible = auth.status === "signed-in" ? profiles : null;
  // Fall back to the newest profile until the user picks one.
  const active = visible?.find((p) => p.id === activeId) ?? visible?.[0] ?? null;
  return <Context.Provider value={{ profiles: visible, active, setActive }}>{children}</Context.Provider>;
}

export function useActiveProfile(): ActiveProfileState {
  return useContext(Context);
}
