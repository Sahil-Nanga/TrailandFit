export interface Likeness {
  /** PNG data URL: the body texture with the face baked in (glTF UV layout). Kept in memory only. */
  texture: string;
  skinColor: string;
  eyeColor: string | null;
}

export class LikenessError extends Error {}

interface LikenessResponse {
  texture: string;
  skin_color: string;
  eye_color: string | null;
}

/** Send a front photo to the body-fit service and get the face baked into the body texture. */
export async function bakeLikeness(
  serviceUrl: string,
  photo: Blob,
  weights: Record<string, number>,
  bodyType: number,
  signal?: AbortSignal,
): Promise<Likeness> {
  const form = new FormData();
  form.append("photo", photo, "front");
  form.append("weights", JSON.stringify(weights));
  form.append("body_type", String(bodyType));
  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/likeness`, { method: "POST", body: form, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LikenessError("The body-fit service isn't running, so your photo can't be used right now.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new LikenessError(message ?? "We couldn't use this photo. Please try another one.");
  }
  const body = data as LikenessResponse;
  return { texture: body.texture, skinColor: body.skin_color, eyeColor: body.eye_color };
}

/** Fetch a (signed) photo URL and bake it. The photo is only held in memory for the request. */
export async function bakeLikenessFromUrl(
  serviceUrl: string,
  photoUrl: string,
  weights: Record<string, number>,
  bodyType: number,
  signal?: AbortSignal,
): Promise<Likeness> {
  let photo: Response;
  try {
    photo = await fetch(photoUrl, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LikenessError("We couldn't load your saved photo. Please try again.");
  }
  if (!photo.ok) throw new LikenessError("We couldn't load your saved photo. Please try again.");
  return bakeLikeness(serviceUrl, await photo.blob(), weights, bodyType, signal);
}
