import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { BufferAttribute, type Mesh, MeshPhysicalMaterial, SRGBColorSpace, TextureLoader, Vector3 } from "three";

import { assetUrl } from "./assets";
import calibration from "./calibration.json";
import { influencesFor } from "./influences";
import type { BodyShape, MorphName } from "./morphs";

const MODEL = assetUrl("models/body.glb");
type Vec3 = [number, number, number];

/** Eye centres follow the morphs linearly (the base mesh has sockets, not eyeballs). */
function eyePosition(side: "l" | "r", weights: BodyShape["weights"]): Vec3 {
  const [x, y, z] = calibration.eyes.base[side];
  let position: Vec3 = [x ?? 0, y ?? 0, z ?? 0];
  for (const [name, weight] of Object.entries(weights) as [MorphName, number][]) {
    const [dx, dy, dz] = calibration.eyes.deltas[name][side];
    position = [position[0] + weight * (dx ?? 0), position[1] + weight * (dy ?? 0), position[2] + weight * (dz ?? 0)];
  }
  return position;
}

/** Skip the body's surface where `hidden` is set (under a garment), so skin can't poke through. */
function hideCovered(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float hidden;\nvarying float vHidden;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHidden = hidden;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vHidden;")
    .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vHidden > 0.5) discard;");
}

/** Points on the neutral base body: x, y, z in whole millimetres, flattened. */
export type BodyPoints = readonly number[];

/** Flags for the body's vertices at any of these points (to the millimetre, give or take one:
 *  compression stores positions quantized). Seam duplicates share a position, so all match. */
function flagPoints(body: Mesh, points: BodyPoints): Float32Array {
  const position = body.geometry.getAttribute("position");
  const flags = new Float32Array(position.count);
  if (points.length === 0) return flags;
  const wanted = new Set<string>();
  for (let i = 0; i + 2 < points.length; i += 3) wanted.add(`${points[i]},${points[i + 1]},${points[i + 2]}`);
  body.updateMatrix();
  const p = new Vector3();
  for (let v = 0; v < position.count; v++) {
    p.fromBufferAttribute(position, v).applyMatrix4(body.matrix).multiplyScalar(1000);
    const [x, y, z] = [Math.round(p.x), Math.round(p.y), Math.round(p.z)];
    search: for (const dx of [0, -1, 1])
      for (const dy of [0, -1, 1])
        for (const dz of [0, -1, 1])
          if (wanted.has(`${x + dx},${y + dy},${z + dz}`)) {
            flags[v] = 1;
            break search;
          }
  }
  return flags;
}

interface Props {
  shape: BodyShape;
  /** Parts of the body covered by garment models (hidden so skin can't poke through). */
  hidden?: BodyPoints | null;
  skinColor: string;
  /** Body texture with the face baked in (data URL); replaces the plain skin colour. */
  texture?: string | null;
  eyeColor?: string | null;
}

export function BodyModel({ shape, skinColor, texture = null, eyeColor = null, hidden = null }: Props) {
  const { nodes } = useGLTF(MODEL, false, true); // meshopt-compressed; no Draco
  const body = nodes.Body as Mesh;
  const dictionary = useMemo(() => body.morphTargetDictionary ?? {}, [body]);

  const influences = useMemo(() => influencesFor(dictionary, shape.weights), [dictionary, shape.weights]);

  // The geometry is shared (useGLTF caches it), so the hidden flags are rewritten each time.
  const hiddenKey = hidden?.length ? `${hidden.length}:${hidden[0]}:${hidden[hidden.length - 1]}` : "";
  useEffect(() => {
    body.geometry.setAttribute("hidden", new BufferAttribute(flagPoints(body, hidden ?? []), 1));
  }, [body, hiddenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const map = useMemo(() => {
    if (!texture) return null;
    const loaded = new TextureLoader().load(texture);
    loaded.flipY = false; // glTF UV layout
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 8;
    return loaded;
  }, [texture]);
  useEffect(() => () => map?.dispose(), [map]);

  const material = useMemo(() => {
    const skin = new MeshPhysicalMaterial({
      color: map ? "#ffffff" : skinColor, // the texture already carries the skin colour
      map,
      roughness: 0.55,
      sheen: 0.25,
      sheenRoughness: 0.8,
      sheenColor: "#ffd9c7",
    });
    skin.onBeforeCompile = hideCovered;
    return skin;
  }, [skinColor, map]);
  useEffect(() => () => material.dispose(), [material]);

  return (
    <group scale={shape.scale}>
      {/* Keep the node transform: compression stores positions quantized and moves the
          dequantizing scale/offset onto the node. */}
      <mesh
        position={body.position}
        quaternion={body.quaternion}
        scale={body.scale}
        geometry={body.geometry}
        material={material}
        morphTargetDictionary={dictionary}
        morphTargetInfluences={influences}
        castShadow
        receiveShadow
      />
      {(["l", "r"] as const).map((side) => (
        <mesh key={side} position={eyePosition(side, shape.weights)} castShadow>
          <sphereGeometry args={[0.0115, 24, 16]} />
          <meshPhysicalMaterial color={eyeColor ?? "#3a2a22"} roughness={0.15} clearcoat={1} />
        </mesh>
      ))}
    </group>
  );
}

useGLTF.preload(MODEL, false, true);
