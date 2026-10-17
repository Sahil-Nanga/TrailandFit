"use client";

import {
  errorMessage,
  type MeasurementField,
  type MeasurementProfile,
} from "@aurora/api-client";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MeasurementForm, type MeasurementFormSubmit } from "@/components/measurement-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { SOURCE_LABEL } from "@aurora/measurements";

type Load =
  | { kind: "loading" }
  | { kind: "loaded"; profile: MeasurementProfile }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

const OFFLINE = "Can't reach the server. Check your connection and try again.";

export function EditProfile({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error, response } = await api.GET("/v1/profiles/{profile_id}", {
          params: { path: { profile_id: id } },
        });
        if (cancelled) return;
        if (data) setState({ kind: "loaded", profile: data });
        else if (response.status === 404 || response.status === 422) setState({ kind: "not-found" });
        else setState({ kind: "error", message: errorMessage(error, "Could not load this profile.") });
      } catch {
        if (!cancelled) setState({ kind: "error", message: OFFLINE });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === "loading") {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading profile">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (state.kind === "not-found") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Profile not found</h1>
        <p className="text-muted-foreground">It may have been deleted.</p>
        <Link href="/profiles" className={buttonVariants({ variant: "outline" })}>
          Back to my profiles
        </Link>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert aria-hidden />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  const { profile } = state;
  const fromPhoto = profile.source !== "manual";

  async function save({ name, measurements }: MeasurementFormSubmit) {
    setSaveError(null);
    setSaved(false);
    try {
      const { data, error } = await api.PATCH("/v1/profiles/{profile_id}", {
        params: { path: { profile_id: id } },
        body: { name, measurements },
      });
      if (error || !data) {
        setSaveError(errorMessage(error, "Could not save. Please try again."));
        return;
      }
      setState({ kind: "loaded", profile: data });
      setSaved(true);
    } catch {
      setSaveError(OFFLINE);
    }
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const { error, response } = await api.DELETE("/v1/profiles/{profile_id}", {
        params: { path: { profile_id: id } },
      });
      if (response.ok || response.status === 404) {
        setDeleteOpen(false);
        router.push("/profiles");
        return;
      }
      setDeleteError(errorMessage(error, "Could not delete. Please try again."));
    } catch {
      setDeleteError(OFFLINE);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link href="/profiles" className="text-sm text-muted-foreground hover:text-foreground">
          ← My profiles
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
          <Badge variant="secondary">{SOURCE_LABEL[profile.source]}</Badge>
        </div>
        {fromPhoto && (
          <p className="text-sm text-muted-foreground">
            Photo results are estimates. Check the highlighted values and correct anything
            that looks off.
          </p>
        )}
      </div>

      <MeasurementForm
        // Remount after a save so the form shows exactly what the server stored.
        key={profile.updated_at}
        initialName={profile.name}
        initialMeasurements={profile.measurements}
        confidence={
          fromPhoto ? (profile.confidence as Partial<Record<MeasurementField, number>> | null) : null
        }
        submitLabel="Save changes"
        onSubmit={save}
        footer={
          <>
            {saved && (
              <p role="status" className="text-sm text-muted-foreground">
                Saved.
              </p>
            )}
            {saveError && (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
          </>
        }
      />

      <section aria-labelledby="danger" className="space-y-3 border-t pt-8">
        <h2 id="danger" className="font-medium">
          Delete this profile
        </h2>
        <p className="text-sm text-muted-foreground">
          This permanently removes these measurements from your account.
        </p>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger render={<Button variant="destructive" />}>
            Delete profile
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{profile.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError && (
              <p role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void remove()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>
  );
}
