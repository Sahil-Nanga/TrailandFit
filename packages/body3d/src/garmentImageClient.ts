import type { GarmentCategory } from "./garments";

export interface GarmentPicture {
  /** JPEG data URL: the garment cropped, its backdrop filled with its own colour. */
  texture: string;
  /** #rrggbb, the garment's main colour (used for the back and sides). */
  color: string;
}

export class GarmentImageError extends Error {}

interface GarmentImageResponse {
  texture: string;
  color: string;
  cutout: boolean;
}

// Each product picture is prepared once per page load.
const cache = new Map<string, Promise<GarmentPicture>>();

/**
 * Ask the body-fit service to fetch a shop's product picture and turn it into a garment
 * texture. Shops rarely let pages read their images directly, so the service does it. When a
 * model is wearing it, `category` says which garment to crop out.
 */
export function loadGarmentPicture(
  serviceUrl: string,
  imageUrl: string,
  category: GarmentCategory,
): Promise<GarmentPicture> {
  const key = `${serviceUrl} ${category} ${imageUrl}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = request(serviceUrl, imageUrl, category);
    pending.catch(() => cache.delete(key)); // let a later attempt retry
    cache.set(key, pending);
  }
  return pending;
}

async function request(serviceUrl: string, imageUrl: string, category: GarmentCategory): Promise<GarmentPicture> {
  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/garment-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, category }),
    });
  } catch {
    throw new GarmentImageError("The body-fit service isn't running, so the product picture can't be used.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new GarmentImageError(message ?? "We couldn't use this product picture.");
  }
  const body = data as GarmentImageResponse;
  return { texture: body.texture, color: body.color };
}
