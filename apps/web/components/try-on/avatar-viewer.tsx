"use client";

/**
 * AvatarViewer — the slot for the 3D try-on renderer.
 *
 * TEAMMATE: replace the body of this component with the renderer. Keep the props interface
 * stable (or change it together with app/try-on). Everything the renderer needs is passed in:
 *
 * - `measurements`: the active profile's body measurements, always in centimetres/kilograms.
 *   Only `height_cm` is guaranteed; any other field may be null.
 * - `outfit.top` / `outfit.bottom`: the garments the user picked, or null for "nothing".
 *   Each has the product page URL, title and (usually) a product image URL from the shop.
 * - `photos`: the user's own front/side photos, only if they opted in to keeping them.
 *   These are short-lived signed URLs (about 10 minutes): load them when needed, never store,
 *   log or forward them. The page re-fetches fresh URLs when the profile changes.
 *
 * Constraints from CLAUDE.md: no measurement values in logs, and 3D dependencies
 * (three.js / react-three-fiber) are added when this renderer is integrated, not before.
 */
import type { Measurements } from "@aurora/api-client";
import { Box } from "lucide-react";

export interface Garment {
  id: string;
  category: "top" | "bottom";
  title: string;
  /** Product page in the shop. */
  url: string;
  /** Product image from the shop, if one was captured when saving. */
  imageUrl: string | null;
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

export function AvatarViewer({ outfit, photos, className }: AvatarViewerProps) {
  const wearing = [outfit.top?.title, outfit.bottom?.title].filter(Boolean).join(" + ");
  return (
    <div
      role="img"
      aria-label={wearing ? `3D preview placeholder, wearing ${wearing}` : "3D preview placeholder"}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/30 bg-secondary/50 p-6 text-center ${className ?? ""}`}
    >
      <Box aria-hidden className="size-10 text-primary" />
      <p className="font-medium">3D preview coming soon</p>
      <p className="max-w-56 text-sm text-muted-foreground">
        {wearing ? `Will show you wearing ${wearing}.` : "Pick a top and a bottom to see the outfit here."}
      </p>
      <p className="text-xs text-muted-foreground">
        {photos.front ? "Your kept photos will be used for the preview." : "No photos kept for this profile."}
      </p>
    </div>
  );
}
