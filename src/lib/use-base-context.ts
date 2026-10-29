"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type OperationalBase = { id: string; name: string; address: string | null; is_active: boolean };
const STORAGE_KEY = "epis.selectedBaseId";

export function useBaseContext() {
  const [bases, setBases] = useState<OperationalBase[]>([]);
  const [accessibleBases, setAccessibleBases] = useState<OperationalBase[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const supabase = createClient();
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
        const [{ data: profile, error: profileError }, { data: baseRows, error: baseError }, { data: assignments, error: assignmentError }] = await Promise.all([
          supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle(),
          supabase.from("organization_bases").select("id,name,address,is_active").eq("is_active", true).order("name"),
          supabase.from("profile_base_access").select("base_id").eq("profile_id", auth.user.id),
        ]);
        if (profileError || baseError || assignmentError) throw profileError ?? baseError ?? assignmentError;
        const all = (baseRows ?? []) as OperationalBase[];
        const allBasesAccess = profile?.role === "admin" || profile?.role === "rh";
        const allowedIds = new Set((assignments ?? []).map((assignment) => assignment.base_id));
        const allowed = allBasesAccess ? all : all.filter((base) => allowedIds.has(base.id));
        if (cancelled) return;
        setBases(all);
        setAccessibleBases(allowed);
        const stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
        const initial = allowed.some((base) => base.id === stored)
          ? stored
          : allowed.find((base) => base.name.toLocaleLowerCase("pt-BR") === "dourados")?.id ?? allowed[0]?.id ?? "";
        setSelectedBaseId(initial);
        if (initial) window.localStorage.setItem(STORAGE_KEY, initial);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Não foi possível carregar as bases.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const chooseBase = useCallback((baseId: string) => {
    setSelectedBaseId(baseId);
    if (baseId) window.localStorage.setItem(STORAGE_KEY, baseId);
  }, []);

  return { bases, accessibleBases, selectedBaseId, chooseBase, loading, error };
}
