"use client";

/**
 * AvatarViewer: the 3D try-on preview. The body comes from the shared @aurora/body3d package
 * (MakeHuman CC0 base body), shaped by the body-fit service from the active profile's
 * measurements, with the face from the user's kept front photo when they opted in.
 *
 * - `measurements`: the active profile's body measurements, always in centimetres/kilograms.
 *   Only `height_cm` is guaranteed; any other field may be null.
 * - `outfit.top` / `outfit.bottom`: the garments the user picked, or null for "nothing".
 *   Drawn as close-fitting shells cut from the body (see @aurora/body3d garments.ts), with the
 *   product picture on the front, loosened or tightened for the chosen size when the shop
 *   had a size chart. No drape.
 * - `photos`: the user's own front/side photos, only if they opted in to keeping them.
 *   Short-lived signed URLs (about 10 minutes): loaded when needed, never stored, logged or
 *   forwarded anywhere except the body-fit service that bakes the face.
 *
 * three.js is only loaded on this page: the scene is a client-only lazy import.
 */
import type { Measurements } from "@aurora/api-client";
import type { GarmentRoom } from "@aurora/body3d";
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

export interface Garment {
  id: string;
  category: "top" | "bottom";
  title: string;
  /** Product page in the shop. */
  url: string;
  /** Product image from the shop, if one was captured when saving. */
  imageUrl: string | null;
  /** The size being tried and its extra room over a regular fit (null: no size chart). */
  size: string | null;
  room: GarmentRoom | null;
}

export interface Outfit {
  top: Garment | null;
  bottom: Garment | null;
}

export interface UserPhotos {
  front: string | null;
  side: string | null;
}

export interface AvatarViewerProps {
  measurements: Measurements;
  outfit: Outfit;
  /** The user's own photos (opt-in only); null fields when not kept. */
  photos: UserPhotos;
  className?: string;
}

const AvatarScene = dynamic(() => import("./avatar-scene").then((m) => m.AvatarScene), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[3/4] w-full rounded-xl" />,
});

export function AvatarViewer(props: AvatarViewerProps) {
  return <AvatarScene {...props} />;
}
