import type { Metadata } from "next";

import { PhotoFlow } from "@/components/photo-flow";

export const metadata: Metadata = { title: "Measure from a photo" };

export default function PhotoPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Measure from a photo</h1>
        <p className="text-muted-foreground">
          Takes about a minute. You can check and correct every number afterwards.
        </p>
      </div>
      <PhotoFlow />
    </div>
  );
}
