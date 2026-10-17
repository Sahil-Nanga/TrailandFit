"use client";

import { errorMessage, type GarmentCategory, type SavedItem } from "@aurora/api-client";
import { ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { GarmentImage } from "@/components/garment-image";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, shopName, useWardrobe } from "@/lib/wardrobe";

type Filter = "all" | GarmentCategory;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "top", label: "Tops" },
  { value: "bottom", label: "Bottoms" },
  { value: "other", label: "Other" },
];

export function Wardrobe() {
  const { state, replace, remove, reload } = useWardrobe();
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  async function changeCategory(item: SavedItem, category: GarmentCategory) {
    setError(null);
    replace({ ...item, category });
    const { data, error } = await api.PATCH("/v1/saved-items/{item_id}", {
      params: { path: { item_id: item.id } },
      body: { category },
    });
    if (data) replace(data);
    else {
      replace(item);
      setError(errorMessage(error, "Could not change the category."));
    }
  }

  async function removeItem(item: SavedItem) {
    setError(null);
    remove(item.id);
    const { response } = await api.DELETE("/v1/saved-items/{item_id}", { params: { path: { item_id: item.id } } });
    if (!response.ok && response.status !== 404) {
      setError("Could not remove that item.");
      void reload();
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3" aria-busy="true" aria-label="Loading wardrobe">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
        ))}
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
  if (state.items.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed p-8 text-center">
        <p className="font-medium">Your wardrobe is empty</p>
        <p className="text-sm text-muted-foreground">
          On a shop&apos;s product page, open the Trialandfit extension and press{" "}
          <span className="font-medium text-foreground">Save this page</span>. It shows up here.
        </p>
      </div>
    );
  }

  const shown = filter === "all" ? state.items : state.items.filter((i) => i.category === filter);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          aria-label="Show"
          variant="outline"
          spacing={0}
          value={[filter]}
          onValueChange={(next) => {
            const picked = next.find((v) => v !== filter) as Filter | undefined;
            if (picked) setFilter(picked);
          }}
        >
          {FILTERS.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} className="data-[pressed]:bg-secondary data-[pressed]:text-secondary-foreground">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Link href="/try-on" className={buttonVariants()}>
          Try on an outfit
        </Link>
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this group yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {shown.map((item) => {
            const title = item.title ?? shopName(item.url);
            return (
              <li key={item.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
                <GarmentImage src={item.image_url} alt={title} category={item.category} className="aspect-[3/4] w-full" />
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{shopName(item.url)}</p>
                  <label className="mt-auto flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Type</span>
                    <select
                      value={item.category}
                      onChange={(event) => void changeCategory(item, event.target.value as GarmentCategory)}
                      className="flex-1 rounded-md border bg-background px-2 py-1"
                    >
                      {(Object.keys(CATEGORY_LABEL) as GarmentCategory[]).map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center justify-between">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      View in shop <ExternalLink aria-hidden className="size-3" />
                    </a>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${title}`}
                      onClick={() => void removeItem(item)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
