"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { QrCode, Save, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FeedbackMessage } from "@/components/feedback-message";
import { friendlyError } from "@/lib/ui-feedback";

type Form = { name: string; cnpj: string; phone: string; logo_url: string; validity_alert_days: string; replacement_alert_days: string; default_minimum_stock: string };
type Member = { id: string; full_name: string; role: "admin" | "rh" | "tst" | "user" };

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
  const [members, setMembers] = useState<Member[]>([]);
  const [viewerRole, setViewerRole] = useState<Member["role"]>("user");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      const { data: profile, error: profileError } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null, error: authError };
      if (profileError || !profile) setError(friendlyError(profileError ?? authError, "Não foi possível identificar a organização."));
      else if (profile?.organization_id) {
        const { data, error: loadError } = await supabase.from("organizations").select("name,cnpj,phone,logo_url,validity_alert_days,replacement_alert_days,default_minimum_stock").eq("id", profile.organization_id).single();
        if (loadError) setError(friendlyError(loadError, "Não foi possível carregar as configurações."));
        else if (data) setForm({ name: data.name ?? "", cnpj: data.cnpj ?? "", phone: data.phone ?? "", logo_url: data.logo_url ?? "", validity_alert_days: String(data.validity_alert_days), replacement_alert_days: String(data.replacement_alert_days), default_minimum_stock: String(data.default_minimum_stock) });
      }
      setLoading(false);
    }
    void load().catch((caught) => {
      setError(friendlyError(caught, "Falha ao carregar as configuracoes."));
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    async function loadMembers() {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile } = await supabase.from("profiles").select("organization_id,role").eq("id", auth.user.id).maybeSingle();
      if (!profile?.organization_id) return;
      setViewerRole(profile.role as Member["role"]);
      const { data } = await supabase.from("profiles").select("id,full_name,role").eq("organization_id", profile.organization_id).order("full_name");
      setMembers((data ?? []) as Member[]);
    }
    void loadMembers();
  }, []);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
    const supabase = createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    const { data: profile, error: profileError } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null, error: authError };
    if (profileError || !profile) { setError(friendlyError(profileError ?? authError, "Não foi possível identificar a organização.")); setSaving(false); return; }
    if (!profile?.organization_id) { setError("Organização não encontrada."); setSaving(false); return; }
    const { data: savedOrganization, error: saveError } = await supabase.from("organizations").update({
      name: form.name.trim(),
      cnpj: form.cnpj.trim() || null,
      phone: form.phone.trim() || null,
      logo_url: form.logo_url.trim() || null,
      validity_alert_days: nonNegativeInteger(form.validity_alert_days, 30),
      replacement_alert_days: nonNegativeInteger(form.replacement_alert_days, 7),
      default_minimum_stock: nonNegativeInteger(form.default_minimum_stock, 0),
    }).eq("id", profile.organization_id).select("id").maybeSingle();
    if (saveError || !savedOrganization) setError(friendlyError(saveError, "Não foi possível salvar as configurações. Verifique suas permissões de administrador.")); else setSuccess("Configurações salvas.");
    } catch (caught) {
      setError(friendlyError(caught, "Falha ao salvar as configuracoes."));
    } finally {
      setSaving(false);
    }
  }

  async function updateMemberRole(memberId: string, role: Member["role"]) {
    const { error: updateError } = await createClient().from("profiles").update({ role }).eq("id", memberId);
    if (updateError) setError(friendlyError(updateError, "Não foi possível atualizar o perfil. Apenas administradores podem alterar permissões."));
    else { setMembers((current) => current.map((member) => member.id === memberId ? { ...member, role } : member)); setSuccess("Permissão atualizada."); }
  }

  async function uploadLogo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) { setError("Selecione uma imagem de até 2 MB."); return; }
    setUploadingLogo(true); setError("");
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null };
      if (!profile?.organization_id) { setError("Não foi possível identificar a organização."); return; }
      const path = `${profile.organization_id}/logo`;
      const { error: uploadError } = await supabase.storage.from("organization-logos").upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) { setError(friendlyError(uploadError, "Não foi possível enviar o logo.")); return; }
      const { data: publicUrl } = supabase.storage.from("organization-logos").getPublicUrl(path);
      setForm((current) => ({ ...current, logo_url: publicUrl.publicUrl }));
      setSuccess("Logo carregado. Salve as configurações para confirmar.");
    } finally { setUploadingLogo(false); }
  }

  if (loading) return <main className="module-shell"><div className="module-loading" role="status" aria-live="polite">Carregando configurações...</div></main>;

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>Configurações</h1><p className="module-subtitle">Defina dados da organização e parâmetros usados nos alertas.</p></div><Link className="secondary-button" href="/portal-qr"><QrCode size={16} aria-hidden="true" /> QR Code do Portal</Link></header>{success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}{error && <FeedbackMessage>{error}</FeedbackMessage>}<section className="panel edit-employee-card" aria-labelledby="organization-settings-title"><form className="material-form" onSubmit={save} aria-busy={saving}><div className="form-section-title"><h2 id="organization-settings-title"><Settings size={17} aria-hidden="true" /> Organização</h2><p>Esses dados aparecem nas operações e relatórios.</p></div><div className="form-grid three"><label>Nome da organização<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="organization" required /></label><label>CNPJ<input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} inputMode="numeric" autoComplete="off" /></label><label>Telefone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} type="tel" autoComplete="tel" /></label><label>Logo da organização (URL)<input value={form.logo_url} onChange={(event) => setForm({ ...form, logo_url: event.target.value })} type="url" placeholder="https://..." /></label><label>Enviar logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void uploadLogo(event.target.files?.[0] ?? null)} disabled={uploadingLogo} />{form.logo_url && <img className="organization-logo-preview" src={form.logo_url} alt="Logo da organização" />}</label></div><div className="form-section-title"><h2 id="alert-settings-title">Parâmetros de alerta</h2><p>O Dashboard usará estes limites para destacar riscos.</p></div><div className="form-grid three" aria-labelledby="alert-settings-title"><label>Alertar validade com antecedência (dias)<input type="number" min="0" step="1" value={form.validity_alert_days} onChange={(event) => setForm({ ...form, validity_alert_days: event.target.value })} /></label><label>Alertar troca com antecedência (dias)<input type="number" min="0" step="1" value={form.replacement_alert_days} onChange={(event) => setForm({ ...form, replacement_alert_days: event.target.value })} /></label><label>Estoque mínimo padrão<input type="number" min="0" step="1" value={form.default_minimum_stock} onChange={(event) => setForm({ ...form, default_minimum_stock: event.target.value })} /></label></div><div className="modal-actions"><button type="submit" className="primary-button" disabled={saving} aria-busy={saving}>{saving ? "Salvando..." : "Salvar configurações"}<Save size={16} aria-hidden="true" /></button></div></form></section>{viewerRole === "admin" && members.length > 0 && <section className="panel settings-members-card" aria-labelledby="members-settings-title"><div className="form-section-title"><h2 id="members-settings-title">Usuários e permissões</h2><p>Defina o perfil operacional de cada usuário da organização.</p></div><div className="settings-members-list">{members.map((member) => <div className="settings-member-row" key={member.id}><div><strong>{member.full_name}</strong><small>{member.role === "admin" ? "Administrador" : member.role === "rh" ? "RH" : member.role === "tst" ? "TST" : "Usuário"}</small></div><select value={member.role} onChange={(event) => void updateMemberRole(member.id, event.target.value as Member["role"])} aria-label={`Perfil de ${member.full_name}`}><option value="admin">Administrador</option><option value="rh">RH</option><option value="tst">TST</option><option value="user">Usuário</option></select></div>)}</div></section>}</main>;
}
