import type { FitStatus, Grid } from "@aurora/measurements";
import type { MeasurementField } from "@aurora/api-client";

/** Page script -> background: size-chart tables found on the page. */
export interface SuggestRequest {
  type: "aurora:suggest";
  tables: { rows: Grid; visible: boolean; context: string; onScreen: boolean }[];
}

/**
 * Background -> page script. Deliberately contains no measurement values: the page only
 * learns the suggested size and which measurements it was based on.
 */
export type SuggestResponse =
  | {
      kind: "suggestion";
      label: string;
      fits: { field: MeasurementField; status: FitStatus }[];
      alternative: { label: string; reason: "smaller" | "larger" } | null;
      quality: "good" | "close" | "poor";
      profileName: string;
    }
  /** Only the garment's own measurements are shown; the user should switch to body sizes. */
  | { kind: "garment-only" }
  /** A body chart is shown, but the profile lacks every measurement it uses. */
  | { kind: "missing-measurements"; needed: MeasurementField[]; profileName: string }
  | { kind: "none" };

export function originPattern(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? `${protocol}//${host}/*` : null;
  } catch {
    return null;
  }
}
