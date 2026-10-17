"use client";

import type { Measurements, SavedItem } from "@aurora/api-client";
import type { GarmentRoom } from "@aurora/body3d";
import {
  FIELD_INFO,
  type FitWord,
  fitWord,
  formatForInput,
  REGULAR_EASE,
  type SizeChart,
  type SizeOption,
  sizeEase,
  sizeOptions,
  suggestedLabel,
  unitLabel,
} from "@aurora/measurements";
import { Check } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useActiveProfile } from "@/components/active-profile";
import { GarmentImage } from "@/components/garment-image";
import { AvatarViewer, type Garment, type Outfit, type UserPhotos } from "@/components/try-on/avatar-viewer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useUnits } from "@/lib/use-units";
import { shopName, useWardrobe } from "@/lib/wardrobe";

/** A picked item and the size being tried (null: the suggested or first available size). */
type Slot = { item: SavedItem; size: string | null } | null;
type Picks = { top: Slot; bottom: Slot };

interface SizeInfo {
  options: SizeOption[];
  chosen: SizeOption | null;
  suggested: string | null;
  fit: FitWord | null;
  room: GarmentRoom | null;
}

function sizeInfo(slot: NonNullable<Slot>, measurements: Measurements): SizeInfo {
  const chart = (slot.item.size_chart ?? null) as SizeChart | null;
  const options = sizeOptions(slot.item.sizes, chart);
  const suggestedRow = suggestedLabel(chart, measurements);
  const suggested = options.find((o) => o.row?.label === suggestedRow)?.label ?? null;
  const chosen =
    options.find((o) => o.label === slot.size) ??
    options.find((o) => o.label === suggested) ??
    options.find((o) => o.available !== false) ??
    options[0] ??
    null;
  const ease = sizeEase(chosen?.row ?? null, measurements);
  // The 3D garment wants room relative to a regular fit.
  const room = ease
    ? (Object.fromEntries(
        (Object.keys(ease) as (keyof typeof ease)[]).map((region) => [region, (ease[region] ?? 0) - REGULAR_EASE[region]]),
      ) as GarmentRoom)
    : null;
  return { options, chosen, suggested, fit: fitWord(ease), room };
}

function toGarment(slot: NonNullable<Slot>, category: "top" | "bottom", info: SizeInfo): Garment {
  const { item } = slot;
  return {
    id: item.id,
    category,
    title: item.title ?? shopName(item.url),
    url: item.url,
    imageUrl: item.image_url,
    size: info.chosen?.label ?? null,
    room: info.room,
  };
}

const SUMMARY_FIELDS = ["height_cm", "chest_cm", "waist_cm", "hips_cm", "inseam_cm"] as const;

export function TryOn() {
  const { active, profiles } = useActiveProfile();
  const { state } = useWardrobe();
  const [units] = useUnits();
  // "View on me" in the extension links here with ?item=<saved item id>: start wearing it.
  const linkedId = useSearchParams().get("item");
  const items = state.kind === "loaded" ? state.items : null;
  const linkedItem = useMemo(() => items?.find((i) => i.id === linkedId) ?? null, [items, linkedId]);
  const [picked, setPicked] = useState<Picks | null>(null);
  const picks: Picks = picked ?? {
    top: linkedItem?.category === "top" ? { item: linkedItem, size: null } : null,
    bottom: linkedItem?.category === "bottom" ? { item: linkedItem, size: null } : null,
  };
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

  const topSizes = picks.top && sizeInfo(picks.top, active.measurements);
  const bottomSizes = picks.bottom && sizeInfo(picks.bottom, active.measurements);
  const outfit: Outfit = {
    top: picks.top && topSizes ? toGarment(picks.top, "top", topSizes) : null,
    bottom: picks.bottom && bottomSizes ? toGarment(picks.bottom, "bottom", bottomSizes) : null,
  };
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
        {linkedItem?.category === "other" && !picked && (
          <Alert>
            <AlertDescription>
              {linkedItem.title ?? shopName(linkedItem.url)} is saved as &ldquo;Other&rdquo;. Mark it as a top or a
              bottom on the{" "}
              <Link href="/wardrobe" className="text-primary underline underline-offset-4">
                Wardrobe
              </Link>{" "}
              page to try it on.
            </AlertDescription>
          </Alert>
        )}
        {linkedId && items && !linkedItem && !picked && (
          <Alert>
            <AlertDescription>That item isn&rsquo;t in this account&rsquo;s wardrobe.</AlertDescription>
          </Alert>
        )}
        <GarmentPicker
          legend="Top"
          items={tops}
          selected={outfit.top?.id ?? null}
          onSelect={(item) => setPicked({ ...picks, top: item ? { item, size: null } : null })}
        />
        {picks.top && topSizes && (
          <SizePicker
            name="top-size"
            info={topSizes}
            onSelect={(size) => picks.top && setPicked({ ...picks, top: { ...picks.top, size } })}
          />
        )}
        <GarmentPicker
          legend="Bottom (trousers or shorts)"
          items={bottoms}
          selected={outfit.bottom?.id ?? null}
          onSelect={(item) => setPicked({ ...picks, bottom: item ? { item, size: null } : null })}
        />
        {picks.bottom && bottomSizes && (
          <SizePicker
            name="bottom-size"
            info={bottomSizes}
            onSelect={(size) => picks.bottom && setPicked({ ...picks, bottom: { ...picks.bottom, size } })}
          />
        )}
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

const FIT_TEXT: Record<FitWord, string> = {
  tight: "tight on you",
  snug: "a snug fit",
  regular: "a regular fit",
  loose: "a loose fit",
  "very loose": "very loose on you",
};

/** The shop's sizes for the picked item; the 3D garment follows the chosen one. */
function SizePicker({ name, info, onSelect }: { name: string; info: SizeInfo; onSelect: (size: string) => void }) {
  const { options, chosen, suggested, fit } = info;
  if (options.length === 0) {
    return (
      <p className="-mt-4 text-xs text-muted-foreground">
        No sizes were saved for this item. Open its page and use View on me in the extension to read them.
      </p>
    );
  }
  const hasChart = options.some((o) => o.row);
  return (
    <fieldset className="-mt-4 space-y-2">
      <legend className="mb-2 text-sm font-medium">Size</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const soldOut = option.available === false;
          return (
            <label
              key={option.label}
              title={soldOut ? "Sold out in the shop" : undefined}
              className="relative flex min-w-11 cursor-pointer flex-col items-center rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/30 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={chosen?.label === option.label}
                onChange={() => onSelect(option.label)}
                aria-label={`${option.label}${soldOut ? ", sold out" : ""}${option.label === suggested ? ", suggested" : ""}`}
              />
              <span className={soldOut ? "text-muted-foreground line-through" : undefined}>{option.label}</span>
              {option.label === suggested && <span className="text-[10px] leading-none text-primary">Suggested</span>}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {!hasChart
          ? "The shop's page had no size chart, so every size looks the same on your body."
          : chosen && fit
            ? `${chosen.label} is ${FIT_TEXT[fit]}, from the shop's size chart.${chosen.available === false ? " Sold out in the shop." : ""}`
            : chosen
              ? `The size chart has no measurements for ${chosen.label} that match yours.`
              : null}
      </p>
    </fieldset>
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
