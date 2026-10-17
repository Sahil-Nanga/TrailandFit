import type { Measurements } from "@aurora/api-client";
import { describe, expect, it } from "vitest";

import calibration from "./calibration.json";
import { measurementsToShape, weightParameter } from "./morphs";

const N = calibration.neutral;
const cm = (m: number) => Math.round(m * 1000) / 10;
const me = (m: Partial<Measurements>): Measurements => ({ height_cm: 175, ...m });

describe("weightParameter", () => {
  it("is average without a weight", () => expect(weightParameter(175, null)).toBe(0.5));
  it("maps BMI 22 to average", () => expect(weightParameter(175, 22 * 1.75 ** 2)).toBeCloseTo(0.5));
  it("clamps thin and heavy", () => {
    expect(weightParameter(180, 40)).toBe(0);
    expect(weightParameter(160, 150)).toBe(1);
  });
});

describe("measurementsToShape", () => {
  it("leaves the neutral body alone for its own measurements", () => {
    const shape = measurementsToShape({
      measurements: me({
        height_cm: cm(N.height),
        chest_cm: cm(N.chest),
        waist_cm: cm(N.waist),
        hips_cm: cm(N.hips),
        shoulder_width_cm: cm(N.shoulderWidth),
        inseam_cm: cm(N.inseam),
      }),
      bodyType: 0.5,
    });
    expect(shape.scale).toBeCloseTo(1, 2);
    for (const name of ["chest-incr", "chest-decr", "waist-incr", "hips-decr", "upperLeg-incr"] as const) {
      expect(shape.weights[name]).toBeLessThan(0.02);
    }
  });

  it("scales to the requested height", () => {
    const shape = measurementsToShape({ measurements: me({ height_cm: 190 }), bodyType: 0.5 });
    expect(shape.predicted.height).toBeCloseTo(1.9, 3);
  });

  it("blends body type", () => {
    const fem = measurementsToShape({ measurements: me({}), bodyType: 0 }).weights;
    const masc = measurementsToShape({ measurements: me({}), bodyType: 1 }).weights;
    expect([fem.female, fem.male]).toEqual([1, 0]);
    expect([masc.female, masc.male]).toEqual([0, 1]);
  });

  it("uses BMI for the weight morphs", () => {
    const light = measurementsToShape({ measurements: me({ weight_kg: 52 }), bodyType: 1 }).weights;
    const heavy = measurementsToShape({ measurements: me({ weight_kg: 110 }), bodyType: 1 }).weights;
    expect(light["male-minweight"]).toBeGreaterThan(0);
    expect(light["male-maxweight"]).toBe(0);
    expect(heavy["male-maxweight"]).toBeGreaterThan(0);
  });

  it.each([
    ["chest_cm", "chest", 98],
    ["chest_cm", "chest", 84],
    ["waist_cm", "waist", 82],
    ["waist_cm", "waist", 64],
    ["hips_cm", "hips", 104],
    ["shoulder_width_cm", "shoulderWidth", 44],
  ] as const)("hits %s (%s) = %s cm within 1 cm", (field, dimension, target) => {
    const shape = measurementsToShape({ measurements: me({ [field]: target }), bodyType: 0.5 });
    expect(Math.abs(shape.predicted[dimension] * 100 - target)).toBeLessThan(1);
  });

  it("reports the closest it can get when a target is beyond the morph range", () => {
    // An average-weight 175 cm body can't reach a 95 cm waist with the waist morph alone.
    const shape = measurementsToShape({ measurements: me({ waist_cm: 95 }), bodyType: 0.5 });
    expect(shape.weights["waist-incr"]).toBe(1);
    expect(shape.predicted.waist * 100).toBeLessThan(95);
    // With a heavier body weight the heavier base shape closes most of the gap.
    const heavier = measurementsToShape({ measurements: me({ waist_cm: 95, weight_kg: 95 }), bodyType: 0.5 });
    expect(heavier.predicted.waist).toBeGreaterThan(shape.predicted.waist);
  });

  it("matches height and inseam together", () => {
    for (const inseam of [72, 80, 86]) {
      const shape = measurementsToShape({ measurements: me({ height_cm: 180, inseam_cm: inseam }), bodyType: 0.5 });
      expect(shape.predicted.height * 100).toBeCloseTo(180, 1);
      expect(Math.abs(shape.predicted.inseam * 100 - inseam)).toBeLessThan(1);
    }
  });

  it("hits several measurements at once (a typical person)", () => {
    const target = { height_cm: 179, weight_kg: 74, chest_cm: 98, waist_cm: 84, hips_cm: 99, shoulder_width_cm: 45, inseam_cm: 81 };
    const shape = measurementsToShape({ measurements: target, bodyType: 0.8 });
    expect(Math.abs(shape.predicted.chest * 100 - 98)).toBeLessThan(1.5);
    expect(Math.abs(shape.predicted.waist * 100 - 84)).toBeLessThan(1.5);
    expect(Math.abs(shape.predicted.hips * 100 - 99)).toBeLessThan(1.5);
  });

  it("keeps every weight between 0 and 1, even for extreme numbers", () => {
    const shape = measurementsToShape({
      measurements: me({ chest_cm: 200, waist_cm: 40, hips_cm: 170, inseam_cm: 120, weight_kg: 300 }),
      bodyType: 7,
    });
    for (const value of Object.values(shape.weights)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(shape.weights["chest-incr"]).toBe(1);
    expect(shape.weights["waist-decr"]).toBe(1);
  });

  it("does not mutate its input", () => {
    const measurements = me({ chest_cm: 100 });
    const copy = structuredClone(measurements);
    measurementsToShape({ measurements, bodyType: 0.5 });
    expect(measurements).toEqual(copy);
  });
});
