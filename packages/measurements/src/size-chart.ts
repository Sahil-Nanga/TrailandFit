/**
 * Generic size-chart reader: turns a table from any shop's page (rows of cell text) into body
 * measurement ranges per size, in centimetres and kilograms.
 *
 * Only columns whose header names a body measurement are used. Garment measurements
 * ("body length", "half chest", "width") and unlabelled columns are ignored, because comparing
 * them with body measurements would give wrong sizes.
 */
import type { MeasurementField } from "@aurora/api-client";

export type Grid = string[][];

export interface Range {
  min: number;
  max: number;
}

export interface SizeRow {
  label: string;
  ranges: Partial<Record<MeasurementField, Range>>;
}

export interface SizeChart {
  sizes: SizeRow[];
  fields: MeasurementField[];
  /** "body" when the page says these are body measurements; "unknown" if it doesn't say. */
  basis: "body" | "unknown";
}

// Header words for each body measurement (English plus a few common shop languages).
// Header words for each body measurement: English plus common shop languages, including
// Finnish and Swedish. (\b does not work around ä/ö, hence the explicit boundaries.)
const W = "(?:^|[^\\p{L}])";
const E = "(?=$|[^\\p{L}])";
const word = (alternatives: string) => new RegExp(`${W}(?:${alternatives})${E}`, "u");
const FIELD_PATTERNS: [MeasurementField, RegExp][] = [
  ["chest_cm", word("chest|bust|brust(?:umfang)?|poitrine|pecho|petto|borst|rinta|rinnanympärys|rintakehä|bröst|bröstvidd|byste")],
  ["waist_cm", word("waist|tour de taille|taillenumfang|cintura|vita|taille umfang|vyötärö|vyötärönympärys|midja|midjemått")],
  ["hips_cm", word("hips?|seat|hüfte|hüftumfang|hanches|cadera|fianchi|heupen|lantio|lantionympärys|höft|höftmått|stuss")],
  ["inseam_cm", word("inseam|inside leg|inner leg|innenbeinlänge|entrejambe|sisäsauma|haaramitta|lahkeen sisäpituus|innerbenslängd|innerben")],
  ["neck_cm", word("neck|collar|kragen(?:weite)?|cou|kaula|kaulanympärys|hals|halsvidd")],
  ["height_cm", word("height|body height|körpergröße|stature|taille du corps|pituus|vartalon pituus|längd|kroppslängd")],
  ["thigh_cm", word("thigh|oberschenkel|reisi|reiden ympärys|lår")],
  ["sleeve_cm", word("arm length|sleeve|sleeve length|armlänge|käsivarsi|hihan pituus|ärmlängd|armlängd")],
  ["shoulder_width_cm", word("shoulder|schulter|hartia|olkapää|axel|axelbredd")],
  ["weight_kg", word("weight|gewicht|paino|vikt")],
];

// Headers that describe the garment rather than the body.
const GARMENT =
  /(body length|body width|garment|product|half|pit to pit|across|\bhem\b|\brise\b|opening|total length|back length|\bseams?\b|center back|centre back|\(back\)|laid flat|\bflat\b|^length\b)/;

// Text near a table that says what it measures. Garment phrases are checked first because
// body charts often mention the product ("...correspond with a product's size").
const GARMENT_CONTEXT =
  /(measurements of the (product|garment|item)|(garment|product|item) measurements|measured (laid )?flat|flat measurements|dimensions of the (product|garment|item))/i;
const BODY_CONTEXT = /(body (size )?measurements|your (body )?measurements|measure your body|body dimensions|körpermaße)/i;

export type ChartBasis = "body" | "garment" | "unknown";

/** What a table measures, from the text around it and its headers. */
export function classifyTable(grid: Grid, context = ""): ChartBasis {
  if (GARMENT_CONTEXT.test(context)) return "garment";
  const headers = grid.flat().slice(0, 40).map((c) => c.toLowerCase().replace(/\s+/g, " ").trim());
  if (headers.some((h) => h.length <= 40 && GARMENT.test(h))) return "garment";
  if (BODY_CONTEXT.test(context)) return "body";
  return "unknown";
}

const SIZE_HEADER = /(?:^|[^\p{L}])(size|sizes|größe|talla|taglia|maat|storlek|taille|koko|koot)(?=$|[^\p{L}])/u;

/** Quick test for "this text might contain a size chart" (sizes or body measurement words). */
export const SIZE_CHART_HINT =
  /(size|größe|talla|taille|maat|storlek|koko|chest|bust|waist|hip|inseam|rinta|vyötärö|lantio|bröst|midja|höft|\b(?:XXS|XS|S|M|L|XL|XXL|3XL)\b)/iu;

// Plausible adult body values in cm (kg for weight), used to tell cm from inches (lb).
const PLAUSIBLE: Record<MeasurementField, Range> = {
  height_cm: { min: 100, max: 220 },
  weight_kg: { min: 25, max: 200 },
  chest_cm: { min: 60, max: 170 },
  waist_cm: { min: 50, max: 170 },
  hips_cm: { min: 60, max: 180 },
  shoulder_width_cm: { min: 28, max: 65 },
  inseam_cm: { min: 50, max: 105 },
  sleeve_cm: { min: 40, max: 100 },
  neck_cm: { min: 25, max: 60 },
  thigh_cm: { min: 35, max: 95 },
};

// Share of a column's values that must be plausible body measurements to use the column.
const MIN_PLAUSIBLE_SHARE = 0.8;

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

const FRACTIONS: Record<string, string> = {
  "½": ".5", "¼": ".25", "¾": ".75", "⅛": ".125", "⅜": ".375", "⅝": ".625", "⅞": ".875",
};

function normalizeNumbers(text: string): string {
  return text
    .replace(/(\d+)\s*([½¼¾⅛⅜⅝⅞])/g, (_m, whole: string, f: string) => whole + (FRACTIONS[f] ?? ""))
    .replace(/(^|[^\d.])([½¼¾⅛⅜⅝⅞])/g, (_m, pre: string, f: string) => `${pre}0${FRACTIONS[f] ?? ""}`)
    .replace(/(\d+)\s+(\d)\/(\d+)/g, (_m, whole: string, n: string, d: string) =>
      String(Number(whole) + Number(n) / Number(d)),
    )
    .replace(/(\d),(\d)(?!\d)/g, "$1.$2"); // "92,5" (decimal comma)
}

/** First range ("86-94", "31 ½ to 34 ¾") or single number in a cell. */
export function parseCellValue(text: string): Range | number | null {
  const t = normalizeNumbers(text);
  const range = /(\d+(?:\.\d+)?)\s*(?:-|–|—|to|~|bis|à)\s*(\d+(?:\.\d+)?)/i.exec(t);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const single = /(\d+(?:\.\d+)?)/.exec(t);
  return single ? Number(single[1]) : null;
}

function fieldFor(header: string): MeasurementField | null {
  const h = header.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h || GARMENT.test(h)) return null;
  for (const [field, pattern] of FIELD_PATTERNS) {
    if (pattern.test(h)) return field;
  }
  return null;
}

function unitFromHeader(header: string): "metric" | "imperial" | null {
  const h = header.toLowerCase();
  if (/\b(cm|centim|kg)\b/.test(h)) return "metric";
  if (/\b(in|inch|inches|lb|lbs)\b|"|″/.test(h)) return "imperial";
  return null;
}

function toMetric(field: MeasurementField, value: number, unit: "metric" | "imperial"): number {
  if (unit === "metric") return value;
  return field === "weight_kg" ? value * KG_PER_LB : value * CM_PER_IN;
}

/** Decide cm vs inches for a column from how plausible its values are in each. */
function inferUnit(field: MeasurementField, values: number[]): "metric" | "imperial" {
  const { min, max } = PLAUSIBLE[field];
  const fits = (unit: "metric" | "imperial") =>
    values.filter((v) => {
      const metric = toMetric(field, v, unit);
      return metric >= min && metric <= max;
    }).length;
  return fits("imperial") > fits("metric") ? "imperial" : "metric";
}

function looksLikeSizeLabel(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 14 && !/^(cm|in|inch|inches)$/i.test(t);
}

function transpose(grid: Grid): Grid {
  const width = Math.max(...grid.map((r) => r.length));
  return Array.from({ length: width }, (_, c) => grid.map((r) => r[c] ?? ""));
}

function headerRowIndex(grid: Grid): number {
  return grid.findIndex((row) => row.slice(1).some((cell) => fieldFor(cell) !== null));
}

/** Parse one table. Returns null if it is not a body-measurement size chart. */
export function parseSizeChart(grid: Grid, context = ""): SizeChart | null {
  const basis = classifyTable(grid, context);
  if (basis === "garment") return null;
  const rows = grid.map((r) => r.map((c) => c.replace(/\s+/g, " ").trim())).filter((r) => r.some(Boolean));
  if (rows.length < 2) return null;

  // Measurements may run down the first column with sizes across the top; flip those.
  const firstColumnFields = rows.slice(1).filter((r) => fieldFor(r[0] ?? "") !== null).length;
  const oriented = firstColumnFields >= 1 && headerRowIndex(rows) === -1 ? transpose(rows) : rows;

  const h = headerRowIndex(oriented);
  if (h === -1) return null;
  const header = oriented[h] ?? [];
  // A table with any garment-only column ("body length", "half chest") describes the
  // garment; even its "shoulder width" or "sleeve length" are garment, not body, values.
  if (header.some((cell) => GARMENT.test(cell.toLowerCase()))) return null;

  // Size labels: the column headed "Size", else the first column.
  let labelCol = header.findIndex((cell) => SIZE_HEADER.test(cell.toLowerCase()));
  if (labelCol === -1) labelCol = 0;

  const columns = header
    .map((cell, index) => ({ index, field: index === labelCol ? null : fieldFor(cell), header: cell }))
    .filter((c): c is { index: number; field: MeasurementField; header: string } => c.field !== null);
  if (columns.length === 0) return null;

  const dataRows = oriented
    .slice(h + 1)
    .filter((row) => looksLikeSizeLabel(row[labelCol] ?? "") && row.some((c, i) => i !== labelCol && /\d/.test(c)));
  if (dataRows.length < 2) return null;

  const sizes: SizeRow[] = dataRows.map((row) => ({ label: (row[labelCol] ?? "").trim(), ranges: {} }));
  const fields: MeasurementField[] = [];

  for (const { index, field, header: columnHeader } of columns) {
    if (fields.includes(field)) continue; // first matching column wins
    const parsed = dataRows.map((row) => parseCellValue(row[index] ?? ""));
    const numbers = parsed.flatMap((p) => (p === null ? [] : typeof p === "number" ? [p] : [p.min, p.max]));
    if (numbers.length < 2) continue;
    const unit = unitFromHeader(columnHeader) ?? inferUnit(field, numbers);
    // Most values must look like body measurements; otherwise this column measures something
    // else (e.g. a garment's flat chest width) and is skipped entirely.
    const plausible = PLAUSIBLE[field];
    const inRange = numbers.filter((n) => {
      const metric = toMetric(field, n, unit);
      return metric >= plausible.min && metric <= plausible.max;
    }).length;
    if (inRange / numbers.length < MIN_PLAUSIBLE_SHARE) continue;

    // Single values become ranges reaching halfway to the neighbouring sizes.
    const centers = parsed.map((p) => (p === null ? null : typeof p === "number" ? p : (p.min + p.max) / 2));
    parsed.forEach((p, i) => {
      if (p === null) return;
      let range: Range;
      if (typeof p === "number") {
        const prev = centers.slice(0, i).reverse().find((c) => c !== null) ?? null;
        const next = centers.slice(i + 1).find((c) => c !== null) ?? null;
        const halfDown = prev !== null ? (p - prev) / 2 : next !== null ? (next - p) / 2 : 0;
        const halfUp = next !== null ? (next - p) / 2 : halfDown;
        range = { min: p - halfDown, max: p + halfUp };
      } else {
        range = p;
      }
      const metric = { min: toMetric(field, range.min, unit), max: toMetric(field, range.max, unit) };
      if (metric.max < plausible.min || metric.min > plausible.max) return; // not a body value
      const size = sizes[i];
      if (size) size.ranges[field] = metric;
    });
    if (sizes.some((s) => s.ranges[field])) fields.push(field);
  }

  const usable = sizes.filter((s) => Object.keys(s.ranges).length > 0);
  if (fields.length === 0 || usable.length < 2) return null;
  return { sizes: usable, fields, basis: basis === "body" ? "body" : "unknown" };
}
