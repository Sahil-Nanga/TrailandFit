"use client";

import { errorMessage, type GarmentCategory, type SavedItem } from "@aurora/api-client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

export const CATEGORY_LABEL: Record<GarmentCategory, string> = {
  top: "Top",
  bottom: "Bottom",
  other: "Other",
};

export function shopName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type Load = { kind: "loading" } | { kind: "loaded"; items: SavedItem[] } | { kind: "error"; message: string };

/** All saved items (wardrobes are small; the API pages at 100). */
export function useWardrobe() {
  const [state, setState] = useState<Load>({ kind: "loading" });

  const load = useCallback(async (): Promise<Load> => {
    try {
      const items: SavedItem[] = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await api.GET("/v1/saved-items", { params: { query: { limit: 100, offset } } });
        if (!data) return { kind: "error", message: errorMessage(error, "Could not load your wardrobe.") };
        items.push(...data.items);
        if (items.length >= data.total || data.items.length === 0) break;
      }
      return { kind: "loaded", items };
    } catch {
      return { kind: "error", message: "Can't reach the server. Check your connection and try again." };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const replace = (item: SavedItem) =>
    setState((s) => (s.kind === "loaded" ? { ...s, items: s.items.map((i) => (i.id === item.id ? item : i)) } : s));
  const remove = (id: string) =>
    setState((s) => (s.kind === "loaded" ? { ...s, items: s.items.filter((i) => i.id !== id) } : s));

  return { state, replace, remove, reload: async () => setState(await load()) };
}
