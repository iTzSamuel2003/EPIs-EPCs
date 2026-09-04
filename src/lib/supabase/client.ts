import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    // A chave publishable e feita para ficar no frontend; nunca use a service-role aqui.
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
      ? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      : "sb_publishable_9l2tSpFY9qHdAysv4P4ECw_rzqqgDbY";
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      publishableKey,
    );
  }

  return browserClient;
}
