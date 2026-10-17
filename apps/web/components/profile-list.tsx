"use client";

import { errorMessage, type MeasurementProfile } from "@aurora/api-client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { SOURCE_LABEL } from "@aurora/measurements";
import { formatForInput } from "@aurora/measurements";
import { useUnits } from "@/lib/use-units";

const PAGE_SIZE = 20;

type PageResult =
  | { ok: true; items: MeasurementProfile[]; total: number }
  | { ok: false; message: string };

async function fetchPage(offset: number): Promise<PageResult> {
  try {
    const { data, error } = await api.GET("/v1/profiles", {
      params: { query: { limit: PAGE_SIZE, offset } },
    });
    if (error || !data) return { ok: false, message: errorMessage(error, "Could not load your profiles.") };
    return { ok: true, items: data.items, total: data.total };
  } catch {
    return { ok: false, message: "Can't reach the server. Check your connection and try again." };
  }
}

export function ProfileList() {
  const [units] = useUnits();
  const [items, setItems] = useState<MeasurementProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyPage = useCallback((result: PageResult, offset: number) => {
    if (result.ok) {
      setItems((current) => (offset === 0 ? result.items : [...current, ...result.items]));
      setTotal(result.total);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPage(0).then((result) => {
      if (!cancelled) applyPage(result, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [applyPage]);

  async function loadFrom(offset: number) {
    setLoading(true);
    applyPage(await fetchPage(offset), offset);
  }

  if (error && items.length === 0) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex flex-wrap items-center gap-3">
          {error}
          <Button variant="outline" size="sm" onClick={() => void loadFrom(0)}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading profiles">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4 rounded-xl border border-dashed p-8 text-center">
        <p className="text-muted-foreground">You have no saved profiles yet.</p>
        <Link href="/" className={buttonVariants()}>
          Get your measurements
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {items.map((profile) => (
          <li key={profile.id}>
            <Link
              href={`/profiles/${profile.id}`}
              className="flex items-center gap-4 rounded-xl border p-4 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-medium">{profile.name}</p>
                <p className="text-sm text-muted-foreground">
                  Height {formatForInput("height_cm", profile.measurements.height_cm, units)}{" "}
                  {units.length} · {SOURCE_LABEL[profile.source]}
                </p>
              </div>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {items.length < total && (
        <Button variant="outline" onClick={() => void loadFrom(items.length)} disabled={loading}>
          {loading ? "Loading…" : "Show more"}
        </Button>
      )}
    </div>
  );
}
