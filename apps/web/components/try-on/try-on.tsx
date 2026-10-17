"use client";

import type { SavedItem } from "@aurora/api-client";
import { FIELD_INFO, formatForInput, unitLabel } from "@aurora/measurements";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useActiveProfile } from "@/components/active-profile";
import { GarmentImage } from "@/components/garment-image";
import { AvatarViewer, type Garment, type Outfit, type UserPhotos } from "@/components/try-on/avatar-viewer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useUnits } from "@/lib/use-units";
import { shopName, useWardrobe } from "@/lib/wardrobe";

function toGarment(item: SavedItem, category: "top" | "bottom"): Garment {
  return {
    id: item.id,
    category,
    title: item.title ?? shopName(item.url),
    url: item.url,
    imageUrl: item.image_url,
  };
}

const SUMMARY_FIELDS = ["height_cm", "chest_cm", "waist_cm", "hips_cm", "inseam_cm"] as const;

export function TryOn() {
  const { active, profiles } = useActiveProfile();
  const { state } = useWardrobe();
  const [units] = useUnits();
  const [outfit, setOutfit] = useState<Outfit>({ top: null, bottom: null });
  const [photos, setPhotos] = useState<UserPhotos>({ front: null, side: null });
  const activeId = active?.id ?? null;

  // The active profile's kept photos (opt-in), as short-lived signed URLs.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void api
      .GET("/v1/profiles/{profile_id}/photos", { params: { path: { profile_id: activeId } } })
      .then(({ data }) => {
        if (cancelled) return;
        setPhotos({
          front: data?.find((p) => p.kind === "front")?.url ?? null,
          side: data?.find((p) => p.kind === "side")?.url ?? null,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  if (profiles === null || state.kind === "loading") {
    return (
      <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]" aria-busy="true" aria-label="Loading">
        <Skeleton className="aspect-[3/4] rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (!active) {
    return (
      <div className="space-y-4 rounded-xl border border-dashed p-8 text-center">
        <p className="font-medium">Add your measurements first</p>
        <Link href="/" className={buttonVariants()}>
          Get your measurements
        </Link>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  const tops = state.items.filter((i) => i.category === "top");
  const bottoms = state.items.filter((i) => i.category === "bottom");

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-start">
      <div className="space-y-3 md:sticky md:top-6">
        <AvatarViewer measurements={active.measurements} outfit={outfit} photos={photos} className="aspect-[3/4] w-full" />
        <p className="text-sm text-muted-foreground">
          Showing <span className="font-medium text-foreground">{active.name}</span>:{" "}
          {SUMMARY_FIELDS.filter((f) => active.measurements[f] != null)
            .map((f) => `${FIELD_INFO[f].label.toLowerCase()} ${formatForInput(f, active.measurements[f], units)} ${unitLabel(f, units)}`)
            .join(", ")}
          . Switch profile in the top right.
        </p>
      </div>

      <div className="space-y-8">
        <GarmentPicker
          legend="Top"
          items={tops}
          selected={outfit.top?.id ?? null}
          onSelect={(item) => setOutfit((o) => ({ ...o, top: item ? toGarment(item, "top") : null }))}
        />
        <GarmentPicker
          legend="Bottom (trousers or shorts)"
          items={bottoms}
          selected={outfit.bottom?.id ?? null}
          onSelect={(item) => setOutfit((o) => ({ ...o, bottom: item ? toGarment(item, "bottom") : null }))}
        />
        {state.items.length > 0 && tops.length + bottoms.length < state.items.length && (
          <p className="text-xs text-muted-foreground">
            Some saved items are marked &ldquo;Other&rdquo;. Change their type on the{" "}
            <Link href="/wardrobe" className="text-primary underline underline-offset-4">
              Wardrobe
            </Link>{" "}
            page to use them here.
          </p>
        )}
      </div>
    </div>
  );
}

function GarmentPicker({
  legend,
  items,
  selected,
  onSelect,
}: {
  legend: string;
  items: SavedItem[];
  selected: string | null;
  onSelect: (item: SavedItem | null) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 font-medium">{legend}</legend>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          None saved yet. Save one from a shop with the extension.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          <Option checked={selected === null} label="None" onChange={() => onSelect(null)} name={legend}>
            <div className="grid aspect-[3/4] w-full place-items-center rounded-md bg-muted text-xs text-muted-foreground">
              None
            </div>
          </Option>
          {items.map((item) => {
            const title = item.title ?? shopName(item.url);
            return (
              <Option key={item.id} checked={selected === item.id} label={title} onChange={() => onSelect(item)} name={legend}>
                <GarmentImage src={item.image_url} alt="" category={item.category} className="aspect-[3/4] w-full rounded-md" />
                <span className="line-clamp-2 text-xs">{title}</span>
              </Option>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function Option({
  checked,
  label,
  name,
  onChange,
  children,
}: {
  checked: boolean;
  label: string;
  name: string;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex cursor-pointer flex-col gap-1 rounded-lg border p-1.5 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/30 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" aria-label={label} />
      {children}
      {checked && (
        <span className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check aria-hidden className="size-3" />
        </span>
      )}
    </label>
  );
}
