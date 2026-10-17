"use client";

import {
  MEASUREMENT_RANGES,
  type MeasurementField,
  type Measurements,
} from "@aurora/api-client";
import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { UnitToggle } from "@/components/unit-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_INFO, FIELD_ORDER } from "@aurora/measurements";
import {
  displayRange,
  formatForInput,
  parseNumber,
  round1,
  toMetric,
  type Units,
  unitLabel,
} from "@aurora/measurements";
import { useUnits } from "@/lib/use-units";

type FormValues = { name: string } & Record<MeasurementField, string>;

export interface MeasurementFormSubmit {
  name: string;
  measurements: Measurements;
}

interface MeasurementFormProps {
  initialName?: string;
  initialMeasurements?: Partial<Measurements>;
  /** Per-field confidence (0..1) from a photo estimate; low values are highlighted. */
  confidence?: Partial<Record<MeasurementField, number>> | null;
  submitLabel: string;
  onSubmit: (data: MeasurementFormSubmit) => Promise<void>;
  /** Shown just above the submit button (save errors, sign-in notices). */
  footer?: ReactNode;
}

const LOW_CONFIDENCE = 0.6;

function buildSchema(units: Units) {
  const fields = Object.fromEntries(
    FIELD_ORDER.map((field) => [
      field,
      z.string().superRefine((raw, ctx) => {
        const value = parseNumber(raw);
        if (value === null) {
          if (field === "height_cm") {
            ctx.addIssue({ code: "custom", message: "Height is needed to save your measurements." });
          }
          return;
        }
        if (Number.isNaN(value)) {
          ctx.addIssue({ code: "custom", message: "Enter a number, like 72.5." });
          return;
        }
        const metric = toMetric(field, value, units);
        const { min, max } = MEASUREMENT_RANGES[field];
        if (metric < min || metric > max) {
          const shown = displayRange(field, units);
          ctx.addIssue({
            code: "custom",
            message: `Enter a value between ${shown.min} and ${shown.max} ${unitLabel(field, units)}.`,
          });
        }
      }),
    ]),
  ) as Record<MeasurementField, z.ZodString>;

  return z.object({
    name: z
      .string()
      .trim()
      .min(1, "Give this profile a name.")
      .max(100, "Keep the name under 100 characters."),
    ...fields,
  });
}

export function MeasurementForm({
  initialName = "My measurements",
  initialMeasurements = {},
  confidence,
  submitLabel,
  onSubmit,
  footer,
}: MeasurementFormProps) {
  const [units, setUnits] = useUnits();
  const schema = useMemo(() => buildSchema(units), [units]);

  // Exact metric values behind what the inputs show, so switching units back and forth
  // does not drift (170 cm -> 66.9 in -> 169.9 cm).
  const exactMetric = useRef<Partial<Record<MeasurementField, number | null>>>({ ...initialMeasurements });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      name: initialName,
      ...(Object.fromEntries(
        FIELD_ORDER.map((field) => [field, formatForInput(field, initialMeasurements[field], units)]),
      ) as Record<MeasurementField, string>),
    },
  });
  const { errors, isSubmitting } = form.formState;

  function metricValue(field: MeasurementField, raw: string, inUnits: Units): number | null {
    const value = parseNumber(raw);
    if (value === null || Number.isNaN(value)) return null;
    const known = exactMetric.current[field];
    if (known != null && formatForInput(field, known, inUnits) === raw.trim()) return known;
    return toMetric(field, value, inUnits);
  }

  // Units can change from the toggle or from the saved preference loading after the first
  // render; either way, convert what the inputs show from the old units to the new ones.
  const shownUnits = useRef(units);
  useEffect(() => {
    const from = shownUnits.current;
    if (from.length === units.length && from.weight === units.weight) return;
    for (const field of FIELD_ORDER) {
      const metric = metricValue(field, form.getValues(field), from);
      if (metric === null) continue; // leave empty or invalid input as typed
      exactMetric.current[field] = metric;
      form.setValue(field, formatForInput(field, metric, units), {
        shouldValidate: form.getFieldState(field).isTouched,
      });
    }
    shownUnits.current = units;
  }, [units]); // eslint-disable-line react-hooks/exhaustive-deps -- form and helpers are stable

  async function submitValid(values: FormValues) {
    const measurements = Object.fromEntries(
      FIELD_ORDER.map((field) => {
        const metric = metricValue(field, values[field], units);
        return [field, metric === null ? null : round1(metric)];
      }),
    ) as unknown as Measurements;
    await onSubmit({ name: values.name.trim(), measurements });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submitValid)(event)} noValidate className="space-y-8">
      <div className="space-y-2">
        <Label htmlFor="name">Profile name</Label>
        <Input
          id="name"
          autoComplete="off"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "name-error" : undefined}
          {...form.register("name")}
        />
        {errors.name && (
          <p id="name-error" className="text-sm text-destructive">
            {errors.name.message}
          </p>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Units</legend>
        <div className="flex flex-wrap gap-3">
          <UnitToggle
            label="Length unit"
            options={["cm", "in"] as const}
            value={units.length}
            onChange={(length) => setUnits({ ...units, length })}
          />
          <UnitToggle
            label="Weight unit"
            options={["kg", "lb"] as const}
            value={units.weight}
            onChange={(weight) => setUnits({ ...units, weight })}
          />
        </div>
      </fieldset>

      <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
        {FIELD_ORDER.map((field) => {
          const info = FIELD_INFO[field];
          const error = errors[field]?.message;
          const lowConfidence = (confidence?.[field] ?? 1) < LOW_CONFIDENCE;
          const describedBy = [`${field}-help`, lowConfidence && `${field}-confidence`, error && `${field}-error`]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={field} className="space-y-2" data-low-confidence={lowConfidence || undefined}>
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={field}>{info.label}</Label>
                {/* Visual hint only; required-ness is announced via aria-required. */}
                <span aria-hidden className="text-xs text-muted-foreground">
                  {field === "height_cm" ? "Required" : "Optional"}
                </span>
              </div>
              <div className="relative">
                <Input
                  id={field}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={error ? true : undefined}
                  aria-required={field === "height_cm" || undefined}
                  aria-describedby={describedBy}
                  className={
                    lowConfidence
                      ? "pr-12 border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                      : "pr-12"
                  }
                  {...form.register(field)}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
                >
                  {unitLabel(field, units)}
                </span>
              </div>
              <p id={`${field}-help`} className="text-xs text-muted-foreground">
                {info.help} <span className="sr-only">Unit: {unitLabel(field, units)}.</span>
              </p>
              {lowConfidence && (
                <p id={`${field}-confidence`} className="text-xs text-amber-700 dark:text-amber-400">
                  Low confidence. Please check this one.
                </p>
              )}
              {error && (
                <p id={`${field}-error`} className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-4">
        {footer}
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
