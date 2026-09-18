"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { QrCode, Save, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FeedbackMessage } from "@/components/feedback-message";
import { friendlyError } from "@/lib/ui-feedback";

type Form = { name: string; cnpj: string; phone: string; validity_alert_days: string; replacement_alert_days: string; default_minimum_stock: string };

function nonNegativeInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export default function SettingsPage() {
  const [form, setForm] = useState<Form>({ name: "", cnpj: "", phone: "", validity_alert_days: "30", replacement_alert_days: "7", default_minimum_stock: "10" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      const { data: profile, error: profileError } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null, error: authError };
      if (profileError || !profile) setError(friendlyError(profileError ?? authError, "Não foi possível identificar a organização."));
      else if (profile?.organization_id) {
        const { data, error: loadError } = await supabase.from("organizations").select("name,cnpj,phone,validity_alert_days,replacement_alert_days,default_minimum_stock").eq("id", profile.organization_id).single();
        if (loadError) setError(friendlyError(loadError, "Não foi possível carregar as configurações."));
        else if (data) setForm({ name: data.name ?? "", cnpj: data.cnpj ?? "", phone: data.phone ?? "", validity_alert_days: String(data.validity_alert_days), replacement_alert_days: String(data.replacement_alert_days), default_minimum_stock: String(data.default_minimum_stock) });
      }
      setLoading(false);
    }
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const supabase = createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    const { data: profile, error: profileError } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null, error: authError };
    if (profileError || !profile) { setError(friendlyError(profileError ?? authError, "Não foi possível identificar a organização.")); setSaving(false); return; }
    if (!profile?.organization_id) { setError("Organização não encontrada."); setSaving(false); return; }
    const { error: saveError } = await supabase.from("organizations").update({
      name: form.name.trim(),
      cnpj: form.cnpj.trim() || null,
      phone: form.phone.trim() || null,
      validity_alert_days: nonNegativeInteger(form.validity_alert_days, 30),
      replacement_alert_days: nonNegativeInteger(form.replacement_alert_days, 7),
      default_minimum_stock: nonNegativeInteger(form.default_minimum_stock, 0),
    }).eq("id", profile.organization_id);
    if (saveError) setError(friendlyError(saveError, "Não foi possível salvar as configurações.")); else setSuccess("Configurações salvas.");
    setSaving(false);
  }

  if (loading) return <main className="module-shell"><div className="module-loading">Carregando configurações...</div></main>;

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>Configurações</h1><p className="module-subtitle">Defina dados da organização e parâmetros usados nos alertas.</p></div><Link className="secondary-button" href="/portal-qr"><QrCode size={16} /> QR Code do Portal</Link></header>{success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}{error && <FeedbackMessage>{error}</FeedbackMessage>}<section className="panel edit-employee-card"><form className="material-form" onSubmit={save}><div className="form-section-title"><h2><Settings size={17} /> Organização</h2><p>Esses dados aparecem nas operações e relatórios.</p></div><div className="form-grid three"><label>Nome da organização<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>CNPJ<input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} /></label><label>Telefone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label></div><div className="form-section-title"><h2>Parâmetros de alerta</h2><p>O Dashboard usará estes limites para destacar riscos.</p></div><div className="form-grid three"><label>Alertar validade com antecedência (dias)<input type="number" min="0" step="1" value={form.validity_alert_days} onChange={(event) => setForm({ ...form, validity_alert_days: event.target.value })} /></label><label>Alertar troca com antecedência (dias)<input type="number" min="0" step="1" value={form.replacement_alert_days} onChange={(event) => setForm({ ...form, replacement_alert_days: event.target.value })} /></label><label>Estoque mínimo padrão<input type="number" min="0" step="1" value={form.default_minimum_stock} onChange={(event) => setForm({ ...form, default_minimum_stock: event.target.value })} /></label></div><div className="modal-actions"><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar configurações"}<Save size={16} /></button></div></form></section></main>;
}
