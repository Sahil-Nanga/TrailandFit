import { Shirt, Tag } from "lucide-react";

/** Product picture from the shop, or a neutral placeholder when there is none. */
export function GarmentImage({
  src,
  alt,
  className,
  category,
}: {
  src: string | null;
  alt: string;
  className?: string;
  category?: "top" | "bottom" | "other";
}) {
  if (!src) {
    const Icon = category === "top" ? Shirt : Tag;
    return (
      <div className={`grid place-items-center bg-secondary text-primary ${className ?? ""}`} role="img" aria-label={alt}>
        <Icon aria-hidden className="size-8" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- images come from many shop domains
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={`bg-secondary object-cover ${className ?? ""}`}
    />
  );
}
