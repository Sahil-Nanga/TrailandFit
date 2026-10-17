import type { Measurements } from "@aurora/api-client";
import { describe, expect, it } from "vitest";

import { classifyTable, parseCellValue, parseSizeChart, SIZE_CHART_HINT } from "../size-chart";
import { suggestFromTables, suggestSize } from "../size-match";

// Uniqlo men's T-shirt "Body Size" table as the page renders it (inches, fractions, every
// cell repeated for screen readers, and a second value column with no header).
const UNIQLO_INCHES = [
  ["Size", "Chest"],
  ["XXS", "30 ¾ - 33 30 ¾ to 33"],
  ["XS", "31 ½ - 34 ¾ 31 ½ to 34 ¾", "26 - 28 ¼ 26 to 28 ¼"],
  ["S", "34 ¾ - 37 ¾ 34 ¾ to 37 ¾", "26 ¾ - 30 26 ¾ to 30"],
  ["M", "37 ¾ - 41 37 ¾ to 41", "30 - 33 30 to 33"],
  ["L", "41 - 44 41 to 44", "33 - 36 ¼ 33 to 36 ¼"],
  ["XL", "44 - 47 ¼ 44 to 47 ¼", "36 ¼ - 39 ¼ 36 ¼ to 39 ¼"],
  ["XXL", "47 ¼ - 50 ½ 47 ¼ to 50 ½", "39 ¼ - 42 ½ 39 ¼ to 42 ½"],
  ["3XL", "50 ½ - 53 ½ 50 ½ to 53 ½", "42 ½ - 45 ¾ 42 ½ to 45 ¾"],
];

const UNIQLO_PRODUCT_SIZE = [
  ["Size", "Body length", "Body width", "Shoulder width", "Sleeve length"],
  ["S", "68", "50", "44", "20"],
  ["M", "70", "53", "46", "21"],
  ["L", "72", "56", "48", "22"],
];

const METRIC_TABLE = [
  ["Size", "Chest (cm)", "Waist (cm)", "Hip (cm)"],
  ["S", "88-96", "76-84", "92-100"],
  ["M", "96–104", "84–92", "100–108"],
  ["L", "104 - 112", "92 - 100", "108 - 116"],
];

const SIDEWAYS = [
  ["", "S", "M", "L"],
  ["Chest", "88-96", "96-104", "104-112"],
  ["Waist", "76-84", "84-92", "92-100"],
];

const EU_SINGLE_VALUES = [
  ["Size", "Chest", "Waist"],
  ["46", "92", "80"],
  ["48", "96", "84"],
  ["50", "100", "88"],
  ["52", "104", "92"],
];

const NOT_A_SIZE_CHART = [
  ["Fit", "Sleeve Length", "Neck Type"],
  ["Regular", "Short", "Crew Neck"],
];

const me = (m: Partial<Measurements>): Measurements => ({ height_cm: 179, ...m });

describe("parseCellValue", () => {
  it.each([
    ["86-94", { min: 86, max: 94 }],
    ["86 – 94 cm", { min: 86, max: 94 }],
    ["31 ½ - 34 ¾ 31 ½ to 34 ¾", { min: 31.5, max: 34.75 }],
    ["30 1/2 to 33", { min: 30.5, max: 33 }],
    ["92,5", 92.5],
    ["104", 104],
    ["—", null],
  ])("%s", (text, expected) => {
    expect(parseCellValue(text)).toEqual(expected);
  });
});

describe("parseSizeChart", () => {
  it("reads Uniqlo's inch chart, converts to cm and ignores the unlabelled column", () => {
    const chart = parseSizeChart(UNIQLO_INCHES);
    expect(chart?.fields).toEqual(["chest_cm"]);
    expect(chart?.sizes.map((s) => s.label)).toEqual(["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"]);
    const m = chart?.sizes.find((s) => s.label === "M")?.ranges.chest_cm;
    expect(m?.min).toBeCloseTo(95.9, 1);
    expect(m?.max).toBeCloseTo(104.1, 1);
  });

  it("reads a cm table with units in the headers", () => {
    const chart = parseSizeChart(METRIC_TABLE);
    expect(chart?.fields).toEqual(["chest_cm", "waist_cm", "hips_cm"]);
    expect(chart?.sizes[1]?.ranges.waist_cm).toEqual({ min: 84, max: 92 });
  });

  it("reads tables with sizes across the top", () => {
    const chart = parseSizeChart(SIDEWAYS);
    expect(chart?.sizes.map((s) => s.label)).toEqual(["S", "M", "L"]);
    expect(chart?.sizes[0]?.ranges.chest_cm).toEqual({ min: 88, max: 96 });
  });

  it("turns single values into ranges between neighbouring sizes", () => {
    const chart = parseSizeChart(EU_SINGLE_VALUES);
    expect(chart?.sizes[1]?.ranges.chest_cm).toEqual({ min: 94, max: 98 });
  });

  it("ignores garment measurement tables", () => {
    expect(parseSizeChart(UNIQLO_PRODUCT_SIZE)).toBeNull();
  });

  it("ignores tables that are not size charts", () => {
    expect(parseSizeChart(NOT_A_SIZE_CHART)).toBeNull();
  });
});

describe("suggestSize", () => {
  const uniqlo = parseSizeChart(UNIQLO_INCHES);
  if (!uniqlo) throw new Error("chart did not parse");

  it("picks the size whose range contains the measurement", () => {
    const s = suggestSize(uniqlo, me({ chest_cm: 100 }));
    expect(s?.label).toBe("M");
    expect(s?.quality).toBe("good");
    expect(s?.alternative).toBeNull();
    expect(s?.fits[0]?.status).toBe("fits");
  });

  it("mentions the neighbouring size on a boundary", () => {
    const s = suggestSize(uniqlo, me({ chest_cm: 96 }));
    expect(s?.label).toBe("M");
    expect(s?.alternative).toEqual({ label: "S", reason: "smaller" });
  });

  it("uses all shared measurements", () => {
    const chart = parseSizeChart(METRIC_TABLE);
    if (!chart) throw new Error("chart did not parse");
    // Chest says S, waist and hips say M: the majority wins.
    const s = suggestSize(chart, me({ chest_cm: 95, waist_cm: 88, hips_cm: 104 }));
    expect(s?.label).toBe("M");
    expect(s?.quality).toBe("close");
    expect(s?.fits.find((f) => f.field === "chest_cm")?.status).toBe("below");
  });

  it("flags measurements outside the whole chart", () => {
    const s = suggestSize(uniqlo, me({ chest_cm: 150 }));
    expect(s?.label).toBe("3XL");
    expect(s?.quality).toBe("poor");
  });
});

describe("suggestFromTables", () => {
  it("chooses the body chart over garment and unrelated tables", () => {
    const result = suggestFromTables(
      [
        { rows: NOT_A_SIZE_CHART, visible: true },
        { rows: UNIQLO_PRODUCT_SIZE, visible: true },
        { rows: UNIQLO_INCHES, visible: true },
      ],
      me({ chest_cm: 100 }),
    );
    expect(result.kind).toBe("suggestion");
    if (result.kind === "suggestion") expect(result.suggestion.label).toBe("M");
  });

  it("reports when there is no chart on the page", () => {
    expect(suggestFromTables([{ rows: NOT_A_SIZE_CHART, visible: true }], me({})).kind).toBe("no-chart");
  });

  it("reports which measurements the chart needs", () => {
    const result = suggestFromTables([{ rows: UNIQLO_INCHES, visible: true }], me({}));
    expect(result).toEqual({ kind: "missing-measurements", needed: ["chest_cm"] });
  });
});

// The two tabs of Uniqlo's size guide as captured from the live page. Only one is in the
// page at a time; the "Product Size" one lists the garment laid flat.
const UNIQLO_PRODUCT_LIVE = {
  rows: [
    ["Size", "Length (back)", "Chest", "Sleeve Length (center back)"],
    ["XXS", "24 ½", "17", "16 ½"],
    ["XS", "25 ½", "18", "17"],
    ["S", "26 ½", "19", "17 ½"],
    ["M", "27 ½", "20 ½", "18"],
    ["L", "28 ½", "22", "18 ½"],
  ],
  visible: true,
  context:
    "Product Size Body Size The dimensions shown below are the actual measurements of the product. Click here for measuring instructions. CM IN",
};
const UNIQLO_BODY_LIVE = {
  rows: UNIQLO_INCHES,
  visible: true,
  context:
    "Product Size Body Size The dimensions shown below are body size measurements that correspond with a product's size. Click here for measuring instructions. CM IN",
};
// The table from the user's screenshot (another Uniqlo shirt, Product Size tab, inches).
const UNIQLO_PRODUCT_SCREENSHOT = [
  ["Size", "Length (back)", "Shoulder width (seam to seam)", "Chest", "Sleeve Length (center back)"],
  ["XXS", "25 ½", "18 ¾", "21", "32 ½"],
  ["XS", "26 ½", "19 ¼", "22 ¼", "33"],
  ["S", "27 ¼", "20", "23 ½", "34"],
  ["M", "28", "20 ½", "24 ½", "35"],
  ["L", "29 ¼", "21 ¼", "26 ¼", "36"],
];

describe("garment vs body charts", () => {
  it("rejects the Product Size tab by its description", () => {
    expect(classifyTable(UNIQLO_PRODUCT_LIVE.rows, UNIQLO_PRODUCT_LIVE.context)).toBe("garment");
    expect(parseSizeChart(UNIQLO_PRODUCT_LIVE.rows, UNIQLO_PRODUCT_LIVE.context)).toBeNull();
  });

  it("rejects garment tables by their headers even without any description", () => {
    expect(parseSizeChart(UNIQLO_PRODUCT_SCREENSHOT)).toBeNull();
  });

  it("drops columns whose values are not plausible body measurements", () => {
    // Flat garment chest widths (17-22 in = 43-56 cm) under a plain "Chest" header.
    const chart = parseSizeChart([
      ["Size", "Chest", "Waist"],
      ["S", "17", "76-84"],
      ["M", "19", "84-92"],
      ["L", "21", "92-100"],
    ]);
    expect(chart?.fields).toEqual(["waist_cm"]);
  });

  it("recognises the Body Size tab as body measurements", () => {
    expect(parseSizeChart(UNIQLO_BODY_LIVE.rows, UNIQLO_BODY_LIVE.context)?.basis).toBe("body");
  });

  it("says so when only the garment chart is on the page", () => {
    const result = suggestFromTables([UNIQLO_PRODUCT_LIVE], me({ chest_cm: 100, sleeve_cm: 62 }));
    expect(result.kind).toBe("garment-only");
  });

  it("does not nudge about a garment chart that is not on screen", () => {
    const hidden = { ...UNIQLO_PRODUCT_LIVE, onScreen: false };
    expect(suggestFromTables([hidden], me({ chest_cm: 100 })).kind).toBe("no-chart");
    expect(suggestFromTables([{ ...hidden, onScreen: true }], me({ chest_cm: 100 })).kind).toBe("garment-only");
  });

  it("still suggests from a body chart that is off screen", () => {
    const result = suggestFromTables([{ ...UNIQLO_BODY_LIVE, onScreen: false }], me({ chest_cm: 100 }));
    expect(result.kind).toBe("suggestion");
  });

  it("prefers the body chart even when a garment-ish chart covers more measurements", () => {
    const vague = {
      rows: [
        ["Size", "Chest", "Sleeve", "Waist"],
        ["S", "36", "33", "30"],
        ["M", "40", "34", "33"],
        ["L", "44", "35", "36"],
      ],
      visible: true,
    };
    const result = suggestFromTables([vague, UNIQLO_BODY_LIVE], me({ chest_cm: 100, sleeve_cm: 62, waist_cm: 84 }));
    expect(result.kind).toBe("suggestion");
    if (result.kind === "suggestion") expect(result.chart.basis).toBe("body");
  });
});

describe("XXL.fi (Finnish shop, chart with sizes across the top)", () => {
  // Captured from xxl.fi's size guide ("Koko-opas"), including the shop's own "66-77,5" typo.
  const XXL = {
    rows: [
      ["Pilago Men body measurements", "XS", "S", "M", "L", "XL", "XXL"],
      ["Height", "164-170", "170-176", "176-180", "180-185", "185-191", "191-197"],
      ["Chest", "80-84", "88-92", "96-100", "104-108", "112-116", "120"],
      ["Waist", "68-72", "76-80", "84-88", "92-96", "100-104", "108"],
      ["Hip", "90", "93-96", "99-102", "105-108", "111-114", "117"],
      ["Sleeve length", "62-64", "64-66", "66-77,5", "67,5-69", "69-71", "71-73"],
      ["Inseam", "80-81", "81-82", "82-83", "84-85", "85-86", "86-87"],
    ],
    visible: true,
    context: "Pilago Size guide- Men",
  };

  it("parses the sideways chart with comma decimals", () => {
    const chart = parseSizeChart(XXL.rows, XXL.context);
    expect(chart?.sizes.map((s) => s.label)).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
    expect(chart?.fields).toEqual(["height_cm", "chest_cm", "waist_cm", "hips_cm", "sleeve_cm", "inseam_cm"]);
    expect(chart?.sizes[3]?.ranges.sleeve_cm).toEqual({ min: 67.5, max: 69 });
  });

  it("suggests M for a 179 cm, 98 cm chest, 86 cm waist person", () => {
    const result = suggestFromTables([XXL], me({ height_cm: 179, chest_cm: 98, waist_cm: 86 }));
    expect(result.kind).toBe("suggestion");
    if (result.kind === "suggestion") expect(result.suggestion.label).toBe("M");
  });

  it("recognises the chart text as a possible size chart", () => {
    expect(SIZE_CHART_HINT.test(XXL.rows.flat().join(" "))).toBe(true);
  });

  it("reads Finnish and Swedish headers", () => {
    const finnish = parseSizeChart([
      ["Koko", "Rinnanympärys (cm)", "Vyötärö (cm)", "Lantio (cm)"],
      ["S", "88-92", "76-80", "93-96"],
      ["M", "96-100", "84-88", "99-102"],
    ]);
    expect(finnish?.fields).toEqual(["chest_cm", "waist_cm", "hips_cm"]);
    const swedish = parseSizeChart([
      ["Storlek", "Bröst", "Midja", "Höft"],
      ["S", "88-92", "76-80", "93-96"],
      ["M", "96-100", "84-88", "99-102"],
    ]);
    expect(swedish?.fields).toEqual(["chest_cm", "waist_cm", "hips_cm"]);
  });
});

it("does not mistake an Inseam column for a garment 'seam' measurement", () => {
  const chart = parseSizeChart([
    ["Size", "Waist", "Inseam"],
    ["30", "76-80", "80-81"],
    ["32", "81-85", "81-82"],
  ]);
  expect(chart?.fields).toEqual(["waist_cm", "inseam_cm"]);
});
