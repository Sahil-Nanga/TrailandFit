"use client";

import type { ProfilePhoto } from "@aurora/api-client";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** Photos the user chose to keep for the try-on, with a way to delete them. */
export function ProfilePhotos({ profileId }: { profileId: string }) {
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .GET("/v1/profiles/{profile_id}/photos", { params: { path: { profile_id: profileId } } })
      .then(({ data }) => {
        if (!cancelled) setPhotos(data ?? []);
      })
      .catch(() => {
        if (!cancelled) setPhotos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!photos || photos.length === 0) return null;

  async function remove() {
    setBusy(true);
    setError(null);
    const { response } = await api.DELETE("/v1/profiles/{profile_id}/photos", {
      params: { path: { profile_id: profileId } },
    });
    setBusy(false);
    if (response.ok) {
      setPhotos([]);
      setOpen(false);
    } else {
      setError("Could not delete the photos. Please try again.");
    }
  }

  return (
    <section aria-labelledby="photos-heading" className="space-y-3 border-t pt-8">
      <h2 id="photos-heading" className="font-medium">
        Photos for your try-on preview
      </h2>
      <p className="text-sm text-muted-foreground">
        You chose to keep these. They are private to your account and used only for the 3D preview.
      </p>
      <ul className="flex gap-3">
        {photos.map((photo) => (
          <li key={photo.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            <img
              src={photo.url}
              alt={`Your ${photo.kind} photo`}
              className="h-32 w-24 rounded-lg border object-cover"
            />
          </li>
        ))}
      </ul>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger render={<Button variant="destructive" />}>Delete photos</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your photos?</AlertDialogTitle>
            <AlertDialogDescription>
              They are removed from storage for good. Your measurements stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()} disabled={busy}>
              {busy ? "Deleting…" : "Delete photos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
