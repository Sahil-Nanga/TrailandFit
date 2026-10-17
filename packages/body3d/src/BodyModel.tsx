import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { type Mesh, MeshPhysicalMaterial, SRGBColorSpace, TextureLoader } from "three";

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

interface Props {
  shape: BodyShape;
  skinColor: string;
  /** Body texture with the face baked in (data URL); replaces the plain skin colour. */
  texture?: string | null;
  eyeColor?: string | null;
}

export function BodyModel({ shape, skinColor, texture = null, eyeColor = null }: Props) {
  const { nodes } = useGLTF(MODEL, false, true); // meshopt-compressed; no Draco
  const body = nodes.Body as Mesh;
  const dictionary = useMemo(() => body.morphTargetDictionary ?? {}, [body]);

  const influences = useMemo(() => influencesFor(dictionary, shape.weights), [dictionary, shape.weights]);

  const map = useMemo(() => {
    if (!texture) return null;
    const loaded = new TextureLoader().load(texture);
    loaded.flipY = false; // glTF UV layout
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 8;
    return loaded;
  }, [texture]);
  useEffect(() => () => map?.dispose(), [map]);

  const material = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: map ? "#ffffff" : skinColor, // the texture already carries the skin colour
        map,
        roughness: 0.55,
        sheen: 0.25,
        sheenRoughness: 0.8,
        sheenColor: "#ffd9c7",
      }),
    [skinColor, map],
  );
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
