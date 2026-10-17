import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { ReactNode } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

import { assetUrl } from "./assets";

const HDRI = assetUrl("hdri/studio_small_09_1k.hdr");

/** Studio look: HDRI lighting, one soft key light with shadows, contact shadow, orbit controls. */
interface StageProps {
  focusHeight: number;
  /** Scene background; null keeps the canvas transparent so the page shows through. */
  background?: string | null;
  children: ReactNode;
}

export function Stage({ focusHeight, background = "#f7f5fb", children }: StageProps) {
  const target: [number, number, number] = [0, focusHeight * 0.55, 0];
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 30, position: [0, focusHeight * 0.6, 4.6], near: 0.1, far: 50 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0, outputColorSpace: SRGBColorSpace }}
    >
      {background && <color attach="background" args={[background]} />}
      <Environment files={HDRI} environmentIntensity={0.9} />
      <directionalLight
        position={[2.5, 4, 3]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-1.5}
        shadow-camera-right={1.5}
        shadow-camera-top={2.5}
        shadow-camera-bottom={-0.5}
      />
      {children}
      <ContactShadows position={[0, 0.001, 0]} scale={4} blur={2.4} opacity={0.45} far={2} />
      <OrbitControls target={target} enablePan={false} minDistance={1.5} maxDistance={8} maxPolarAngle={Math.PI * 0.55} />
    </Canvas>
  );
}
