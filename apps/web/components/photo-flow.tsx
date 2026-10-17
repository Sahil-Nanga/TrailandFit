"use client";

import {
  errorMessage,
  estimatePhoto,
  type MeasurementField,
  type PhotoEstimate,
} from "@aurora/api-client";
import { CircleAlert, Info, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MeasurementForm, type MeasurementFormSubmit } from "@/components/measurement-form";
import { PhotoPicker } from "@/components/photo-picker";
import { PoseIllustration } from "@/components/pose-illustration";
import { UnitToggle } from "@/components/unit-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { FIELD_ORDER } from "@aurora/measurements";
import { displayRange, parseNumber, toMetric } from "@aurora/measurements";
import { useUnits } from "@/lib/use-units";

type Step =
  | { kind: "intro" }
  | { kind: "upload"; problem?: { title: string; message: string } }
  | { kind: "result"; estimate: PhotoEstimate };

const TIPS = [
  "Wear fitted clothing, like a T-shirt and leggings or slim trousers. Hoodies and coats make the numbers bigger.",
  "Use a plain background and good light.",
  "Show your whole body, head to feet, with a little space around you.",
  "Stand straight, arms slightly away from your body, feet hip-width apart.",
  "Hold the camera at chest height, about 2–3 metres away, or ask someone to help.",
];

export function PhotoFlow() {
  const router = useRouter();
  const [units, setUnits] = useUnits();
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [consent, setConsent] = useState(false);
  const [height, setHeight] = useState("");
  const [heightError, setHeightError] = useState<string | null>(null);
  const [front, setFront] = useState<File | null>(null);
  const [side, setSide] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function heightInCm(): number | null {
    const value = parseNumber(height);
    if (value === null || Number.isNaN(value)) return null;
    const cm = toMetric("height_cm", value, units);
    return cm >= 50 && cm <= 272 ? Math.round(cm * 10) / 10 : null;
  }

  async function submitPhotos(event: React.FormEvent) {
    event.preventDefault();
    const heightCm = heightInCm();
    if (heightCm === null) {
      const range = displayRange("height_cm", units);
      setHeightError(`Enter your height, between ${range.min} and ${range.max} ${units.length}.`);
      return;
    }
    setHeightError(null);
    if (!front) {
      setStep({ kind: "upload", problem: { title: "Add a front photo", message: "We need at least one photo, facing the camera." } });
      return;
    }
    setBusy(true);
    try {
      const { data, error, response } = await estimatePhoto(api, { front, side, heightCm, consent });
      if (data) {
        // The photos are no longer needed: drop them from memory.
        setFront(null);
        setSide(null);
        setStep({ kind: "result", estimate: data });
        return;
      }
      const retake = response.status === 422 && error && "error" in error && error.error.code === "photo_retake";
      setStep({
        kind: "upload",
        problem: {
          title: retake ? "Let's try another photo" : "Something went wrong",
          message: errorMessage(error, "We couldn't measure that photo. Please try again."),
        },
      });
    } catch {
      setStep({
        kind: "upload",
        problem: { title: "Can't reach the server", message: "Check your connection and try again." },
      });
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "intro") {
    return (
      <div className="space-y-8">
        <div className="grid gap-6 sm:grid-cols-[8rem_1fr] sm:items-start">
          <PoseIllustration className="mx-auto h-40 text-muted-foreground sm:h-48" />
          <div className="space-y-3">
            <h2 className="font-medium">How to take a good photo</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>

        <Alert>
          <ShieldCheck aria-hidden />
          <AlertTitle>What happens to your photo</AlertTitle>
          <AlertDescription>
            Your photo is sent to our server, measured, and deleted straight away. It is never
            stored or shared, and nobody looks at it. Only the numbers are kept, and only if you
            choose to save them.
          </AlertDescription>
        </Alert>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>I agree to have my photo processed to estimate my measurements.</span>
        </label>

        <Button size="lg" className="w-full sm:w-auto" disabled={!consent} onClick={() => setStep({ kind: "upload" })}>
          Continue
        </Button>
      </div>
    );
  }

  if (step.kind === "upload") {
    return (
      <form onSubmit={(event) => void submitPhotos(event)} noValidate className="space-y-8">
        {step.problem && (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden />
            <AlertTitle>{step.problem.title}</AlertTitle>
            <AlertDescription>{step.problem.message}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Label htmlFor="photo-height">Your height</Label>
            <UnitToggle
              label="Height unit"
              options={["cm", "in"] as const}
              value={units.length}
              onChange={(length) => {
                const cm = heightInCm();
                setUnits({ ...units, length });
                if (cm !== null) setHeight(String(Math.round((length === "in" ? cm / 2.54 : cm) * 10) / 10));
              }}
            />
          </div>
          <Input
            id="photo-height"
            inputMode="decimal"
            autoComplete="off"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            aria-invalid={heightError ? true : undefined}
            aria-describedby={heightError ? "photo-height-help photo-height-error" : "photo-height-help"}
          />
          <p id="photo-height-help" className="text-xs text-muted-foreground">
            We use your height to turn the photo into real measurements.
          </p>
          {heightError && (
            <p id="photo-height-error" className="text-sm text-destructive">
              {heightError}
            </p>
          )}
        </div>

        <PhotoPicker
          label="Front photo"
          hint="Facing the camera, whole body in view."
          file={front}
          onChange={setFront}
        />
        <PhotoPicker
          label="Side photo"
          hint="Turned sideways. Makes chest, waist and hips more accurate."
          optional
          file={side}
          onChange={setSide}
        />

        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}>
          {busy ? (
            <>
              <Loader2 aria-hidden className="animate-spin" />
              Measuring…
            </>
          ) : (
            "Get my measurements"
          )}
        </Button>
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            This usually takes a few seconds.
          </p>
        )}
      </form>
    );
  }

  const { estimate } = step;

  async function save({ name, measurements }: MeasurementFormSubmit) {
    setSaveError(null);
    const edited = FIELD_ORDER.some((field: MeasurementField) => {
      const before = estimate.measurements[field] ?? null;
      const after = measurements[field] ?? null;
      return before === null || after === null ? before !== after : Math.abs(before - after) > 0.05;
    });
    try {
      const { data, error } = await api.POST("/v1/profiles", {
        body: {
          name,
          measurements,
          source: edited ? "photo_edited" : "photo",
          confidence: estimate.confidence,
        },
      });
      if (error || !data) {
        setSaveError(errorMessage(error, "Could not save. Please try again."));
        return;
      }
      router.push(`/profiles/${data.id}`);
    } catch {
      setSaveError("Can't reach the server. Check your connection and try again.");
    }
  }

  return (
    <div className="space-y-6">
      <Alert role="status">
        <Info aria-hidden />
        <AlertTitle>These are estimates</AlertTitle>
        <AlertDescription>
          Check every number, especially the highlighted ones, and correct anything that looks
          off. Loose clothing like hoodies makes chest, waist and hips come out larger. Your
          photo has already been deleted.
        </AlertDescription>
      </Alert>
      {(estimate.notes ?? []).length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {(estimate.notes ?? []).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <MeasurementForm
        initialName="From my photo"
        initialMeasurements={estimate.measurements}
        confidence={estimate.confidence as Partial<Record<MeasurementField, number>>}
        submitLabel="Save measurements"
        onSubmit={save}
        footer={
          saveError && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )
        }
      />
      <Button variant="ghost" onClick={() => setStep({ kind: "upload" })}>
        Start over with new photos
      </Button>
    </div>
  );
}
