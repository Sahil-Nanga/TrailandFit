import { createApiClient } from "@aurora/api-client";

import { getAccessToken } from "@/lib/auth";

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  getToken: getAccessToken,
});
