import { Camera, PencilRuler } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Get your measurements</h1>
        <p className="text-muted-foreground">
          Choose how you want to start. You can always check and correct the numbers.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/measure/photo"
          className="group flex flex-col gap-3 rounded-xl border p-6 transition-colors hover:border-primary/40 hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Camera aria-hidden className="size-8 text-primary" />
          <h2 className="text-lg font-medium">Use a photo</h2>
          <p className="text-sm text-muted-foreground">
            Take or upload a full-body photo and we estimate your measurements.
          </p>
          <span className="mt-auto text-sm font-medium text-primary underline-offset-4 group-hover:underline">
            Start →
          </span>
        </Link>

        <Link
          href="/measure/manual"
          className="group flex flex-col gap-3 rounded-xl border p-6 transition-colors hover:border-primary/40 hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <PencilRuler aria-hidden className="size-8 text-primary" />
          <h2 className="text-lg font-medium">Enter manually</h2>
          <p className="text-sm text-muted-foreground">
            Type in measurements you took with a tape measure.
          </p>
          <span className="mt-auto text-sm font-medium text-primary underline-offset-4 group-hover:underline">
            Start →
          </span>
        </Link>
      </div>
    </div>
  );
}
