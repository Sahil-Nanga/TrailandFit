"use client";

import { useSyncExternalStore } from "react";

import { METRIC, type Units } from "@aurora/measurements";

const STORAGE_KEY = "aurora.units";
const CHANGE_EVENT = "aurora:units";

// Used when browser storage is blocked, so the toggle still works for this page view.
let memoryRaw: string | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryRaw;
  }
}

let cache: { raw: string | null; units: Units } = { raw: null, units: METRIC };

function parse(raw: string | null): Units {
  if (raw === cache.raw) return cache.units;
  let units = METRIC;
  try {
    const saved = JSON.parse(raw ?? "null") as Partial<Units> | null;
    units = {
      length: saved?.length === "in" ? "in" : "cm",
      weight: saved?.weight === "lb" ? "lb" : "kg",
    };
  } catch {
    // Corrupt value: ignore it.
  }
  cache = { raw, units };
  return units;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function setStoredUnits(units: Units): void {
  memoryRaw = JSON.stringify(units);
  try {
    localStorage.setItem(STORAGE_KEY, memoryRaw);
  } catch {
    // Ignore; the preference just won't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The viewer's preferred units, remembered on this device only. Metric on the server. */
export function useUnits(): [Units, (units: Units) => void] {
  const units = useSyncExternalStore(subscribe, () => parse(readRaw()), () => METRIC);
  return [units, setStoredUnits];
}
