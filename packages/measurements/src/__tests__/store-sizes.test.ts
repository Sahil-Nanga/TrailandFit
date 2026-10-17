import type { Measurements } from "@aurora/api-client";
import { describe, expect, it } from "vitest";

import type { SizeChart } from "../size-chart";
import { chartFromTables, fitWord, sizeEase, sizeKey, sizeOptions, suggestedLabel } from "../store-sizes";

const METRIC_TABLE = [
  ["Size", "Chest (cm)", "Waist (cm)", "Hip (cm)"],
  ["S", "88-96", "76-84", "92-100"],
  ["M", "96-104", "84-92", "100-108"],
  ["L", "104-112", "92-100", "108-116"],
];

const CHART: SizeChart = {
  basis: "body",
  fields: ["chest_cm", "waist_cm", "hips_cm"],
  sizes: [
    { label: "S", ranges: { chest_cm: { min: 88, max: 96 }, waist_cm: { min: 76, max: 84 }, hips_cm: { min: 92, max: 100 } } },
    { label: "M", ranges: { chest_cm: { min: 96, max: 104 }, waist_cm: { min: 84, max: 92 }, hips_cm: { min: 100, max: 108 } } },
    { label: "L", ranges: { chest_cm: { min: 104, max: 112 }, waist_cm: { min: 92, max: 100 }, hips_cm: { min: 108, max: 116 } } },
  ],
};

const ME = { height_cm: 180, chest_cm: 100, waist_cm: 88, hips_cm: 104 } as Measurements;

describe("chartFromTables", () => {
  it("picks the body chart with the most measurements", () => {
    const chart = chartFromTables([
      { rows: [["Size", "Chest"], ["S", "88-96"], ["M", "96-104"]], visible: true },
      { rows: METRIC_TABLE, visible: false },
    ]);
    expect(chart?.fields).toEqual(["chest_cm", "waist_cm", "hips_cm"]);
  });

  it("is null without a chart", () => {
    expect(chartFromTables([{ rows: [["Colour"], ["Blue"]], visible: true }])).toBeNull();
  });
});

describe("sizeOptions", () => {
  it("keeps the shop's sizes and order, joined to chart rows by name", () => {
    const options = sizeOptions(
      [
        { label: "XS", available: false },
        { label: "s", available: true },
        { label: "M (38)", available: true },
        { label: "Size L", available: null },
      ],
      CHART,
    );
    expect(options.map((o) => [o.label, o.available, o.row?.label ?? null])).toEqual([
      ["XS", false, null],
      ["s", true, "S"],
      ["M (38)", true, "M"],
      ["Size L", null, "L"],
    ]);
  });

  it("falls back to the chart's sizes", () => {
    expect(sizeOptions(null, CHART).map((o) => o.label)).toEqual(["S", "M", "L"]);
    expect(sizeOptions([], null)).toEqual([]);
  });

  it("normalises labels", () => {
    expect(sizeKey(" eu 42 ")).toBe("42");
    expect(sizeKey("W32 L34")).toBe("W32L34");
  });
});

describe("sizeEase and fitWord", () => {
  it("a size made for your body has regular room", () => {
    const m = sizeEase(CHART.sizes[1] ?? null, ME);
    expect(m).toEqual({ chest: 8, waist: 6, hips: 6, thigh: 4 });
    expect(fitWord(m)).toBe("regular");
    expect(suggestedLabel(CHART, ME)).toBe("M");
  });

  it("smaller sizes are tight, larger ones loose", () => {
    const s = sizeEase(CHART.sizes[0] ?? null, ME);
    expect(s?.chest).toBe(0);
    expect(fitWord(s)).toBe("tight");
    const l = sizeEase(CHART.sizes[2] ?? null, ME);
    expect(l?.chest).toBe(16);
    expect(fitWord(l)).toBe("loose");
  });

  it("needs a chart row and a shared measurement", () => {
    expect(sizeEase(null, ME)).toBeNull();
    expect(sizeEase({ label: "M", ranges: { inseam_cm: { min: 80, max: 82 } } }, ME)).toBeNull();
    expect(fitWord(null)).toBeNull();
  });
});
