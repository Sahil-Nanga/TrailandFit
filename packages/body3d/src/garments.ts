/**
 * Garments made from the body's own surface.
 *
 * A garment is the part of the body mesh it covers, pushed out along the surface normals by a
 * centimetre or so. It keeps the body's morph targets, so it reshapes with the measurements
 * exactly like the body (and the hair) does, with no fitting of its own. The shop's product
 * photo is projected flat onto the front; the back and sides use the garment's main colour.
 *
 * Which part of the body a garment covers comes from a few heights measured on the neutral
 * base body (garmentLandmarks.json, made by scripts/garment_landmarks.py). Coverage is decided
 * once on the neutral body, so it doesn't move when the body is reshaped. Each vertex carries
 * its distance inside the garment (`coverage`); the material cuts at 0 (see GarmentModel.tsx).
 *
 * Garments with a model of their own (GARMENT_TEMPLATES: MakeHuman CC0 clothes) use it instead of
 * the body's surface: real collars, hems and a skirt that is a skirt. They follow the body the
 * same way, through the same morph targets.
 *
 * Limits: no cloth simulation (folds come from the model, not the pose), and a photo of a
 * garment worn by a model maps less well than a flat product shot.
 */
import { BufferAttribute, BufferGeometry, Matrix3, type Matrix4, Vector3 } from "three";

import clothes from "./clothes.json";
import landmarks from "./garmentLandmarks.json";

export type GarmentCategory = "top" | "bottom";

/**
 * Extra room a size gives compared with a regular fit, in cm of circumference per region
 * (negative = tighter). From the shop's size chart; missing regions follow their neighbours.
 */
export interface GarmentRoom {
  chest?: number;
  waist?: number;
  hips?: number;
  thigh?: number;
}
export type GarmentStyle = "tee" | "longSleeve" | "shorts" | "trousers" | "skirt" | "briefs";

export const GARMENT_STYLES: Record<GarmentCategory, readonly GarmentStyle[]> = {
  top: ["tee", "longSleeve"],
  bottom: ["trousers", "shorts", "skirt"],
};

/** Garment models (MakeHuman CC0 clothes, see scripts/build_clothes.py) and the body vertices
 *  each covers. Styles without one are cut from the body's surface instead. */
export const GARMENT_TEMPLATES: Partial<Record<GarmentStyle, { source: string; hidden: number[] }>> = clothes;

// Words in product titles (English, Finnish, Swedish, German), matched as whole words.
const TEE_WORDS = ["t-shirt", "tshirt", "tee", "tank", "top", "vest", "polo", "singlet", "linne", "toppi"];
const LONG_TOP_WORDS = [
  "long sleeve", "long-sleeve", "longsleeve", "hoodie", "hood", "sweater", "sweatshirt", "jumper", "cardigan",
  "jacket", "coat", "pullover", "fleece", "blazer", "parka", "shirt", "blouse", "huppari", "neule", "takki",
  "pusero", "college", "tröja", "skjorta", "jacka", "kofta", "hemd", "pulli", "jacke",
];
const SHORT_BOTTOM_WORDS = ["shorts", "short", "bermuda", "shortsit", "sortsit"];
const SKIRT_WORDS = ["skirt", "hame", "kjol", "rock", "rok", "jupe", "falda", "gonna"];

function mentions(title: string, words: readonly string[]): boolean {
  const text = ` ${title.toLowerCase().replace(/[^a-z0-9äöåü-]+/g, " ")} `;
  return words.some((word) => text.includes(` ${word} `));
}

/** Best guess at the garment's shape from its title. */
export function garmentStyle(category: GarmentCategory, title: string): GarmentStyle {
  if (category === "bottom") {
    if (mentions(title, SKIRT_WORDS)) return "skirt";
    return mentions(title, SHORT_BOTTOM_WORDS) ? "shorts" : "trousers";
  }
  if (mentions(title, TEE_WORDS)) return "tee";
  return mentions(title, LONG_TOP_WORDS) ? "longSleeve" : "tee";
}

// --- coverage --------------------------------------------------------------------------------

const L = landmarks;
const BOTTOM_TOP_Y = (L.waistY + L.hipJointY) / 2; // waistband: between the waist and the hips

/** How far each style sits off the skin (metres). Tops sit over bottoms where they overlap. */
const OFFSET: Record<GarmentStyle, number> = {
  tee: 0.012,
  longSleeve: 0.014,
  shorts: 0.008,
  trousers: 0.008,
  skirt: 0.008,
  briefs: 0.003, // always worn, under everything
};
const BRIEFS_TOP_Y = L.hipJointY + 0.07;

/** Height range of the garment's front, for mapping the photo (image top -> bottom). */
const SPAN: Record<GarmentStyle, [number, number]> = {
  tee: [L.neckY - 0.02, L.hipJointY - 0.03],
  longSleeve: [L.neckY - 0.02, L.hipJointY - 0.06],
  shorts: [BOTTOM_TOP_Y, L.kneeY + 0.08],
  skirt: [BOTTOM_TOP_Y, L.kneeY + 0.02],
  briefs: [BRIEFS_TOP_Y, L.crotchY - 0.05],
  trousers: [BOTTOM_TOP_Y, L.ankleY + 0.035],
};

function torsoHalfWidth(y: number): number {
  const { y0, step, values } = L.torsoHalfWidth;
  const i = Math.round((y - y0) / step);
  return i < 0 || i >= values.length ? 0 : (values[i] ?? 0);
}

/** Below the armpits the arms are separate from the torso; anything outside it is arm. */
export function isArm(p: Vector3): boolean {
  if (p.y <= L.crotchY || p.y >= L.neckY) return false;
  const half = torsoHalfWidth(p.y);
  return half > 0 && Math.abs(p.x) > half + 0.005;
}

const NECK_HALF_WIDTH = 0.075; // the neckline is cut low only this close to the middle
const OUTSIDE = -1;

/** The neckline: low at the neck, higher over the shoulders so they stay covered. */
function belowNeckline(p: Vector3): number {
  return (Math.abs(p.x) < NECK_HALF_WIDTH ? L.neckY - 0.035 : L.neckY + 0.04) - p.y;
}

/**
 * How far inside the garment a point on the neutral body is (metres; negative = outside).
 * Interpolated across each triangle and cut at 0 on the GPU, so hems are straight lines
 * rather than following the mesh's triangles.
 */
export function coverage(style: GarmentStyle, p: Vector3): number {
  const [top, bottom] = SPAN[style];
  const arm = isArm(p);
  switch (style) {
    case "tee":
      return arm ? p.y - (L.shoulderY - 0.15) : Math.min(belowNeckline(p), p.y - bottom);
    case "longSleeve":
      return arm ? p.y - (L.wristY + 0.01) : Math.min(belowNeckline(p), p.y - bottom);
    case "briefs": {
      // Leg openings rise from the crotch towards the outside of the hips.
      const leg = L.crotchY - 0.05 + Math.max(0, Math.abs(p.x) - 0.06);
      return arm ? OUTSIDE : Math.min(BRIEFS_TOP_Y - p.y, p.y - leg);
    }
    case "shorts":
    case "skirt": // cut from the body, a skirt can only be shorts
    case "trousers":
      return arm ? OUTSIDE : Math.min(top - p.y, p.y - bottom);
  }
}

/** Whether a point on the neutral body (metres, y up, feet at 0) is under this garment. */
export function covers(style: GarmentStyle, p: Vector3): boolean {
  return coverage(style, p) > 0;
}

// --- room (size) ------------------------------------------------------------------------------

const MIN_OFFSET = 0.004; // a tight size still can't go inside the body
const MAX_EXTRA = 0.08;
const SLEEVE_SHARE = 0.35; // sleeves get this share of the chest's extra room

/** Extra distance off the body (metres) at a height on the neutral body, for this room. */
export function roomAt(room: GarmentRoom | null | undefined, y: number, sleeve: boolean): number {
  if (!room) return 0;
  const knots: [number, number | undefined][] = [
    [L.neckY, 0],
    [L.shoulderY, room.chest === undefined ? undefined : room.chest * 0.5],
    [L.chestY, room.chest],
    [L.waistY, room.waist],
    [L.hipJointY - 0.06, room.hips],
    [L.crotchY - 0.08, room.thigh],
    [L.ankleY, room.thigh === undefined ? undefined : room.thigh * 0.6],
  ];
  // Fill a missing region from the nearest one that is given (none given: no change).
  const given = knots.filter((k): k is [number, number] => k[1] !== undefined);
  if (given.length <= 1) return 0; // only the neck: nothing from the chart
  const filled = knots.map(([ky, value]): [number, number] => {
    if (value !== undefined) return [ky, value];
    const nearest = given.reduce((a, b) => (Math.abs(b[0] - ky) < Math.abs(a[0] - ky) ? b : a));
    return [ky, nearest[1]];
  });
  let cm = filled[filled.length - 1]?.[1] ?? 0;
  if (y >= L.neckY) cm = 0;
  for (let i = 0; i + 1 < filled.length; i++) {
    const [y0, v0] = filled[i] ?? [0, 0];
    const [y1, v1] = filled[i + 1] ?? [0, 0];
    if (y <= y0 && y >= y1) {
      cm = v0 + ((v1 - v0) * (y0 - y)) / (y0 - y1);
      break;
    }
  }
  if (sleeve) cm = (room.chest ?? room.waist ?? 0) * SLEEVE_SHARE;
  return Math.min(MAX_EXTRA, cm / (2 * Math.PI) / 100);
}

/**
 * Loosen or tighten a garment for a size: each vertex sits at its rest position pushed out
 * along its normal by the size's extra room at its height (attributes: rest, restY, sleeve).
 */
export function applyRoom(geometry: BufferGeometry, room: GarmentRoom | null | undefined, baseOffset: number): void {
  const rest = geometry.getAttribute("rest");
  const restY = geometry.getAttribute("restY");
  const sleeve = geometry.getAttribute("sleeve");
  const normal = geometry.getAttribute("normal");
  const position = geometry.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const extra = Math.max(MIN_OFFSET - baseOffset, roomAt(room, restY.getX(i), sleeve.getX(i) > 0));
    position.setXYZ(
      i,
      rest.getX(i) + normal.getX(i) * extra,
      rest.getY(i) + normal.getY(i) * extra,
      rest.getZ(i) + normal.getZ(i) * extra,
    );
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** Distance off the skin (for applyRoom): set for the shells, about 5 mm for the templates. */
export function shellOffset(style: GarmentStyle, template = false): number {
  return template ? 0.005 : OFFSET[style];
}

// --- geometry ----------------------------------------------------------------------------------

/**
 * The garment's mesh: cut from the body's geometry, or (`template`) a garment model of its own
 * that already sits on the body. `nodeMatrix` is the source node's transform (compressed models
 * keep a dequantizing scale/offset there); it's baked in, so render the result without it.
 * Two groups: 0 = front (photo), 1 = back and sides (plain colour).
 */
export function buildGarmentGeometry(
  body: BufferGeometry,
  nodeMatrix: Matrix4,
  style: GarmentStyle,
  template = false,
): BufferGeometry {
  const position = body.getAttribute("position");
  const normal = body.getAttribute("normal");
  const index = body.getIndex();
  if (!index) throw new Error("The body mesh must be indexed");
  const linear = new Matrix3().setFromMatrix4(nodeMatrix);
  const normalMatrix = new Matrix3().getNormalMatrix(nodeMatrix);

  const count = position.count;
  const base = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const inside = new Float32Array(count);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(nodeMatrix);
    n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    p.toArray(base, i * 3);
    n.toArray(normals, i * 3);
    inside[i] = template ? 1 : coverage(style, p);
  }

  // Triangles at least partly under the garment (the rest is cut away on the GPU), split
  // into front-facing and the rest.
  const front: number[] = [];
  const back: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (Math.max(inside[a] ?? 0, inside[b] ?? 0, inside[c] ?? 0) <= 0) continue;
    const facing = (normals[a * 3 + 2] ?? 0) + (normals[b * 3 + 2] ?? 0) + (normals[c * 3 + 2] ?? 0);
    (facing > 0 ? front : back).push(a, b, c);
  }

  // Keep only the vertices those triangles use.
  const remap = new Int32Array(count).fill(-1);
  const used: number[] = [];
  for (const v of [...front, ...back]) {
    if (remap[v] === -1) {
      remap[v] = used.length;
      used.push(v);
    }
  }

  // The photo spans the garment's front: its width to the image's width, its height range
  // (SPAN) to the image's height.
  let halfWidth = 0;
  for (const v of front) if ((inside[v] ?? 0) > 0) halfWidth = Math.max(halfWidth, Math.abs(base[v * 3] ?? 0));
  const [top, bottom] = SPAN[style];

  const offset = template ? 0 : OFFSET[style];
  const positions = new Float32Array(used.length * 3);
  const outNormals = new Float32Array(used.length * 3);
  const uvs = new Float32Array(used.length * 2);
  const cut = new Float32Array(used.length);
  const restY = new Float32Array(used.length);
  const sleeve = new Float32Array(used.length);
  used.forEach((v, i) => {
    for (let k = 0; k < 3; k++) {
      const nk = normals[v * 3 + k] ?? 0;
      positions[i * 3 + k] = (base[v * 3 + k] ?? 0) + nk * offset;
      outNormals[i * 3 + k] = nk;
    }
    cut[i] = inside[v] ?? 0;
    const x = base[v * 3] ?? 0;
    const y = base[v * 3 + 1] ?? 0;
    restY[i] = y;
    sleeve[i] = isArm(p.set(x, y, base[v * 3 + 2] ?? 0)) ? 1 : 0;
    uvs[i * 2] = clamp01(0.5 + x / (2 * (halfWidth || 1)));
    uvs[i * 2 + 1] = 1 - clamp01((top - y) / (top - bottom)); // flipY texture: v = 1 is the top
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("rest", new BufferAttribute(positions.slice(), 3));
  geometry.setAttribute("restY", new BufferAttribute(restY, 1));
  geometry.setAttribute("sleeve", new BufferAttribute(sleeve, 1));
  geometry.setAttribute("normal", new BufferAttribute(outNormals, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("coverage", new BufferAttribute(cut, 1));
  geometry.setIndex([...front, ...back].map((v) => remap[v] ?? 0));
  geometry.addGroup(0, front.length, 0);
  geometry.addGroup(front.length, back.length, 1);

  // Same morph targets as the body (relative offsets), so the garment reshapes with it.
  const morphs = body.morphAttributes.position ?? [];
  geometry.morphAttributes.position = morphs.map((morph) => {
    const deltas = new Float32Array(used.length * 3);
    used.forEach((v, i) => {
      p.fromBufferAttribute(morph, v).applyMatrix3(linear);
      p.toArray(deltas, i * 3);
    });
    return new BufferAttribute(deltas, 3);
  });
  geometry.morphTargetsRelative = true;
  geometry.computeBoundingSphere();
  return geometry;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
