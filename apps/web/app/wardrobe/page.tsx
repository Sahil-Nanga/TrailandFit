import type { Metadata } from "next";

import { Wardrobe } from "@/components/wardrobe";

export const metadata: Metadata = { title: "Wardrobe" };

export default function WardrobePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Wardrobe</h1>
        <p className="text-muted-foreground">Clothes you saved with the Trialandfit extension.</p>
      </div>
      <Wardrobe />
    </div>
  );
}
