/**
 * The sizes a shop offers for an item, joined with its size chart, and how much room each size
 * leaves on the user's body. Used by the extension (to save them) and the try-on page (to show
 * them on the 3D body).
 */
import type { Measurements } from "@aurora/api-client";

import { type Grid, parseSizeChart, type SizeChart, type SizeRow } from "./size-chart";
import { suggestSize } from "./size-match";

export interface StoreSizeOption {
  label: string;
  /** False when the shop shows it as sold out; null when the page doesn't say. */
  available: boolean | null;
}

export interface SizeOption extends StoreSizeOption {
  /** The size chart's row for this size, when the chart has one. */
  row: SizeRow | null;
}

/** Room a size leaves around the body, in cm of circumference (negative = smaller than you). */
export interface SizeEase {
  chest?: number;
  waist?: number;
  hips?: number;
  thigh?: number;
}

/** The chart worth saving from a page: body charts first, then the most measurements, then visible. */
export function chartFromTables(tables: { rows: Grid; visible: boolean; context?: string }[]): SizeChart | null {
  const charts = tables
    .map((t) => ({ chart: parseSizeChart(t.rows, t.context ?? ""), visible: t.visible }))
    .filter((c): c is { chart: SizeChart; visible: boolean } => c.chart !== null)
    .sort(
      (a, b) =>
        Number(b.chart.basis === "body") - Number(a.chart.basis === "body") ||
        b.chart.fields.length - a.chart.fields.length ||
        Number(b.visible) - Number(a.visible),
    );
  return charts[0]?.chart ?? null;
}

/** "m ", "M (38)", "Size M" -> "M"; "36/38" -> "36/38". */
export function sizeKey(label: string): string {
  return label
    .toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(SIZE|GRÖSSE|STORLEK|KOKO|EU|UK|US)\b/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

/** The shop's sizes in its order, each with its chart row; the chart's sizes if the shop listed none. */
export function sizeOptions(
  store: { label: string; available?: boolean | null }[] | null | undefined,
  chart: SizeChart | null | undefined,
): SizeOption[] {
  const rows = chart?.sizes ?? [];
  const rowFor = (label: string) => {
    const key = sizeKey(label);
    return rows.find((r) => sizeKey(r.label) === key) ?? null;
  };
  if (store && store.length > 0) {
    return store.map((s) => ({ label: s.label, available: s.available ?? null, row: rowFor(s.label) }));
  }
  return rows.map((row) => ({ label: row.label, available: null, row }));
}

/** The size the chart suggests for these measurements, if any. */
export function suggestedLabel(chart: SizeChart | null | undefined, measurements: Measurements): string | null {
  return chart ? (suggestSize(chart, measurements)?.label ?? null) : null;
}

// A regular fit has about this much room over the body measurements a size is made for.
export const REGULAR_EASE: Required<SizeEase> = { chest: 8, waist: 6, hips: 6, thigh: 4 };

/**
 * Room this size leaves on the user: the regular room for a body in the middle of the size's
 * range, plus how much smaller than that middle the user is. Only measurements both the chart
 * and the user have; thigh follows the hips when the chart doesn't give it.
 */
export function sizeEase(row: SizeRow | null, measurements: Measurements): SizeEase | null {
  if (!row) return null;
  const ease: SizeEase = {};
  const pairs = [
    ["chest", "chest_cm"],
    ["waist", "waist_cm"],
    ["hips", "hips_cm"],
    ["thigh", "thigh_cm"],
  ] as const;
  for (const [region, field] of pairs) {
    const range = row.ranges[field];
    const value = measurements[field];
    if (range && value != null) ease[region] = round1(REGULAR_EASE[region] + (range.min + range.max) / 2 - value);
  }
  if (ease.thigh === undefined && ease.hips !== undefined) ease.thigh = round1((ease.hips * REGULAR_EASE.thigh) / REGULAR_EASE.hips);
  return Object.keys(ease).length > 0 ? ease : null;
}

export type FitWord = "tight" | "snug" | "regular" | "loose" | "very loose";

/** One word for how a size fits, from its tightest region compared with a regular fit. */
export function fitWord(ease: SizeEase | null): FitWord | null {
  if (!ease) return null;
  const relative = (Object.keys(ease) as (keyof SizeEase)[]).map((r) => (ease[r] ?? 0) - REGULAR_EASE[r]);
  const tightest = Math.min(...relative);
  const loosest = Math.max(...relative);
  if (tightest < -REGULAR_EASE.waist) return "tight";
  if (tightest < -2.5) return "snug";
  if (loosest > 14) return "very loose";
  if (loosest > 5) return "loose";
  return "regular";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
