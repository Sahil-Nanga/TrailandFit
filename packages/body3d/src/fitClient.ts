import type { Measurements } from "@aurora/api-client";

import type { BodyShape, Dimension, Weights } from "./morphs";

export interface FittedShape extends BodyShape {
  /** Gap between the fitted body and the request, in cm (only for measurements given). */
  residualsCm: Partial<Record<Dimension, number>>;
  withinTolerance: boolean;
  toleranceCm: number;
}

interface FitResponse {
  weights: Record<string, number>;
  scale: number;
  measured_cm: Record<Dimension, number>;
  residuals_cm: Partial<Record<Dimension, number>>;
  within_tolerance: boolean;
  tolerance_cm: number;
}

/** Ask the body-fit service (at `serviceUrl`) for the body that matches these measurements. */
export async function fitBody(serviceUrl: string, measurements: Measurements, bodyType: number, signal: AbortSignal): Promise<FittedShape> {
  const response = await fetch(`${serviceUrl}/fit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ measurements, body_type: bodyType }),
    signal,
  });
  if (!response.ok) throw new Error(`fit failed (${response.status})`);
  const data = (await response.json()) as FitResponse;
  return {
    weights: data.weights as Weights,
    scale: data.scale,
    predicted: Object.fromEntries(Object.entries(data.measured_cm).map(([k, v]) => [k, v / 100])) as Record<Dimension, number>,
    residualsCm: data.residuals_cm,
    withinTolerance: data.within_tolerance,
    toleranceCm: data.tolerance_cm,
  };
}
