import type { Metadata } from "next";

import { ManualEntry } from "@/components/manual-entry";

export const metadata: Metadata = { title: "Enter measurements" };

export default function ManualEntryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Enter your measurements</h1>
        <p className="text-muted-foreground">
          Use a soft tape measure, keep it snug but not tight, and measure over thin clothing.
          Only height is required; add whatever else you have.
        </p>
      </div>
      <ManualEntry />
    </div>
  );
}
