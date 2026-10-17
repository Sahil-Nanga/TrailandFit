"use client";

import {
  BodyModel,
  bakeLikenessFromUrl,
  HAIR_COLORS,
  HAIR_STYLES,
  HairModel,
  type HairStyle,
  type Likeness,
  LikenessError,
  Stage,
  useFittedShape,
} from "@aurora/body3d";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { AvatarViewerProps } from "./avatar-viewer";

const BODY_FIT_URL = process.env.NEXT_PUBLIC_BODY_FIT_URL ?? "http://127.0.0.1:8001";
const NO_HAIR = "none";

type FaceState =
  | { kind: "none" }
  | { kind: "working" }
  | { kind: "ready"; likeness: Likeness }
  | { kind: "error"; message: string };

/**
 * Bake the face from the kept front photo once per photo URL. Only the resulting texture is
 * kept, in memory; the photo itself is fetched, sent to the body-fit service and dropped.
 */
function usePhotoFace(photoUrl: string | null, weights: Record<string, number>, bodyType: number): FaceState {
  const latest = useRef({ weights, bodyType });
  useEffect(() => {
    latest.current = { weights, bodyType };
  });
  const [result, setResult] = useState<{ url: string; state: FaceState } | null>(null);

  useEffect(() => {
    if (!photoUrl) return;
    const controller = new AbortController();
    const { weights: w, bodyType: b } = latest.current;
    bakeLikenessFromUrl(BODY_FIT_URL, photoUrl, w, b, controller.signal)
      .then((likeness) => setResult({ url: photoUrl, state: { kind: "ready", likeness } }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof LikenessError ? error.message : "We couldn't use your photo. Please try again later.";
        setResult({ url: photoUrl, state: { kind: "error", message } });
      });
    return () => controller.abort();
  }, [photoUrl]);

  if (!photoUrl) return { kind: "none" };
  return result?.url === photoUrl ? result.state : { kind: "working" };
}

export function AvatarScene({ measurements, outfit, photos, className }: AvatarViewerProps) {
  const [sex, setSex] = useState<"female" | "male">("female");
  const bodyType = sex === "male" ? 1 : 0; // the body's base shape: 0 female, 1 male
  const [hair, setHair] = useState<HairStyle | null>("short");
  const [hairColor, setHairColor] = useState(HAIR_COLORS[1]?.color ?? "#5c4232");
  const [showFace, setShowFace] = useState(true);

  const { shape, status } = useFittedShape(BODY_FIT_URL, measurements, bodyType);
  const face = usePhotoFace(photos.front, shape.weights, bodyType);
  const likeness = showFace && face.kind === "ready" ? face.likeness : null;
  const wearing = [outfit.top?.title, outfit.bottom?.title].filter(Boolean).join(" + ");

  return (
    <div className="space-y-4">
      <div
        role="img"
        aria-label="3D preview of your body. Drag to turn it, scroll or pinch to zoom."
        className={`relative overflow-hidden rounded-xl border bg-secondary/40 ${className ?? ""}`}
      >
        <Stage focusHeight={measurements.height_cm / 100} background={null}>
          <BodyModel shape={shape} skinColor="#c99a7a" texture={likeness?.texture} eyeColor={likeness?.eyeColor} />
          {hair && (
            <Suspense fallback={null}>
              <HairModel style={hair} color={hairColor} shape={shape} />
            </Suspense>
          )}
        </Stage>
        <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground" role="status">
          {status === "fitting" && "Shaping the body to your measurements…"}
          {status === "fitted" && "Shaped to your measurements."}
          {status === "offline" && "Quick estimate of your shape (the fitting service isn't running)."}
          {face.kind === "working" && " Adding your face…"}
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        {wearing ? `Picked: ${wearing}. ` : ""}
        Clothes aren&rsquo;t drawn on the body yet; this preview shows your shape, face and hair.
      </p>

      <div className="space-y-2">
        <p className="text-sm font-medium">Face</p>
        {face.kind === "none" && (
          <p className="text-sm text-muted-foreground">
            No photo kept for this profile.{" "}
            <Link href="/measure/photo" className="text-primary underline underline-offset-4">
              Measure from a photo
            </Link>{" "}
            and tick &ldquo;Keep my photos&rdquo; to see your face here.
          </p>
        )}
        {face.kind === "working" && <p className="text-sm text-muted-foreground">Matching your face from your kept photo…</p>}
        {face.kind === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {face.message}
          </p>
        )}
        {face.kind === "ready" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {showFace ? "From your kept front photo. It's a flat photo on the head, so it looks best from the front." : "Face hidden."}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowFace((v) => !v)}>
              {showFace ? "Hide my face" : "Show my face"}
            </Button>
          </div>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Body</legend>
        <ToggleGroup
          aria-label="Body"
          variant="outline"
          spacing={0}
          value={[sex]}
          onValueChange={(next) => {
            const picked = next.find((option) => option !== sex);
            if (picked === "female" || picked === "male") setSex(picked);
          }}
        >
          <ToggleGroupItem value="female">Female</ToggleGroupItem>
          <ToggleGroupItem value="male">Male</ToggleGroupItem>
        </ToggleGroup>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Hair</legend>
        <ToggleGroup
          aria-label="Hair style"
          variant="outline"
          spacing={0}
          className="flex-wrap"
          value={[hair ?? NO_HAIR]}
          onValueChange={(next) => {
            const picked = next.find((option) => option !== (hair ?? NO_HAIR));
            if (picked) setHair(picked === NO_HAIR ? null : (picked as HairStyle));
          }}
        >
          {[NO_HAIR, ...HAIR_STYLES].map((style) => (
            <ToggleGroupItem key={style} value={style} className="capitalize">
              {style}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex gap-2 pt-1" role="group" aria-label="Hair colour">
          {HAIR_COLORS.map((c) => (
            <button
              key={c.name}
              type="button"
              aria-label={c.name}
              aria-pressed={hairColor === c.color}
              disabled={hair === null}
              onClick={() => setHairColor(c.color)}
              className="size-7 rounded-full border-2 border-background shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 aria-pressed:shadow-[0_0_0_2px_var(--primary)]"
              style={{ background: c.color }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
