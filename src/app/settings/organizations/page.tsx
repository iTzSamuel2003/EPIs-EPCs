"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Check, Copy, Link2, Plus, Users } from "lucide-react";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";
import { PAGE_PERMISSIONS } from "@/lib/access-control";

type Organization = {
  id: string;
  name: string;
  cnpj: string | null;
  created_at: string;
  member_count: number;
};

type CreatedInvitation = {
  organization_id: string;
  invitation_id: string;
  expires_at: string;
};

export default function OrganizationsSettingsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [name, setName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: loadError } = await createClient().rpc("list_platform_organizations");
    if (loadError) {
      setError("Não foi possível carregar as organizações. Confirme se sua conta é administradora da plataforma e se a atualização do banco foi aplicada.");
      setOrganizations([]);
    } else {
      setOrganizations((data ?? []) as Organization[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    setInvitationLink("");
    try {
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const { data, error: createError } = await createClient().rpc("create_organization_with_admin_invitation", {
        p_name: name.trim(),
        p_cnpj: cnpj.trim() || null,
        p_admin_email: adminEmail.trim(),
        p_admin_page_paths: PAGE_PERMISSIONS.map(([path]) => path),
        p_token: token,
      });
      const invitation = (data as CreatedInvitation[] | null)?.[0];
      if (createError || !invitation) {
        setError(createError?.message ?? "Não foi possível criar a organização e o convite.");
        return;
      }
      const url = new URL(`/invite/${token}`, window.location.origin).toString();
      setInvitationLink(url);
      setSuccess("Organização criada. Envie o convite ao administrador da empresa; o link expira em 7 dias.");
      setName("");
      setCnpj("");
      setAdminEmail("");
      await loadOrganizations();
    } catch {
      setError("Não foi possível concluir a criação. Verifique sua conexão e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function copyInvitation() {
    if (!invitationLink) return;
    try {
      await navigator.clipboard.writeText(invitationLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o link exibido.");
    }
  }

  return (
    <main className="module-shell access-management-page">
      <header className="module-header">
        <div>
          <Link className="employee-back-link" href="/settings"><ArrowLeft size={14} aria-hidden="true" /> Configurações</Link>
          <p className="eyebrow">ADMINISTRAÇÃO DA PLATAFORMA</p>
          <h1>Organizações</h1>
          <p className="module-subtitle">Cadastre empresas independentes e convide o primeiro administrador de cada uma.</p>
        </div>
      </header>

      {error && <FeedbackMessage>{error}</FeedbackMessage>}
      {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}

      <section className="panel access-panel" aria-labelledby="create-organization-title">
        <div className="access-panel-heading">
          <div className="access-heading-icon"><Plus size={20} aria-hidden="true" /></div>
          <div><h2 id="create-organization-title">Adicionar organização</h2><p>Os dados e usuários de cada empresa ficam isolados dos demais.</p></div>
        </div>
        <form className="material-form" onSubmit={createOrganization} aria-busy={saving}>
          <div className="form-grid three">
            <label>Nome da empresa<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="organization" minLength={2} maxLength={150} required /></label>
            <label>CNPJ <span className="muted">(opcional)</span><input value={cnpj} onChange={(event) => setCnpj(event.target.value)} inputMode="numeric" autoComplete="off" /></label>
            <label>E-mail do primeiro administrador<input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} autoComplete="email" required /></label>
          </div>
          <p className="access-helper">O administrador receberá acesso completo apenas à própria empresa. Ele poderá convidar RH, TST e outros usuários.</p>
          <div className="modal-actions"><button type="submit" className="primary-button" disabled={saving} aria-busy={saving}><Plus size={16} aria-hidden="true" />{saving ? "Criando organização..." : "Criar organização e convite"}</button></div>
        </form>
        {invitationLink && <div className="access-invite-actions" aria-label="Convite do administrador">
          <label className="access-helper" htmlFor="organization-invitation-link">Link do convite do primeiro administrador</label>
          <div className="invite-link-box"><input id="organization-invitation-link" value={invitationLink} readOnly onFocus={(event) => event.currentTarget.select()} /><button className="secondary-button" type="button" onClick={() => void copyInvitation()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copiado" : "Copiar convite"}</button></div>
        </div>}
      </section>

      <section className="panel access-panel" aria-labelledby="organizations-list-title">
        <div className="access-panel-heading">
          <div className="access-heading-icon"><Building2 size={20} aria-hidden="true" /></div>
          <div><h2 id="organizations-list-title">Empresas cadastradas</h2><p>Visão administrativa; os dados operacionais permanecem separados por empresa.</p></div>
          <span className="access-count">{organizations.length} organizações</span>
        </div>
        {loading ? <p className="access-empty" role="status">Carregando organizações...</p> : organizations.length === 0 ? <p className="access-empty">Nenhuma organização disponível.</p> : <div className="access-role-list">
          {organizations.map((organization) => <article className="access-role-card" key={organization.id}>
            <div className="access-role-summary">
              <span className="access-role-icon"><Building2 size={18} aria-hidden="true" /></span>
              <span className="access-role-copy"><strong>{organization.name}</strong><small>{organization.cnpj ? `CNPJ ${organization.cnpj}` : "CNPJ não informado"} · Criada em {new Date(organization.created_at).toLocaleDateString("pt-BR")}</small></span>
              <span className="access-count"><Users size={14} aria-hidden="true" /> {organization.member_count} usuários</span>
            </div>
          </article>)}
        </div>}
      </section>

      <p className="access-helper"><Link2 size={14} aria-hidden="true" /> Cada usuário entra em uma organização por convite. Para transferir uma pessoa entre empresas, será necessário um fluxo específico de migração.</p>
    </main>
  );
}
