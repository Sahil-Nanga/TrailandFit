/**
 * Measurements (cm, kg) -> morph target weights and a uniform scale for the base body.
 *
 * Pure and deterministic. Uses the calibration produced by scripts/build_body.py, which
 * records how much each morph target changes the body's measurements. The model is linear
 * around the neutral body, so results are approximate (Phase 2 fits them precisely).
 */
import type { Measurements } from "@aurora/api-client";

import defaultCalibration from "./calibration.json";

export type Dimension = "height" | "chest" | "waist" | "hips" | "shoulderWidth" | "inseam";
export type MorphName = keyof typeof defaultCalibration.effects;
export type Weights = Record<MorphName, number>;

export interface Calibration {
  neutral: Record<Dimension, number> & { weights: Partial<Record<MorphName, number>> };
  effects: Record<MorphName, Record<Dimension, number>>;
}

export interface BodyShape {
  weights: Weights;
  /** Uniform scale applied after morphing, so the height matches exactly. */
  scale: number;
  /** What the shaped body should measure, in metres (linear prediction). */
  predicted: Record<Dimension, number>;
}

export interface BodyInput {
  measurements: Measurements;
  /** 0 = feminine, 1 = masculine. */
  bodyType: number;
}

const DIMENSIONS: Dimension[] = ["height", "chest", "waist", "hips", "shoulderWidth", "inseam"];

// Which incr/decr morph pair adjusts each circumference or width. Shoulders first: they also
// widen the chest, which the chest pair then corrects.
const ADJUSTERS: [Exclude<Dimension, "height" | "inseam">, "shoulders" | "chest" | "waist" | "hips"][] = [
  ["shoulderWidth", "shoulders"],
  ["chest", "chest"],
  ["waist", "waist"],
  ["hips", "hips"],
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** BMI -> MakeHuman weight parameter (0 thin, 0.5 average, 1 heavy). */
export function weightParameter(heightCm: number, weightKg: number | null | undefined): number {
  if (!weightKg) return 0.5;
  const bmi = weightKg / (heightCm / 100) ** 2;
  if (bmi <= 22) return clamp01(0.5 * (bmi - 17) / 5);
  return clamp01(0.5 + 0.5 * (bmi - 22) / 10);
}

function zeroWeights(calibration: Calibration): Weights {
  return Object.fromEntries(Object.keys(calibration.effects).map((k) => [k, 0])) as Weights;
}

/** Linear prediction of the unscaled body's measurements (metres) for some morph weights. */
export function predictUnscaled(weights: Weights, calibration: Calibration = defaultCalibration as Calibration) {
  const result = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) {
    let value = calibration.neutral[d];
    for (const name of Object.keys(calibration.effects) as MorphName[]) {
      const delta = weights[name] - (calibration.neutral.weights[name] ?? 0);
      value += delta * calibration.effects[name][d];
    }
    result[d] = value;
  }
  return result;
}

/** Set an incr/decr pair so the dimension moves by `residual` (metres); returns what it achieved. */
function adjust(weights: Weights, calibration: Calibration, pair: string, dimension: Dimension, residual: number): void {
  const incr = `${pair}-incr` as MorphName;
  const decr = `${pair}-decr` as MorphName;
  // Current net contribution of the pair, then the total wanted.
  const current = weights[incr] * calibration.effects[incr][dimension] + weights[decr] * calibration.effects[decr][dimension];
  const wanted = current + residual;
  weights[incr] = wanted > 0 ? clamp01(wanted / calibration.effects[incr][dimension]) : 0;
  weights[decr] = wanted < 0 ? clamp01(wanted / calibration.effects[decr][dimension]) : 0;
}

export function measurementsToShape(
  { measurements: m, bodyType }: BodyInput,
  calibration: Calibration = defaultCalibration as Calibration,
): BodyShape {
  const weights = zeroWeights(calibration);
  const g = clamp01(bodyType);
  const w = weightParameter(m.height_cm, m.weight_kg);
  weights.female = 1 - g;
  weights.male = g;
  weights["female-minweight"] = (1 - g) * clamp01(1 - 2 * w);
  weights["female-maxweight"] = (1 - g) * clamp01(2 * w - 1);
  weights["male-minweight"] = g * clamp01(1 - 2 * w);
  weights["male-maxweight"] = g * clamp01(2 * w - 1);

  // Legs: match the inseam-to-height ratio, splitting length between thigh and shin.
  if (m.inseam_cm) {
    const target = m.inseam_cm / m.height_cm;
    const p = predictUnscaled(weights, calibration);
    const grow = target * p.height > p.inseam;
    const upper = calibration.effects[grow ? "upperLeg-incr" : "upperLeg-decr"];
    const lower = calibration.effects[grow ? "lowerLeg-incr" : "lowerLeg-decr"];
    // Both leg morphs get the same weight x, so their effects add up.
    const dI = upper.inseam + lower.inseam;
    const dH = upper.height + lower.height;
    // (I + dI·x) / (H + dH·x) = target  ->  x
    const x = clamp01((target * p.height - p.inseam) / (dI - target * dH));
    weights[grow ? "upperLeg-incr" : "upperLeg-decr"] = x;
    weights[grow ? "lowerLeg-incr" : "lowerLeg-decr"] = x;
  }

  const scaleFor = () => m.height_cm / 100 / predictUnscaled(weights, calibration).height;
  // Circumferences scale with the body, so aim the unscaled body at target / scale.
  for (let pass = 0; pass < 4; pass++) {
    const scale = scaleFor();
    for (const [dimension, pair] of ADJUSTERS) {
      const cm = dimension === "shoulderWidth" ? m.shoulder_width_cm : m[`${dimension}_cm`];
      if (!cm) continue;
      const residual = cm / 100 / scale - predictUnscaled(weights, calibration)[dimension];
      adjust(weights, calibration, pair, dimension, residual);
    }
  }

  const scale = scaleFor();
  const unscaled = predictUnscaled(weights, calibration);
  const predicted = Object.fromEntries(DIMENSIONS.map((d) => [d, unscaled[d] * scale])) as Record<Dimension, number>;
  return { weights, scale, predicted };
}
