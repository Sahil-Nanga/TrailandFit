import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import landmarks from "./garmentLandmarks.json";
import { applyRoom, buildGarmentGeometry, covers, garmentStyle, isArm, roomAt } from "./garments";

describe("garmentStyle", () => {
  it.each([
    ["top", "Basic T-shirt - Navy", "tee"],
    ["top", "Organic cotton tee", "tee"],
    ["top", "Polo shirt", "tee"],
    ["top", "Oversized hoodie", "longSleeve"],
    ["top", "Oxford shirt slim fit", "longSleeve"],
    ["top", "Neule merino", "longSleeve"],
    ["top", "Summer thing", "tee"],
    ["bottom", "Slim jeans", "trousers"],
    ["bottom", "Running shorts", "shorts"],
    ["bottom", "Pleated midi skirt", "skirt"],
    ["bottom", "Hame A-linja", "skirt"],
    ["bottom", "Cargo housut", "trousers"],
  ] as const)("%s %s -> %s", (category, title, style) => {
    expect(garmentStyle(category, title)).toBe(style);
  });
});

// Points on the neutral base body (metres; front is +z).
const CHEST = new Vector3(0, 1.25, 0.1);
const UPPER_ARM = new Vector3(0.24, 1.26, 0.01);
const FOREARM = new Vector3(0.4, 1.1, 0.15);
const HAND = new Vector3(0.48, 0.98, 0.25);
const HIP = new Vector3(0.12, 0.9, 0.05);
const THIGH = new Vector3(0.12, 0.65, 0.05);
const SHIN = new Vector3(0.18, 0.3, 0);
const FACE = new Vector3(0, 1.55, 0.1);
const SHOULDER_TOP = new Vector3(0.13, 1.4, 0);
const NECK = new Vector3(0, 1.4, 0.05);

describe("covers", () => {
  it("tells the arms from the torso", () => {
    expect(isArm(UPPER_ARM)).toBe(true);
    expect(isArm(HAND)).toBe(true);
    expect(isArm(CHEST)).toBe(false);
    expect(isArm(THIGH)).toBe(false);
  });

  it.each([
    ["tee", [CHEST, UPPER_ARM, SHOULDER_TOP], [FOREARM, HAND, THIGH, FACE, NECK]],
    ["longSleeve", [CHEST, UPPER_ARM, FOREARM], [HAND, THIGH, FACE]],
    ["trousers", [HIP, THIGH, SHIN], [CHEST, HAND, FACE]],
    ["shorts", [HIP, THIGH], [SHIN, CHEST, HAND]],
    ["briefs", [HIP, new Vector3(0, 0.8, 0.08)], [THIGH, SHIN, CHEST, HAND, new Vector3(0, 1.05, 0.1)]],
  ] as const)("%s", (style, inside, outside) => {
    for (const p of inside) expect(covers(style, p), `${p.toArray()}`).toBe(true);
    for (const p of outside) expect(covers(style, p), `${p.toArray()}`).toBe(false);
  });
});

describe("buildGarmentGeometry", () => {
  // Two triangles on the chest (one facing front, one back) and one on the face.
  function body() {
    const g = new BufferGeometry();
    const at = (p: Vector3, dz = 0) => [p.x, p.y, p.z + dz];
    const points = [
      ...at(CHEST), ...at(new Vector3(0.05, 1.25, 0.1)), ...at(new Vector3(0, 1.2, 0.1)),
      ...at(CHEST, -0.2), ...at(new Vector3(0.05, 1.25, -0.1)), ...at(new Vector3(0, 1.2, -0.1)),
      ...at(FACE), ...at(new Vector3(0.02, 1.55, 0.1)), ...at(new Vector3(0, 1.5, 0.1)),
    ];
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    g.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    g.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    g.morphAttributes.position = [new BufferAttribute(new Float32Array(27).fill(0.01), 3)];
    return g;
  }

  it("keeps covered triangles, front first, offset off the skin, with the body's morphs", () => {
    const garment = buildGarmentGeometry(body(), new Matrix4(), "tee");
    expect(garment.getIndex()?.count).toBe(6); // the face triangle is dropped
    expect(garment.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ]);
    const position = garment.getAttribute("position");
    expect(position.count).toBe(6);
    expect(position.getZ(0)).toBeCloseTo(0.1 + 0.012); // pushed out along the normal
    expect(garment.morphAttributes.position?.[0]?.getX(0)).toBeCloseTo(0.01);
    expect(garment.morphTargetsRelative).toBe(true);
    expect(garment.getAttribute("coverage").getX(0)).toBeGreaterThan(0); // cut at 0 on the GPU
    const uv = garment.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it("bakes in the node transform", () => {
    const geometry = body();
    // Positions stored at half size, as a compressed model might, with the node scaling them back.
    const position = geometry.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < position.array.length; i++) position.array[i] = (position.array[i] ?? 0) / 2;
    const garment = buildGarmentGeometry(geometry, new Matrix4().makeScale(2, 2, 2), "tee");
    expect(garment.getIndex()?.count).toBe(6);
    expect(garment.getAttribute("position").getY(0)).toBeCloseTo(1.25);
    expect(garment.morphAttributes.position?.[0]?.getX(0)).toBeCloseTo(0.02);
  });
});

describe("room for a size", () => {
  const radial = (cm: number) => cm / (2 * Math.PI) / 100;

  it("is nothing without a chart", () => {
    expect(roomAt(null, landmarks.chestY, false)).toBe(0);
    expect(roomAt({}, landmarks.chestY, false)).toBe(0);
  });

  it("follows the chart's regions by height, filling gaps from neighbours", () => {
    const room = { chest: 10, waist: 4 };
    expect(roomAt(room, landmarks.chestY, false)).toBeCloseTo(radial(10));
    expect(roomAt(room, landmarks.waistY, false)).toBeCloseTo(radial(4));
    expect(roomAt(room, landmarks.hipJointY - 0.06, false)).toBeCloseTo(radial(4)); // hips: from the waist
    expect(roomAt(room, landmarks.neckY + 0.1, false)).toBe(0);
    expect(roomAt(room, 1.2, true)).toBeCloseTo(radial(3.5)); // sleeves: a share of the chest
  });

  it("moves vertices along their normals, never inside the body", () => {
    const garment = buildGarmentGeometry(
      (() => {
        const g = new BufferGeometry();
        g.setAttribute("position", new BufferAttribute(new Float32Array([0, 1.25, 0.1, 0.05, 1.25, 0.1, 0, 1.2, 0.1]), 3));
        g.setAttribute("normal", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
        g.setIndex([0, 1, 2]);
        return g;
      })(),
      new Matrix4(),
      "tee",
    );
    applyRoom(garment, { chest: 20, waist: 20 }, 0.012);
    expect(garment.getAttribute("position").getZ(0)).toBeCloseTo(0.112 + radial(20), 3); // just above the chest: a little less
    applyRoom(garment, { chest: -40, waist: -40 }, 0.012);
    expect(garment.getAttribute("position").getZ(0)).toBeCloseTo(0.104, 4); // 4 mm off the skin
    applyRoom(garment, null, 0.012);
    expect(garment.getAttribute("position").getZ(0)).toBeCloseTo(0.112, 4);
  });
});
