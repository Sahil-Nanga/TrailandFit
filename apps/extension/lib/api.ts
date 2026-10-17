import { createApiClient } from "@aurora/api-client";

import { API_URL } from "./config";
import { supabase } from "./supabase";

export const api = createApiClient({
  baseUrl: API_URL,
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
