import { useGLTF } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo } from "react";
import {
  DoubleSide,
  type Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type WebGLProgramParametersWithUniforms,
} from "three";

import { assetUrl } from "./assets";
import {
  applyRoom,
  buildGarmentGeometry,
  GARMENT_TEMPLATES,
  type GarmentRoom,
  type GarmentStyle,
  shellOffset,
} from "./garments";
import { influencesFor } from "./influences";
import type { BodyShape } from "./morphs";

const MODEL = assetUrl("models/body.glb");
const NEUTRAL = "#9aa0a6"; // while the picture loads, or when there is none

/** Cut the garment where its interpolated `coverage` drops below 0: straight hems and cuffs. */
function cutAtHems(shader: WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float coverage;\nvarying float vCoverage;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCoverage = coverage;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vCoverage;")
    .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vCoverage < 0.0) discard;");
}

function fabric(options: ConstructorParameters<typeof MeshStandardMaterial>[0]) {
  // Both sides: through a hem or cuff you see the inside of the garment (the skin under it is hidden).
  const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: DoubleSide, ...options });
  material.onBeforeCompile = cutAtHems;
  return material;
}

interface Props {
  style: GarmentStyle;
  shape: BodyShape;
  /** Product picture as a texture (data URL), projected onto the front. */
  texture?: string | null;
  /** The garment's main colour, for the back and sides. */
  color?: string | null;
  /** Extra room of the chosen size compared with a regular fit (from the shop's size chart). */
  room?: GarmentRoom | null;
}

const templateUrl = (style: GarmentStyle) => assetUrl(`models/clothes/${style}.glb`);

/** A garment on the body (see garments.ts): its own model when there is one, else cut from
 *  the body's surface. Either way it reshapes with the body's morphs. */
export function GarmentModel(props: Props) {
  return GARMENT_TEMPLATES[props.style] ? <TemplateGarment {...props} /> : <ShellGarment {...props} />;
}

function TemplateGarment(props: Props) {
  const { nodes } = useGLTF(templateUrl(props.style), false, true);
  return <Garment {...props} source={nodes.Garment as Mesh} template />;
}

function ShellGarment(props: Props) {
  const { nodes } = useGLTF(MODEL, false, true);
  return <Garment {...props} source={nodes.Body as Mesh} template={false} />;
}

function Garment({
  style,
  shape,
  texture = null,
  color = null,
  room = null,
  source,
  template,
}: Props & { source: Mesh; template: boolean }) {
  const dictionary = useMemo(() => source.morphTargetDictionary ?? {}, [source]);
  const influences = useMemo(() => influencesFor(dictionary, shape.weights), [dictionary, shape.weights]);

  const geometry = useMemo(() => {
    source.updateMatrix();
    return buildGarmentGeometry(source.geometry, source.matrix, style, template);
  }, [source, style, template]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const roomKey = JSON.stringify(room);
  // Before paint, so a size change never shows a frame of the previous size.
  useLayoutEffect(() => applyRoom(geometry, room, shellOffset(style, template)), [geometry, roomKey, style, template]); // eslint-disable-line react-hooks/exhaustive-deps

  const map = useMemo(() => {
    if (!texture) return null;
    const loaded = new TextureLoader().load(texture);
    loaded.colorSpace = SRGBColorSpace;
    loaded.anisotropy = 8;
    return loaded;
  }, [texture]);
  useEffect(() => () => map?.dispose(), [map]);

  const materials = useMemo(() => {
    const plain = color ?? NEUTRAL;
    return [fabric({ map, color: map ? "#ffffff" : plain }), fabric({ color: plain })];
  }, [map, color]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  return (
    <group scale={shape.scale}>
      {/* The body node's transform is baked into the garment geometry. */}
      <mesh
        geometry={geometry}
        material={materials}
        morphTargetDictionary={dictionary}
        morphTargetInfluences={influences}
        castShadow
        receiveShadow
      />
    </group>
  );
}
