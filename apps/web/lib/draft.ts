"use client";

import type { Measurements } from "@aurora/api-client";
import { useMemo, useSyncExternalStore } from "react";

/**
 * Unsaved form values kept in this tab's sessionStorage while the user signs in, so they do
 * not have to type everything again. Cleared after saving; never sent anywhere.
 */
export interface Draft {
  name: string;
  measurements: Measurements;
  source?: "manual" | "photo" | "photo_edited";
  confidence?: Record<string, number> | null;
}

const EVENT = "aurora:draft";

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: Draft): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage blocked: the user will retype after signing in.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useDraft(key: string): Draft | null {
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  return useMemo(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Draft;
    } catch {
      return null;
    }
  }, [raw]);
}
