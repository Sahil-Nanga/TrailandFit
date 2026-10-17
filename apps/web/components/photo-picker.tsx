"use client";

import { ImagePlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MIN_SHORT_SIDE = 128;
const MIN_LONG_SIDE = 256;

/** Quick checks before upload; the server checks everything again. */
async function checkPhoto(file: File): Promise<string | null> {
  if (!TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP photo.";
  if (file.size > MAX_BYTES) return "That photo is over 10 MB. Try a smaller one.";
  try {
    const bitmap = await createImageBitmap(file);
    const [short, long] = [bitmap.width, bitmap.height].sort((a, b) => a - b);
    bitmap.close();
    if (short < MIN_SHORT_SIDE || long < MIN_LONG_SIDE) {
      return "That photo is too small. Use a sharper photo.";
    }
  } catch {
    return "We couldn't open that photo. Try another one.";
  }
  return null;
}

interface PhotoPickerProps {
  label: string;
  hint: string;
  optional?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
}

export function PhotoPicker({ label, hint, optional, file, onChange }: PhotoPickerProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  function showPreview(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setPreview(previewRef.current);
  }
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span aria-hidden className="text-xs text-muted-foreground">
          {optional ? "Optional" : "Required"}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {file && preview ? (
        <div className="flex items-center gap-3 rounded-xl border p-3">
          {/* Local preview only; the image never leaves the device until you submit. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
          <img src={preview} alt={`${label} preview`} className="h-24 w-16 rounded-md object-cover" />
          <p className="min-w-0 flex-1 truncate text-sm">{file.name}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => {
              showPreview(null);
              onChange(null);
            }}
          >
            <X />
          </Button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
        >
          <ImagePlus aria-hidden className="size-6" />
          Take or choose a photo
          <input
            id={id}
            type="file"
            accept={TYPES.join(",")}
            className="sr-only"
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            aria-invalid={error ? true : undefined}
            onChange={async (event) => {
              const picked = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (!picked) return;
              const problem = await checkPhoto(picked);
              setError(problem);
              if (!problem) {
                showPreview(picked);
                onChange(picked);
              }
            }}
          />
        </label>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
