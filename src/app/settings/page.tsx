"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, QrCode, Save, Settings, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FeedbackMessage } from "@/components/feedback-message";
import { friendlyError } from "@/lib/ui-feedback";

type Form = { name: string; cnpj: string; phone: string; logo_url: string; validity_alert_days: string; replacement_alert_days: string; default_minimum_stock: string };
type Role = "admin" | "rh" | "tst" | "user";

function nonNegativeInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export default function SettingsPage() {
  const [form, setForm] = useState<Form>({ name: "", cnpj: "", phone: "", logo_url: "", validity_alert_days: "30", replacement_alert_days: "7", default_minimum_stock: "10" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [viewerRole, setViewerRole] = useState<Role>("user");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (auth.user) {
        const { data: platformAdmin } = await supabase.rpc("current_user_is_platform_admin");
        setIsPlatformAdmin(platformAdmin === true);
      }
      const { data: profile, error: profileError } = auth.user
        ? await supabase.from("profiles").select("organization_id,role").eq("id", auth.user.id).maybeSingle()
        : { data: null, error: authError };
      if (profileError || !profile) {
        setError(friendlyError(profileError ?? authError, "Não foi possível identificar a organização."));
      } else {
        setViewerRole(profile.role as Role);
        if (profile.organization_id) {
          const { data, error: loadError } = await supabase.from("organizations")
            .select("name,cnpj,phone,logo_url,validity_alert_days,replacement_alert_days,default_minimum_stock")
            .eq("id", profile.organization_id).single();
          if (loadError) setError(friendlyError(loadError, "Não foi possível carregar as configurações."));
          else if (data) setForm({ name: data.name ?? "", cnpj: data.cnpj ?? "", phone: data.phone ?? "", logo_url: data.logo_url ?? "", validity_alert_days: String(data.validity_alert_days), replacement_alert_days: String(data.replacement_alert_days), default_minimum_stock: String(data.default_minimum_stock) });
        }
      }
      setLoading(false);
    }
    void load().catch((caught) => {
      setError(friendlyError(caught, "Falha ao carregar as configurações."));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 4500);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      const { data: profile, error: profileError } = auth.user
        ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle()
        : { data: null, error: authError };
      if (profileError || !profile?.organization_id) {
        setError(friendlyError(profileError ?? authError, "Não foi possível identificar a organização."));
        return;
      }
      const { data: updated, error: saveError } = await supabase.from("organizations").update({
        name: form.name.trim(), cnpj: form.cnpj.trim() || null, phone: form.phone.trim() || null,
        logo_url: form.logo_url.trim() || null,
        validity_alert_days: nonNegativeInteger(form.validity_alert_days, 30),
        replacement_alert_days: nonNegativeInteger(form.replacement_alert_days, 7),
        default_minimum_stock: nonNegativeInteger(form.default_minimum_stock, 0),
      }).eq("id", profile.organization_id).select("id").maybeSingle();
      if (saveError || !updated) setError(friendlyError(saveError, "Não foi possível salvar. Verifique se sua conta pode editar as configurações."));
      else setSuccess("Configurações salvas.");
    } catch (caught) {
      setError(friendlyError(caught, "Falha ao salvar as configurações."));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) { setError("Selecione uma imagem de até 2 MB."); return; }
    setUploadingLogo(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null };
      if (!profile?.organization_id) { setError("Não foi possível identificar a organização."); return; }
      const path = `${profile.organization_id}/logo`;
      const { error: uploadError } = await supabase.storage.from("organization-logos").upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) { setError(friendlyError(uploadError, "Não foi possível enviar o logo.")); return; }
      const { data } = supabase.storage.from("organization-logos").getPublicUrl(path);
      setForm((current) => ({ ...current, logo_url: data.publicUrl }));
      setSuccess("Logo carregado. Salve as configurações para confirmar.");
    } finally {
      setUploadingLogo(false);
    }
  }

  if (loading) return <main className="module-shell"><div className="module-loading" role="status">Carregando configurações...</div></main>;

  return (
    <main className="module-shell">
      <header className="module-header">
        <div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>Configurações</h1><p className="module-subtitle">Gerencie os dados da organização e os acessos ao sistema.</p></div>
        <div className="settings-header-actions">
          {isPlatformAdmin && <Link className="secondary-button" href="/settings/organizations"><Building2 size={16} aria-hidden="true" /> Organizações</Link>}
          {viewerRole === "admin" && <Link className="primary-button" href="/settings/users"><Users size={16} aria-hidden="true" /> Usuários e acessos</Link>}
          <Link className="secondary-button" href="/portal-qr"><QrCode size={16} aria-hidden="true" /> QR Code do Portal</Link>
        </div>
      </header>
      {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}
      {error && <FeedbackMessage>{error}</FeedbackMessage>}
      <section className="panel edit-employee-card" aria-labelledby="organization-settings-title">
        <form className="material-form" onSubmit={save} aria-busy={saving}>
          <div className="form-section-title"><h2 id="organization-settings-title"><Settings size={17} aria-hidden="true" /> Organização</h2><p>Esses dados aparecem nas operações e relatórios.</p></div>
          <div className="form-grid three">
            <label>Nome da organização<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="organization" required /></label>
            <label>CNPJ<input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} inputMode="numeric" autoComplete="off" /></label>
            <label>Telefone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" autoComplete="tel" /></label>
            <label>Logo da organização (URL)<input value={form.logo_url} onChange={(event) => setForm({ ...form, logo_url: event.target.value })} type="url" placeholder="https://..." /></label>
            <label>Enviar logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void uploadLogo(event.target.files?.[0] ?? null)} disabled={uploadingLogo} />{form.logo_url && <img className="organization-logo-preview" src={form.logo_url} alt="Logo da organização" />}</label>
          </div>
          <div className="form-section-title"><h2 id="alert-settings-title">Parâmetros de alerta</h2><p>O Dashboard usará estes limites para destacar riscos.</p></div>
          <div className="form-grid three" aria-labelledby="alert-settings-title">
            <label>Alertar validade com antecedência (dias)<input type="number" min="0" step="1" value={form.validity_alert_days} onChange={(event) => setForm({ ...form, validity_alert_days: event.target.value })} /></label>
            <label>Alertar troca com antecedência (dias)<input type="number" min="0" step="1" value={form.replacement_alert_days} onChange={(event) => setForm({ ...form, replacement_alert_days: event.target.value })} /></label>
            <label>Estoque mínimo padrão<input type="number" min="0" step="1" value={form.default_minimum_stock} onChange={(event) => setForm({ ...form, default_minimum_stock: event.target.value })} /></label>
          </div>
          <div className="modal-actions"><button type="submit" className="primary-button" disabled={saving} aria-busy={saving}>{saving ? "Salvando..." : "Salvar configurações"}<Save size={16} aria-hidden="true" /></button></div>
        </form>
      </section>
    </main>
  );
}
