import type { MeasurementField } from "@aurora/api-client";

export interface FieldInfo {
  label: string;
  help: string;
}

/** Display order and plain-language instructions for each measurement. */
export const FIELD_INFO: Record<MeasurementField, FieldInfo> = {
  height_cm: { label: "Height", help: "Stand straight against a wall, without shoes." },
  weight_kg: { label: "Weight", help: "Your usual weight." },
  chest_cm: {
    label: "Chest",
    help: "Measure around the fullest part of your chest, under your arms.",
  },
  waist_cm: {
    label: "Waist",
    help: "Measure around your natural waist, just above your belly button.",
  },
  hips_cm: { label: "Hips", help: "Measure around the widest part of your hips." },
  shoulder_width_cm: {
    label: "Shoulder width",
    help: "Measure across your back, from one shoulder tip to the other.",
  },
  inseam_cm: { label: "Inseam", help: "Measure from your crotch down to your ankle bone." },
  sleeve_cm: {
    label: "Sleeve",
    help: "Measure from your shoulder tip down to your wrist, arm relaxed.",
  },
  neck_cm: { label: "Neck", help: "Measure around the base of your neck." },
  thigh_cm: { label: "Thigh", help: "Measure around the fullest part of your upper thigh." },
};

/** Display order follows FIELD_INFO, so every field is listed exactly once. */
export const FIELD_ORDER = Object.keys(FIELD_INFO) as MeasurementField[];

export const SOURCE_LABEL = {
  manual: "Entered manually",
  photo: "From a photo",
  photo_edited: "From a photo, edited",
} as const;
