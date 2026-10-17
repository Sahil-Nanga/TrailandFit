import type { MeasurementProfile } from "@aurora/api-client";
import { suggestFromTables } from "@aurora/measurements";

import { api } from "@/lib/api";
import { originPattern, type SuggestRequest, type SuggestResponse } from "@/lib/messages";
import { supabase } from "@/lib/supabase";

const CARD_SCRIPT = "/size-card.js";
const PROFILE_CACHE_MS = 60_000;

let cachedProfiles: { at: number; userId: string; items: MeasurementProfile[] } | null = null;

async function activeProfile(): Promise<MeasurementProfile | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  if (!cachedProfiles || cachedProfiles.userId !== userId || Date.now() - cachedProfiles.at > PROFILE_CACHE_MS) {
    const result = await api.GET("/v1/profiles", { params: { query: { limit: 100 } } }).catch(() => null);
    if (!result?.data) return null;
    cachedProfiles = { at: Date.now(), userId, items: result.data.items };
  }
  const settings = await api.GET("/v1/account/settings").catch(() => null);
  const activeId = settings?.data?.active_profile_id ?? null;
  return cachedProfiles.items.find((p) => p.id === activeId) ?? cachedProfiles.items[0] ?? null;
}

/** Match page tables against the active profile here, so measurements never reach the page. */
async function suggest(request: SuggestRequest): Promise<SuggestResponse> {
  const profile = await activeProfile();
  if (!profile) return { kind: "none" };
  const result = suggestFromTables(request.tables, profile.measurements);
  if (result.kind === "garment-only") return { kind: "garment-only" };
  if (result.kind === "missing-measurements") {
    // Only which measurements are needed, never values.
    return { kind: "missing-measurements", needed: result.needed, profileName: profile.name };
  }
  if (result.kind !== "suggestion") return { kind: "none" };
  const { suggestion } = result;
  return {
    kind: "suggestion",
    label: suggestion.label,
    fits: suggestion.fits.map(({ field, status }) => ({ field, status })),
    alternative: suggestion.alternative,
    quality: suggestion.quality,
    profileName: profile.name,
  };
}

async function hasSiteAccess(url: string | undefined): Promise<boolean> {
  const pattern = url ? originPattern(url) : null;
  return pattern ? browser.permissions.contains({ origins: [pattern] }) : false;
}

async function injectCard(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CARD_SCRIPT] });
  } catch {
    // Page can't be scripted (browser page, store page, or access was just removed).
  }
}

export default defineBackground(() => {
  // Approved shops only: when a page finishes loading, add the suggestion card script.
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    void hasSiteAccess(tab.url).then((allowed) => {
      if (allowed) void injectCard(tabId);
    });
  });

  // Right after the user opts in to a shop, show the card on the tab they're looking at.
  browser.permissions.onAdded.addListener(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (tab?.id !== undefined && (await hasSiteAccess(tab.url))) await injectCard(tab.id);
    });
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    const request = message as Partial<SuggestRequest> | undefined;
    if (request?.type !== "aurora:suggest" || !Array.isArray(request.tables)) return undefined;
    return suggest(request as SuggestRequest);
  });

  // Signing out or switching accounts must not show someone else's suggestions.
  supabase.auth.onAuthStateChange(() => {
    cachedProfiles = null;
  });
});
