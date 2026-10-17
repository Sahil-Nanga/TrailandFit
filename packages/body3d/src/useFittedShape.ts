import type { Measurements } from "@aurora/api-client";
import { useEffect, useMemo, useState } from "react";

import { type FittedShape, fitBody } from "./fitClient";
import { type BodyShape, measurementsToShape } from "./morphs";

const DEBOUNCE_MS = 300;

export type FitStatus = "fitting" | "fitted" | "offline";

/**
 * The quick linear shape immediately, then the service's fitted shape once the inputs have
 * been still for a moment. Falls back to the quick shape if the service can't be reached.
 */
export function useFittedShape(serviceUrl: string, measurements: Measurements, bodyType: number) {
  const quick = useMemo(() => measurementsToShape({ measurements, bodyType }), [measurements, bodyType]);
  const key = JSON.stringify([serviceUrl, measurements, bodyType]);
  const [result, setResult] = useState<{ key: string; fitted: FittedShape | null; offline: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fitBody(serviceUrl, measurements, bodyType, controller.signal)
        .then((fitted) => setResult({ key, fitted, offline: false }))
        .catch(() => {
          // Aborted (inputs changed) or the service is unreachable.
          if (!controller.signal.aborted) setResult({ key, fitted: null, offline: true });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serviceUrl, key, measurements, bodyType]);

  const current = result?.key === key ? result : null;
  const shape: BodyShape = current?.fitted ?? quick;
  const status: FitStatus = current ? (current.offline ? "offline" : "fitted") : "fitting";
  return { shape, fitted: current?.fitted ?? null, status };
}
