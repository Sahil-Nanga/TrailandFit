"use client";

import { errorMessage } from "@aurora/api-client";
import { CircleAlert, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MeasurementForm, type MeasurementFormSubmit } from "@/components/measurement-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { notifyProfilesChanged } from "@/components/active-profile";
import { api } from "@/lib/api";
import { getAccessToken, signInUrl } from "@/lib/auth";
import { clearDraft, saveDraft, useDraft } from "@/lib/draft";

const DRAFT_KEY = "aurora.draft.manual";

export function ManualEntry() {
  const router = useRouter();
  const draft = useDraft(DRAFT_KEY);
  const [error, setError] = useState<string | null>(null);

  async function save({ name, measurements }: MeasurementFormSubmit) {
    setError(null);
    if (!(await getAccessToken())) {
      saveDraft(DRAFT_KEY, { name, measurements });
      router.push(signInUrl("/measure/manual"));
      return;
    }
    try {
      const { data, error } = await api.POST("/v1/profiles", {
        body: { name, measurements, source: "manual" },
      });
      if (error || !data) {
        setError(errorMessage(error, "Could not save. Please try again."));
        return;
      }
      clearDraft(DRAFT_KEY);
      notifyProfilesChanged();
      router.push(`/profiles/${data.id}`);
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    }
  }

  return (
    <div className="space-y-6">
      {draft && (
        <Alert role="status">
          <Info aria-hidden />
          <AlertDescription>Your numbers are back. Check them and press save.</AlertDescription>
        </Alert>
      )}
      <MeasurementForm
        // Remount when a draft appears so the restored values fill the form.
        key={draft ? "draft" : "empty"}
        initialName={draft?.name}
        initialMeasurements={draft?.measurements}
        submitLabel="Save measurements"
        onSubmit={save}
        footer={
          error && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )
        }
      />
    </div>
  );
}
