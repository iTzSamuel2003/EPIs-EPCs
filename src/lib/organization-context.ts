import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type CurrentOrganizationProfile = {
  organization_id: string | null;
  role: string | null;
  full_name: string | null;
};

type ManagementContextRow = { organization_id: string };

export async function getCurrentOrganizationProfile(
  supabase: SupabaseClient,
  userId: string,
  fallbackName?: string | null,
): Promise<{ data: CurrentOrganizationProfile | null; error: PostgrestError | null }> {
  const { data: managementRows, error: managementError } = await supabase.rpc(
    "get_platform_organization_management_context",
  );

  if (managementError) return { data: null, error: managementError };

  const managementContext = Array.isArray(managementRows)
    ? (managementRows[0] as ManagementContextRow | undefined)
    : undefined;

  if (managementContext?.organization_id) {
    const { data: ownProfile, error: ownProfileError } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    if (ownProfileError) return { data: null, error: ownProfileError };

    return {
      data: {
        organization_id: managementContext.organization_id,
        role: "admin",
        full_name: ownProfile?.full_name?.trim() || fallbackName?.trim() || null,
      },
      error: null,
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id,role,full_name")
    .eq("id", userId)
    .maybeSingle();

  return { data, error };
}
