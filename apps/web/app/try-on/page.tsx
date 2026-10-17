import type { Metadata } from "next";

import { TryOn } from "@/components/try-on/try-on";

export const metadata: Metadata = { title: "Try on" };

export default function TryOnPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Try on</h1>
        <p className="text-muted-foreground">Pick a top and a bottom from your wardrobe to wear together.</p>
      </div>
      <TryOn />
    </div>
  );
}
