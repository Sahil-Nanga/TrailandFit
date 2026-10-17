import { useCallback, useRef, useState } from "react";

import { bakeLikenessFromUrl, type Likeness, LikenessError } from "@aurora/body3d";

import { api } from "../account/client";
import { BODY_FIT_URL } from "../config";

export type LikenessState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ready"; likeness: Likeness }
  | { kind: "no-photo" }
  | { kind: "error"; message: string };

/**
 * The face from the profile's kept front photo, baked onto the body. The photo is fetched
 * through a short-lived signed URL, sent to the body-fit service and then dropped; only the
 * resulting texture is kept, in memory, for this page.
 */
export function useLikeness(profileId: string | null) {
  const [state, setState] = useState<{ profileId: string | null; value: LikenessState }>({
    profileId,
    value: { kind: "idle" },
  });
  const abort = useRef<AbortController | null>(null);
  // A different (or no) profile: start over.
  const current: LikenessState = state.profileId === profileId ? state.value : { kind: "idle" };

  const apply = useCallback(
    async (weights: Record<string, number>, bodyType: number) => {
      if (!profileId) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const set = (value: LikenessState) => {
        if (!controller.signal.aborted) setState({ profileId, value });
      };
      set({ kind: "working" });
      try {
        const { data, error } = await api.GET("/v1/profiles/{profile_id}/photos", {
          params: { path: { profile_id: profileId } },
        });
        if (error || !data) throw new LikenessError("We couldn't load your saved photos. Please try again.");
        const front = data.find((photo) => photo.kind === "front");
        if (!front) {
          set({ kind: "no-photo" });
          return;
        }
        set({
          kind: "ready",
          likeness: await bakeLikenessFromUrl(BODY_FIT_URL, front.url, weights, bodyType, controller.signal),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        set({ kind: "error", message: error instanceof LikenessError ? error.message : "Something went wrong. Please try again." });
      }
    },
    [profileId],
  );

  const clear = useCallback(() => {
    abort.current?.abort();
    setState({ profileId, value: { kind: "idle" } });
  }, [profileId]);

  return { state: current, likeness: current.kind === "ready" ? current.likeness : null, apply, clear };
}
