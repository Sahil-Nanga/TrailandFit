/**
 * Unit conversion at the UI edge. The API always stores centimetres and kilograms.
 */
import {
  MEASUREMENT_RANGES,
  type MeasurementField,
} from "@aurora/api-client";

export type LengthUnit = "cm" | "in";
export type WeightUnit = "kg" | "lb";
export interface Units {
  length: LengthUnit;
  weight: WeightUnit;
}

export const METRIC: Units = { length: "cm", weight: "kg" };

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

export function isWeight(field: MeasurementField): boolean {
  return field === "weight_kg";
}

export function unitLabel(field: MeasurementField, units: Units): string {
  return isWeight(field) ? units.weight : units.length;
}

function factor(field: MeasurementField, units: Units): number {
  if (isWeight(field)) return units.weight === "lb" ? KG_PER_LB : 1;
  return units.length === "in" ? CM_PER_IN : 1;
}

/** Metric value -> number in the chosen unit. */
export function fromMetric(field: MeasurementField, metric: number, units: Units): number {
  return metric / factor(field, units);
}

/** Number in the chosen unit -> metric value. */
export function toMetric(field: MeasurementField, value: number, units: Units): number {
  return value * factor(field, units);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Format a metric value for an input in the chosen unit ("" for missing). */
export function formatForInput(
  field: MeasurementField,
  metric: number | null | undefined,
  units: Units,
): string {
  if (metric === null || metric === undefined) return "";
  return String(round1(fromMetric(field, metric, units)));
}

/** Allowed range in the chosen unit, rounded inwards so every shown value is accepted. */
export function displayRange(field: MeasurementField, units: Units): { min: number; max: number } {
  const { min, max } = MEASUREMENT_RANGES[field];
  return {
    min: Math.ceil(fromMetric(field, min, units) * 10) / 10,
    max: Math.floor(fromMetric(field, max, units) * 10) / 10,
  };
}

/** Accepts "72.5" and "72,5" (comma decimals are common in the EU). */
export function parseNumber(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (normalized === "") return null;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}
