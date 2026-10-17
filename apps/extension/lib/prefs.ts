import { METRIC, type Units } from "@aurora/measurements";

const KEY = "aurora.prefs";

export interface Prefs {
  units: Units;
  profileId: string | null;
}

export async function loadPrefs(): Promise<Prefs> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Prefs> | undefined;
  return {
    units: {
      length: stored?.units?.length === "in" ? "in" : "cm",
      weight: stored?.units?.weight === "lb" ? "lb" : "kg",
    },
    profileId: typeof stored?.profileId === "string" ? stored.profileId : null,
  };
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await browser.storage.local.set({ [KEY]: prefs });
}

export const DEFAULT_PREFS: Prefs = { units: METRIC, profileId: null };
