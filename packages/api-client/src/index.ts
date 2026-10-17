/**
 * Typed client for the Aurora API. Everything here is derived from the FastAPI OpenAPI
 * schema; regenerate with `pnpm gen:api` after changing a Pydantic schema.
 */
import createClient, { type Middleware } from "openapi-fetch";

import openapi from "../openapi.json";
import type { components, paths } from "./schema";

export type { components, paths };

type Schemas = components["schemas"];
export type Measurements = Schemas["Measurements"];
export type MeasurementProfile = Schemas["MeasurementProfile"];
export type ProfileCreate = Schemas["ProfileCreate"];
export type ProfileUpdate = Schemas["ProfileUpdate"];
export type ProfilePage = Schemas["ProfilePage"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type PhotoEstimate = Schemas["PhotoEstimate"];
export type MeasurementField = keyof Measurements;

// --- Validation ranges, read from the schema so the UI matches the server exactly ----------

type JsonSchemaNumber = { minimum?: number; maximum?: number };
type JsonSchemaProperty = JsonSchemaNumber & { anyOf?: JsonSchemaNumber[] };

const measurementProperties = openapi.components.schemas.Measurements
  .properties as Record<MeasurementField, JsonSchemaProperty>;

function rangeOf(property: JsonSchemaProperty): { min: number; max: number } {
  const source = property.anyOf?.find((option) => option.minimum !== undefined) ?? property;
  if (source.minimum === undefined || source.maximum === undefined) {
    throw new Error("Measurement field without a range in the OpenAPI schema");
  }
  return { min: source.minimum, max: source.maximum };
}

export const MEASUREMENT_FIELDS = Object.keys(measurementProperties) as MeasurementField[];

export const MEASUREMENT_RANGES = Object.fromEntries(
  MEASUREMENT_FIELDS.map((field) => [field, rangeOf(measurementProperties[field])]),
) as Record<MeasurementField, { min: number; max: number }>;

// --- Client -------------------------------------------------------------------------------

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions) {
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  };
  const client = createClient<paths>({ baseUrl });
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export interface PhotoEstimateInput {
  front: Blob;
  side?: Blob | null;
  heightCm: number;
  consent: boolean;
}

/**
 * POST /v1/photos/estimate as multipart/form-data. OpenAPI models the files as strings, so
 * this builds the FormData itself; field names still come from the generated schema type.
 */
export function estimatePhoto(client: ApiClient, input: PhotoEstimateInput) {
  type Body = paths["/v1/photos/estimate"]["post"]["requestBody"]["content"]["multipart/form-data"];
  const fields: Record<keyof Body, Blob | string | null> = {
    front_photo: input.front,
    side_photo: input.side ?? null,
    height_cm: String(input.heightCm),
    consent: String(input.consent),
  };
  return client.POST("/v1/photos/estimate", {
    body: fields as unknown as Body,
    bodySerializer: () => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) {
        if (value !== null) form.append(name, value);
      }
      return form;
    },
  });
}

/** Pulls the user-facing message out of an API error body, if it has the standard shape. */
export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
  const body = error as Partial<ErrorResponse> | undefined;
  return body?.error?.message ?? fallback;
}
