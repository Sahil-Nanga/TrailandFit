import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import { type Mesh, MeshStandardMaterial } from "three";

import { assetUrl } from "./assets";
import { influencesFor } from "./influences";
import type { BodyShape } from "./morphs";

export const HAIR_STYLES = ["short", "bob", "long", "ponytail"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

const url = (style: HairStyle) => assetUrl(`models/hair/${style}.glb`);

export const HAIR_COLORS = [
  { name: "Black", color: "#3a3330" },
  { name: "Dark brown", color: "#5c4232" },
  { name: "Brown", color: "#8f6440" },
  { name: "Blonde", color: "#ecd096" },
  { name: "Red", color: "#b85c3c" },
  { name: "Grey", color: "#cfcac4" },
];

/** MakeHuman hair (CC0), fitted to the body with the same morph weights and scale. */
export function HairModel({ style, color, shape }: { style: HairStyle; color: string; shape: BodyShape }) {
  const { nodes } = useGLTF(url(style), false, true);
  const hair = nodes.Hair as Mesh;
  const dictionary = useMemo(() => hair.morphTargetDictionary ?? {}, [hair]);
  const influences = useMemo(() => influencesFor(dictionary, shape.weights), [dictionary, shape.weights]);
  // The strands are neutral grey; the colour tints them.
  const material = useMemo(() => {
    const source = hair.material as MeshStandardMaterial;
    return new MeshStandardMaterial({
      map: source.map,
      color,
      alphaTest: 0.4,
      side: source.side,
      roughness: 0.7,
    });
  }, [hair, color]);

  return (
    <group scale={shape.scale}>
      <mesh
        position={hair.position}
        quaternion={hair.quaternion}
        scale={hair.scale}
        geometry={hair.geometry}
        material={material}
        morphTargetDictionary={dictionary}
        morphTargetInfluences={influences}
        castShadow
      />
    </group>
  );
}
