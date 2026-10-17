/**
 * Suggest a size by comparing the user's measurements with a parsed size chart.
 * Runs entirely on the user's device; nothing is sent anywhere.
 */
import type { MeasurementField, Measurements } from "@aurora/api-client";

import { classifyTable, type Grid, parseSizeChart, type Range, type SizeChart } from "./size-chart";

// How much each measurement matters when picking a size.
const WEIGHT: Record<MeasurementField, number> = {
  chest_cm: 1,
  waist_cm: 1,
  hips_cm: 1,
  inseam_cm: 0.8,
  neck_cm: 0.8,
  sleeve_cm: 0.6,
  shoulder_width_cm: 0.6,
  thigh_cm: 0.5,
  height_cm: 0.5,
  weight_kg: 0.3,
};

// Within this distance (cm) of a size's edge, the next size is worth mentioning.
const BOUNDARY_CM = 1;

export type FitStatus = "fits" | "below" | "above";

export interface FieldFit {
  field: MeasurementField;
  value: number;
  range: Range;
  status: FitStatus;
}

export interface SizeSuggestion {
  label: string;
  fits: FieldFit[];
  /** A neighbouring size worth considering, when a measurement sits on the boundary. */
  alternative: { label: string; reason: "smaller" | "larger" } | null;
  /** "good": every measurement is inside the size's range; "close": at most one size off;
   *  "poor": outside the chart (closest size shown anyway). */
  quality: "good" | "close" | "poor";
}

export type SuggestionResult =
  | { kind: "suggestion"; suggestion: SizeSuggestion; chart: SizeChart }
  | { kind: "no-chart" }
  /** Only the garment's own measurements are on the page (e.g. a "Product size" tab). */
  | { kind: "garment-only" }
  | { kind: "missing-measurements"; needed: MeasurementField[] };

function status(value: number, range: Range): FitStatus {
  if (value < range.min) return "below";
  if (value > range.max) return "above";
  return "fits";
}

function typicalStep(chart: SizeChart, field: MeasurementField): number {
  const widths = chart.sizes.flatMap((s) => {
    const r = s.ranges[field];
    return r ? [r.max - r.min] : [];
  });
  const sorted = widths.sort((a, b) => a - b);
  return Math.max(1, sorted[Math.floor(sorted.length / 2)] ?? 1);
}

function usableFields(chart: SizeChart, measurements: Measurements): MeasurementField[] {
  return chart.fields.filter((f) => measurements[f] != null);
}

export function suggestSize(chart: SizeChart, measurements: Measurements): SizeSuggestion | null {
  const fields = usableFields(chart, measurements);
  if (fields.length === 0) return null;
  const steps = Object.fromEntries(fields.map((f) => [f, typicalStep(chart, f)]));

  const scored = chart.sizes.map((size, index) => {
    let score = 0;
    const fits: FieldFit[] = [];
    for (const field of fields) {
      const range = size.ranges[field];
      const value = measurements[field];
      if (!range || value == null) continue;
      const s = status(value, range);
      const off = s === "below" ? range.min - value : s === "above" ? value - range.max : 0;
      score += WEIGHT[field] * (off / (steps[field] ?? 1));
      fits.push({ field, value, range, status: s });
    }
    // Sizes missing a measurement the user has are slightly less trustworthy.
    score += 0.25 * (fields.length - fits.length);
    return { size, index, score, fits };
  });

  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  const best = scored[0];
  if (!best || best.fits.length === 0) return null;

  // Boundary: a measurement within BOUNDARY_CM of the top (or bottom) of the chosen range.
  let alternative: SizeSuggestion["alternative"] = null;
  const nearTop = best.fits.some((f) => f.status === "fits" && f.range.max - f.value <= BOUNDARY_CM);
  const nearBottom = best.fits.some((f) => f.status === "fits" && f.value - f.range.min <= BOUNDARY_CM);
  const larger = chart.sizes[best.index + 1];
  const smaller = chart.sizes[best.index - 1];
  if (nearTop && larger) alternative = { label: larger.label, reason: "larger" };
  else if (nearBottom && smaller) alternative = { label: smaller.label, reason: "smaller" };

  const quality = best.score === 0 ? "good" : best.score <= 1 ? "close" : "poor";
  return { label: best.size.label, fits: best.fits, alternative, quality };
}

/**
 * From all tables found on a page, use the chart that covers the most of the user's
 * measurements (visible tables first) and suggest a size from it.
 */
export function suggestFromTables(
  tables: { rows: Grid; visible: boolean; context?: string; onScreen?: boolean }[],
  measurements: Measurements,
): SuggestionResult {
  const charts = tables
    .map((t) => ({ chart: parseSizeChart(t.rows, t.context ?? ""), visible: t.visible }))
    .filter((c): c is { chart: SizeChart; visible: boolean } => c.chart !== null);
  if (charts.length === 0) {
    // Only point at a garment chart the user can actually see (e.g. an open "Product size"
    // tab); shops often keep a closed size guide rendered off-screen.
    const garment = tables.some(
      (t) => (t.onScreen ?? t.visible) && classifyTable(t.rows, t.context ?? "") === "garment",
    );
    return garment ? { kind: "garment-only" } : { kind: "no-chart" };
  }

  // Charts the page calls body measurements first, then the most overlap, then visible.
  const ranked = charts
    .map((c) => ({ ...c, overlap: usableFields(c.chart, measurements).length }))
    .sort(
      (a, b) =>
        Number(b.chart.basis === "body") - Number(a.chart.basis === "body") ||
        b.overlap - a.overlap ||
        Number(b.visible) - Number(a.visible),
    );
  const best = ranked.find((c) => c.overlap > 0);
  if (!best) {
    const needed = [...new Set(charts.flatMap((c) => c.chart.fields))];
    return { kind: "missing-measurements", needed };
  }
  const suggestion = suggestSize(best.chart, measurements);
  return suggestion
    ? { kind: "suggestion", suggestion, chart: best.chart }
    : { kind: "missing-measurements", needed: best.chart.fields };
}
