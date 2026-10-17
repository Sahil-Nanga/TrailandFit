import type { MeasurementField, Measurements } from "@aurora/api-client";
import { FIELD_INFO, formatForInput, parseNumber, toMetric, type Units, unitLabel } from "@aurora/measurements";

import type { BodyShape, Dimension, FittedShape } from "@aurora/body3d";

export type Field = Extract<
  MeasurementField,
  "height_cm" | "weight_kg" | "chest_cm" | "waist_cm" | "hips_cm" | "shoulder_width_cm" | "inseam_cm"
>;

/** Slider ranges in cm / kg (typing allows anything within the API's ranges). */
export const SLIDERS: Record<Field, [number, number]> = {
  height_cm: [140, 210],
  weight_kg: [40, 140],
  chest_cm: [70, 140],
  waist_cm: [55, 130],
  hips_cm: [75, 140],
  shoulder_width_cm: [34, 56],
  inseam_cm: [60, 95],
};

const MODEL_DIMENSION: Partial<Record<Field, Dimension>> = {
  height_cm: "height",
  chest_cm: "chest",
  waist_cm: "waist",
  hips_cm: "hips",
  shoulder_width_cm: "shoulderWidth",
  inseam_cm: "inseam",
};

interface Props {
  measurements: Measurements;
  units: Units;
  shape: BodyShape;
  /** Present once the service has fitted the body to the current numbers. */
  fitted: FittedShape | null;
  /** When signed in: which fields the user really has; others are typical placeholders. */
  provided: ReadonlySet<Field> | null;
  onChange: (field: Field, metric: number) => void;
}

export function MeasurementPanel({ measurements, units, shape, fitted, provided, onChange }: Props) {
  return (
    <div className="fields">
      {(Object.keys(SLIDERS) as Field[]).map((field) => {
        const metric = measurements[field] ?? SLIDERS[field][0];
        const [min, max] = SLIDERS[field];
        const unit = unitLabel(field, units);
        const dimension = MODEL_DIMENSION[field];
        const modelCm = dimension ? shape.predicted[dimension] * 100 : null;
        const tolerance = fitted?.toleranceCm ?? 1;
        const off = modelCm !== null && Math.abs(modelCm - metric) > tolerance;
        const id = `field-${field}`;
        return (
          <div className="field" key={field}>
            <div className="field-head">
              <label htmlFor={id}>
                {FIELD_INFO[field].label}
                {provided && !provided.has(field) && <span className="typical"> typical value</span>}
              </label>
              <span className="input-wrap">
                <input
                  id={id}
                  inputMode="decimal"
                  value={formatForInput(field, metric, units)}
                  onChange={(event) => {
                    const value = parseNumber(event.target.value);
                    if (value !== null && !Number.isNaN(value)) onChange(field, toMetric(field, value, units));
                  }}
                />
                <span className="unit">{unit}</span>
              </span>
            </div>
            <input
              type="range"
              aria-label={`${FIELD_INFO[field].label} slider`}
              min={min}
              max={max}
              step={0.5}
              value={Math.min(max, Math.max(min, metric))}
              onChange={(event) => onChange(field, Number(event.target.value))}
            />
            {modelCm !== null && (
              <p className={off ? "model off" : "model"}>
                {fitted ? "Measured on model" : "Estimate"}: {formatForInput(field, modelCm, units)} {unit}
                {fitted && (off ? " — as close as this body allows" : " ✓")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
