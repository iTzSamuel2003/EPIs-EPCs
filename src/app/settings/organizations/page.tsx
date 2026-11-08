"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, ArrowLeft, Ban, Building2, Check, ChevronDown, Copy, Link2, Plus, RotateCw, Save, Trash2, Users, X } from "lucide-react";
import { FeedbackMessage } from "@/components/feedback-message";
import { useCurrentUser } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/client";
import { PAGE_PERMISSIONS } from "@/lib/access-control";

type LifecycleStatus = "draft" | "awaiting_admin" | "active" | "suspended";
type InvitationState = "pending" | "expired" | "revoked" | "accepted" | null;

type Organization = {
  id: string;
  name: string;
  cnpj: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  sesmt_manager: string | null;
  validity_alert_days: number;
  replacement_alert_days: number;
  default_minimum_stock: number;
  created_at: string;
  lifecycle_status: LifecycleStatus;
  member_count: number;
  first_admin_email: string | null;
  first_admin_invitation_id: string | null;
  first_admin_expires_at: string | null;
  first_admin_invitation_state: InvitationState;
};

type OrganizationForm = {
  name: string;
  cnpj: string;
  logo_url: string;
  address: string;
  phone: string;
  sesmt_manager: string;
  validity_alert_days: string;
  replacement_alert_days: string;
  default_minimum_stock: string;
};

type OrganizationMember = {
  user_id: string;
  full_name: string;
  email: string | null;
  role: "admin" | "rh" | "tst" | "user";
};

type OrganizationTestAccess = {
  organization_id: string;
  user_id: string;
  login_name: string;
  expires_at: string;
  revoked_at: string | null;
  is_active: boolean;
};

type IssuedTestCredentials = {
  login_name: string;
  password: string;
  expires_at: string;
};

type TestAccessConfirmation = { organizationId: string; action: "rotate" | "revoke" };

type ConfirmationAction = {
  organizationId: string;
  kind: "suspend" | "reactivate" | "delete" | "revoke";
  invitationId?: string;
  reason: string;
};

type CreatedInvitation = { invitation_id: string; expires_at: string };

type ContractTemplateStatus = {
  organization_id: string;
  organization_name: string;
  lifecycle_status: LifecycleStatus;
  installed_version: number | null;
  current_version: number;
  installed_sha256: string | null;
  current_sha256: string;
  is_current: boolean;
  is_source_organization: boolean;
};

function OrganizationLogoBadge({ logoUrl }: { logoUrl: string | null }) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const shouldShowLogo = Boolean(logoUrl && failedLogoUrl !== logoUrl);

  return <span className={`access-role-icon organization-logo-badge ${shouldShowLogo ? "has-logo" : ""}`} aria-hidden="true">
    {shouldShowLogo && logoUrl
      ? <Image src={logoUrl} alt="" width={44} height={44} unoptimized className="organization-logo-image" onError={() => setFailedLogoUrl(logoUrl)} />
      : <Building2 size={18} aria-hidden="true" />}
  </span>;
}

const lifecycleLabels: Record<LifecycleStatus, string> = {
  draft: "Rascunho",
  awaiting_admin: "Aguardando administrador",
  active: "Ativa",
  suspended: "Suspensa",
};

const invitationLabels: Record<Exclude<InvitationState, null>, string> = {
  pending: "Convite pendente",
  expired: "Convite expirado",
  revoked: "Convite revogado",
  accepted: "Convite aceito",
};

const roleLabels: Record<OrganizationMember["role"], string> = {
  admin: "Administrador",
  rh: "RH",
  tst: "TST",
  user: "Usuário",
};

function formFromOrganization(organization: Organization): OrganizationForm {
  return {
    name: organization.name ?? "",
    cnpj: organization.cnpj ?? "",
    logo_url: organization.logo_url ?? "",
    address: organization.address ?? "",
    phone: organization.phone ?? "",
    sesmt_manager: organization.sesmt_manager ?? "",
    validity_alert_days: String(organization.validity_alert_days ?? 30),
    replacement_alert_days: String(organization.replacement_alert_days ?? 7),
    default_minimum_stock: String(organization.default_minimum_stock ?? 10),
  };
}

function confirmationTitle(kind: ConfirmationAction["kind"]) {
  if (kind === "suspend") return "Suspender organização";
  if (kind === "reactivate") return "Reativar organização";
  if (kind === "delete") return "Excluir rascunho";
  return "Revogar convite";
}

function confirmationDescription(kind: ConfirmationAction["kind"]) {
  if (kind === "suspend") return "Os membros perderão acesso aos dados e módulos até a reativação.";
  if (kind === "reactivate") return "A organização voltará ao estado em que estava antes da suspensão.";
  if (kind === "delete") return "A exclusão só será permitida se não houver usuários, convites, registros ou arquivos vinculados.";
  return "O link atual deixará de funcionar. Você poderá emitir outro convite depois.";
}

export default function OrganizationsSettingsPage() {
  const { platformOnly } = useCurrentUser();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftCnpj, setDraftCnpj] = useState("");
  const [forms, setForms] = useState<Record<string, OrganizationForm>>({});
  const [adminEmails, setAdminEmails] = useState<Record<string, string>>({});
  const [invitationLinks, setInvitationLinks] = useState<Record<string, string>>({});
  const [copiedOrganizationId, setCopiedOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyOrganizationId, setBusyOrganizationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedOrganizationId, setExpandedOrganizationId] = useState<string | null>(null);
  const [organizationMembers, setOrganizationMembers] = useState<Record<string, OrganizationMember[]>>({});
  const [loadingMembersByOrganization, setLoadingMembersByOrganization] = useState<Record<string, boolean>>({});
  const [memberErrorsByOrganization, setMemberErrorsByOrganization] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<ConfirmationAction | null>(null);
  const [managementRequest, setManagementRequest] = useState<{ organization: Organization; reason: string } | null>(null);
  const [managementModalError, setManagementModalError] = useState("");
  const [startingManagement, setStartingManagement] = useState(false);
  const [contractTemplateStatuses, setContractTemplateStatuses] = useState<Record<string, ContractTemplateStatus>>({});
  const [contractTemplateError, setContractTemplateError] = useState("");
  const [contractTemplateLoading, setContractTemplateLoading] = useState(false);
  const [contractTemplateApplyingId, setContractTemplateApplyingId] = useState<string | null>(null);
  const [contractTemplateConfirmationId, setContractTemplateConfirmationId] = useState<string | null>(null);
  const [testAccessByOrganization, setTestAccessByOrganization] = useState<Record<string, OrganizationTestAccess>>({});
  const [testAccessLoading, setTestAccessLoading] = useState(false);
  const [testAccessError, setTestAccessError] = useState("");
  const [testAccessBusyOrganizationId, setTestAccessBusyOrganizationId] = useState<string | null>(null);
  const [testAccessConfirmation, setTestAccessConfirmation] = useState<TestAccessConfirmation | null>(null);
  const [issuedTestCredentials, setIssuedTestCredentials] = useState<Record<string, IssuedTestCredentials>>({});
  const [copiedTestCredentialsOrganizationId, setCopiedTestCredentialsOrganizationId] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError("");
    const client = createClient();
    setContractTemplateLoading(true);
    setTestAccessLoading(true);
    const [organizationsResult, templateStatusResult, testAccessResult] = await Promise.all([
      client.rpc("list_platform_organizations"),
      client.rpc("list_platform_contract_template_status"),
      client.rpc("list_platform_organization_test_access"),
    ]);
    const { data, error: loadError } = organizationsResult;
    if (templateStatusResult.error) {
      setContractTemplateStatuses({});
      setContractTemplateError(templateStatusResult.error.code === "PGRST202"
        ? "A situação do padrão contratual ficará disponível após a migration ser aplicada."
        : "Não foi possível consultar o padrão contratual. Verifique a conexão e as permissões da plataforma.");
    } else {
      const statuses = (templateStatusResult.data ?? []) as ContractTemplateStatus[];
      setContractTemplateStatuses(Object.fromEntries(statuses.map((status) => [status.organization_id, status])));
      setContractTemplateError("");
    }
    setContractTemplateLoading(false);
    if (testAccessResult.error) {
      setTestAccessByOrganization({});
      setTestAccessError(testAccessResult.error.code === "PGRST202"
        ? "O acesso de teste ficará disponível após a migração correspondente do banco."
        : "Não foi possível consultar os acessos de teste. Atualize a página e tente novamente.");
    } else {
      const accesses = (testAccessResult.data ?? []) as OrganizationTestAccess[];
      setTestAccessByOrganization(Object.fromEntries(accesses.map((access) => [access.organization_id, access])));
      setTestAccessError("");
    }
    setTestAccessLoading(false);
    if (loadError) {
      setError("Não foi possível carregar as organizações. Confirme se sua conta é administradora da plataforma e se a migração foi aplicada.");
      setOrganizations([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as Organization[];
    setOrganizations(rows);
    setForms((current) => Object.fromEntries(rows.map((organization) => [
      organization.id,
      current[organization.id] ?? formFromOrganization(organization),
    ])));
    setAdminEmails((current) => Object.fromEntries(rows.map((organization) => [
      organization.id,
      current[organization.id] ?? organization.first_admin_email ?? "",
    ])));
    setLoading(false);
  }, []);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);

  async function loadOrganizationMembers(organizationId: string) {
    setLoadingMembersByOrganization((current) => ({ ...current, [organizationId]: true }));
    setMemberErrorsByOrganization((current) => ({ ...current, [organizationId]: "" }));
    try {
      const { data, error: membersError } = await createClient().rpc("list_platform_organization_members", {
        p_organization_id: organizationId,
      });
      if (membersError) {
        setMemberErrorsByOrganization((current) => ({ ...current, [organizationId]: "Não foi possível carregar os usuários. Tente novamente." }));
      } else {
        setOrganizationMembers((current) => ({ ...current, [organizationId]: (data ?? []) as OrganizationMember[] }));
      }
    } catch {
      setMemberErrorsByOrganization((current) => ({ ...current, [organizationId]: "Não foi possível carregar os usuários. Tente novamente." }));
    } finally {
      setLoadingMembersByOrganization((current) => ({ ...current, [organizationId]: false }));
    }
  }

  function toggleOrganization(organizationId: string) {
    const isOpening = expandedOrganizationId !== organizationId;
    setExpandedOrganizationId(isOpening ? organizationId : null);
    if (isOpening) void loadOrganizationMembers(organizationId);
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { data: organizationId, error: createError } = await createClient().rpc("create_organization_draft", {
        p_name: draftName.trim(),
        p_cnpj: draftCnpj.trim() || null,
      });
      if (createError || !organizationId) {
        setError(createError?.message ?? "Não foi possível criar o rascunho.");
        return;
      }
      setDraftName("");
      setDraftCnpj("");
      setSuccess("Rascunho criado. Agora você pode completar os dados e preparar o convite do administrador.");
      await loadOrganizations();
      setExpandedOrganizationId(organizationId as string);
    } catch {
      setError("Não foi possível criar o rascunho. Verifique a conexão e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function saveOrganization(organization: Organization) {
    const form = forms[organization.id];
    if (!form) return;
    setBusyOrganizationId(organization.id);
    setError("");
    setSuccess("");
    try {
      const { error: updateError } = await createClient().rpc("update_platform_organization_draft", {
        p_organization_id: organization.id,
        p_name: form.name.trim(),
        p_cnpj: form.cnpj.trim() || null,
        p_logo_url: form.logo_url.trim() || null,
        p_address: form.address.trim() || null,
        p_phone: form.phone.trim() || null,
        p_sesmt_manager: form.sesmt_manager.trim() || null,
        p_validity_alert_days: Number(form.validity_alert_days),
        p_replacement_alert_days: Number(form.replacement_alert_days),
        p_default_minimum_stock: Number(form.default_minimum_stock),
      });
      if (updateError) {
        setError(updateError.message || "Não foi possível salvar as configurações desta organização.");
        return;
      }
      setSuccess(`Configurações de ${form.name.trim()} salvas.`);
      await loadOrganizations();
    } catch {
      setError("Não foi possível salvar as configurações. Tente novamente.");
    } finally {
      setBusyOrganizationId(null);
    }
  }

  async function applyContractTemplate(organization: Organization) {
    setContractTemplateApplyingId(organization.id);
    setContractTemplateError("");
    setError("");
    setSuccess("");
    try {
      const { data, error: applyError } = await createClient().rpc("apply_contract_template_version", {
        p_organization_id: organization.id,
      });
      if (applyError) {
        setError(applyError.message || "Não foi possível aplicar o padrão contratual.");
        return;
      }
      const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const version = Number(result.version ?? contractTemplateStatuses[organization.id]?.current_version ?? 1);
      const counts = [
        `${Number(result.added ?? 0)} item(ns) adicionados`,
        `${Number(result.updated ?? 0)} atualizados`,
        `${Number(result.overrides_preserved ?? 0)} campos personalizados preservados`,
        `${Number(result.review_required ?? 0)} item(ns) para revisão manual`,
      ].join("; ");
      setSuccess(result.no_op === true
        ? `${organization.name} já estava na versão v${version}; nenhuma duplicidade foi criada.`
        : `Padrão contratual v${version} aplicado a ${organization.name}: ${counts}. Estoque, colaboradores e bases não foram copiados.`);
      setContractTemplateConfirmationId(null);
      await loadOrganizations();
    } catch {
      setError("Não foi possível aplicar o padrão contratual. Tente novamente.");
    } finally {
      setContractTemplateApplyingId(null);
    }
  }

  async function inviteFirstAdmin(organization: Organization) {
    const email = (adminEmails[organization.id] ?? "").trim();
    if (!email) {
      setError("Informe o e-mail do primeiro administrador para gerar o convite.");
      return;
    }
    setBusyOrganizationId(organization.id);
    setError("");
    setSuccess("");
    setInvitationLinks((current) => ({ ...current, [organization.id]: "" }));
    try {
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const { data, error: inviteError } = await createClient().rpc("invite_first_organization_admin", {
        p_organization_id: organization.id,
        p_email: email,
        p_page_paths: PAGE_PERMISSIONS.map(([path]) => path),
        p_token: token,
      });
      const invitation = (data as CreatedInvitation[] | null)?.[0];
      if (inviteError || !invitation) {
        setError(inviteError?.message ?? "Não foi possível gerar o convite do primeiro administrador.");
        return;
      }
      setInvitationLinks((current) => ({ ...current, [organization.id]: new URL(`/invite/${token}`, window.location.origin).toString() }));
      setSuccess("Convite gerado. Copie e envie o link ao administrador; ele expira em 7 dias.");
      await loadOrganizations();
    } catch {
      setError("Não foi possível gerar o convite. Tente novamente.");
    } finally {
      setBusyOrganizationId(null);
    }
  }

  async function copyInvitation(organizationId: string) {
    const link = invitationLinks[organizationId];
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedOrganizationId(organizationId);
      window.setTimeout(() => setCopiedOrganizationId((current) => current === organizationId ? null : current), 2500);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione e copie o link exibido.");
    }
  }

  async function manageOrganizationTestAccess(organization: Organization, action: "generate" | "revoke") {
    setTestAccessBusyOrganizationId(organization.id);
    if (action === "generate") {
      setIssuedTestCredentials((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== organization.id)));
      setCopiedTestCredentialsOrganizationId(null);
    }
    setTestAccessError("");
    setError("");
    setSuccess("");
    try {
      const { data, error: requestError } = await createClient().functions.invoke("organization-test-access", {
        body: { action, organization_id: organization.id },
      });
      if (requestError || data?.error) {
        const message = data?.error || "Não foi possível concluir a operação de acesso de teste.";
        await Promise.all([loadOrganizations(), loadOrganizationMembers(organization.id)]);
        setError(message);
        return;
      }
      if (action === "generate") {
        if (typeof data?.login_name !== "string" || typeof data?.password !== "string" || typeof data?.expires_at !== "string") {
          setError("A conta foi processada, mas não foi possível exibir as credenciais. Tente gerar uma nova senha.");
          return;
        }
        setIssuedTestCredentials((current) => ({ ...current, [organization.id]: data as IssuedTestCredentials }));
        setSuccess(data.cleanup_warning
          ? `Acesso temporário de ${organization.name} gerado. ${data.cleanup_warning}`
          : `Acesso temporário de ${organization.name} gerado. A senha ficará visível somente nesta sessão.`);
      } else {
        setIssuedTestCredentials((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== organization.id)));
        setSuccess(`Acesso de teste de ${organization.name} revogado e removido.`);
      }
      setTestAccessConfirmation(null);
      await Promise.all([loadOrganizations(), loadOrganizationMembers(organization.id)]);
    } catch {
      setError("Não foi possível concluir a operação de acesso de teste. Tente novamente.");
    } finally {
      setTestAccessBusyOrganizationId(null);
    }
  }

  async function copyTestCredentials(organizationId: string) {
    const credentials = issuedTestCredentials[organizationId];
    if (!credentials) return;
    const expiry = new Date(credentials.expires_at).toLocaleString("pt-BR");
    try {
      await navigator.clipboard.writeText(`Usuário: ${credentials.login_name}\nSenha temporária: ${credentials.password}\nVálido até: ${expiry}`);
      setCopiedTestCredentialsOrganizationId(organizationId);
      window.setTimeout(() => setCopiedTestCredentialsOrganizationId((current) => current === organizationId ? null : current), 2500);
    } catch {
      setError("Não foi possível copiar as credenciais automaticamente.");
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const { organizationId, kind, invitationId, reason } = confirmation;
    const organization = organizations.find((item) => item.id === organizationId);
    if (!organization) return;
    setBusyOrganizationId(organizationId);
    setError("");
    setSuccess("");
    try {
      const client = createClient();
      const { error: actionError } = kind === "suspend"
        ? await client.rpc("set_organization_suspended", { p_organization_id: organizationId, p_reason: reason.trim() })
        : kind === "reactivate"
          ? await client.rpc("reactivate_organization", { p_organization_id: organizationId, p_reason: reason.trim() })
          : kind === "delete"
            ? await client.rpc("delete_organization_draft", { p_organization_id: organizationId, p_reason: reason.trim() })
            : await client.rpc("revoke_first_admin_invitation", { p_organization_id: organizationId, p_invitation_id: invitationId, p_reason: reason.trim() });
      if (actionError) {
        setError(actionError.message || "Não foi possível concluir a ação.");
        return;
      }
      setSuccess(kind === "delete" ? "Rascunho excluído." : `${confirmationTitle(kind)} concluída.`);
      setConfirmation(null);
      if (kind === "delete") setExpandedOrganizationId(null);
      await loadOrganizations();
      if (kind === "delete") setOrganizationMembers((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== organizationId)));
      else if (kind === "revoke") setInvitationLinks((current) => ({ ...current, [organizationId]: "" }));
    } catch {
      setError("Não foi possível concluir a ação. Verifique a conexão e tente novamente.");
    } finally {
      setBusyOrganizationId(null);
    }
  }

  async function startOrganizationManagement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managementRequest || managementRequest.reason.trim().length < 5) return;
    setStartingManagement(true);
    setManagementModalError("");
    try {
      const { error: startError } = await createClient().rpc("start_platform_organization_management_session", {
        p_organization_id: managementRequest.organization.id,
        p_reason: managementRequest.reason.trim(),
      });
      if (startError) {
        setManagementModalError(startError.message || "Não foi possível abrir a gestão desta organização.");
        return;
      }
      window.localStorage.setItem("epis.management-session-change", String(Date.now()));
      window.location.assign(new URL("/", window.location.origin).href);
    } catch {
      setManagementModalError("Não foi possível abrir a gestão desta organização. Tente novamente.");
    } finally {
      setStartingManagement(false);
    }
  }

  function updateForm(organizationId: string, field: keyof OrganizationForm, value: string) {
    setForms((current) => ({
      ...current,
      [organizationId]: { ...current[organizationId], [field]: value },
    }));
  }

  return (
    <main className="module-shell access-management-page organization-settings-page">
      <header className="module-header organization-settings-header">
        <div>
          {!platformOnly && <Link className="employee-back-link" href="/settings"><ArrowLeft size={14} aria-hidden="true" /> Configurações</Link>}
          <p className="eyebrow">ADMINISTRAÇÃO DA PLATAFORMA</p>
          <h1>Organizações</h1>
          <p className="module-subtitle">Prepare os dados gerais agora e convide o administrador quando tiver o e-mail.</p>
        </div>
      </header>

      {error && <FeedbackMessage>{error}</FeedbackMessage>}
      {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}

      {managementRequest && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !startingManagement) { setManagementModalError(""); setManagementRequest(null); } }}>
        <section className="modal-card organization-management-modal" role="dialog" aria-modal="true" aria-labelledby="organization-management-title">
          <div className="modal-heading"><span className="modal-icon"><Building2 size={19} aria-hidden="true" /></span><div><p className="eyebrow">ACESSO TEMPORÁRIO</p><h2 id="organization-management-title">Abrir gestão da organização</h2></div><button type="button" className="close-modal" aria-label="Fechar" onClick={() => setManagementRequest(null)} disabled={startingManagement}><X size={18} aria-hidden="true" /></button></div>
          <p className="organization-management-target">Você abrirá <strong>{managementRequest.organization.name}</strong> como administrador temporário da plataforma. O acesso expira automaticamente em 60 minutos e fica registrado para auditoria.</p>
          {managementModalError && <p className="organization-management-error" role="alert">{managementModalError}</p>}
          <form onSubmit={(event) => void startOrganizationManagement(event)}>
            <label htmlFor="organization-management-reason">Motivo do acesso<textarea id="organization-management-reason" value={managementRequest.reason} onChange={(event) => setManagementRequest((current) => current ? { ...current, reason: event.target.value } : current)} minLength={5} maxLength={500} rows={3} placeholder="Ex.: preparação inicial da organização" required autoFocus /></label>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setManagementRequest(null)} disabled={startingManagement}>Cancelar</button><button className="primary-button" type="submit" disabled={startingManagement || managementRequest.reason.trim().length < 5} aria-busy={startingManagement}>{startingManagement ? "Abrindo..." : "Abrir gestão"}</button></div>
          </form>
        </section>
      </div>}

      <section className="panel access-panel" aria-labelledby="create-organization-title">
        <div className="access-panel-heading">
          <div className="access-heading-icon"><Plus size={20} aria-hidden="true" /></div>
          <div><h2 id="create-organization-title">Criar rascunho</h2><p>Use um nome provisório; você poderá completar ou corrigir os dados depois.</p><p>O catálogo contratual vigente será copiado automaticamente. Anexos 03, 04 e 05 começam ativos; 06 e 07, inativos. A organização poderá ajustar isso em Materiais.</p><p>Bases, cidades, pessoas e estoque são cadastrados separadamente para cada organização.</p></div>
        </div>
        <form className="organization-draft-create" onSubmit={(event) => void createDraft(event)} aria-busy={saving}>
          <label>Nome provisório da organização<input value={draftName} onChange={(event) => setDraftName(event.target.value)} autoComplete="organization" minLength={2} maxLength={150} placeholder="Ex.: Organização 1" required /></label>
          <label>CNPJ <span className="muted">(opcional)</span><input value={draftCnpj} onChange={(event) => setDraftCnpj(event.target.value)} inputMode="numeric" autoComplete="off" /></label>
          <button type="submit" className="primary-button" disabled={saving} aria-busy={saving}><Plus size={16} aria-hidden="true" />{saving ? "Criando..." : "Criar rascunho"}</button>
        </form>
      </section>

      <section className="panel access-panel" aria-labelledby="organizations-list-title">
        <div className="access-panel-heading">
          <div className="access-heading-icon"><Building2 size={20} aria-hidden="true" /></div>
          <div><h2 id="organizations-list-title">Organizações cadastradas</h2><p>Configure dados gerais, acompanhe o convite inicial e consulte os membros.</p></div>
          <span className="access-count">{organizations.length} {organizations.length === 1 ? "organização" : "organizações"}</span>
        </div>
        {loading ? <p className="access-empty" role="status">Carregando organizações...</p> : organizations.length === 0 ? <p className="access-empty">Nenhuma organização cadastrada.</p> : <div className="access-role-list">
          {organizations.map((organization) => {
            const isOpen = expandedOrganizationId === organization.id;
            const membersPanelId = `organization-members-${organization.id}`;
            const members = organizationMembers[organization.id] ?? [];
            const form = forms[organization.id] ?? formFromOrganization(organization);
            const isEditable = organization.lifecycle_status === "draft" || organization.lifecycle_status === "awaiting_admin";
            const isBusy = busyOrganizationId === organization.id;
            const invitationLink = invitationLinks[organization.id];
            const templateStatus = contractTemplateStatuses[organization.id];
            const templateIsOutdated = Boolean(templateStatus && !templateStatus.is_current && !templateStatus.is_source_organization);
            const isApplyingTemplate = contractTemplateApplyingId === organization.id;
            const testAccess = testAccessByOrganization[organization.id];
            const issuedCredentials = issuedTestCredentials[organization.id];
            const isBusyWithTestAccess = testAccessBusyOrganizationId === organization.id;
            const isConfirmingTestAccess = testAccessConfirmation?.organizationId === organization.id;

            return <article className={`access-role-card organization-card ${isOpen ? "is-open" : ""}`} key={organization.id}>
              <button className="access-role-summary organization-summary" type="button" onClick={() => toggleOrganization(organization.id)} aria-expanded={isOpen} aria-controls={isOpen ? membersPanelId : undefined}>
                <OrganizationLogoBadge logoUrl={organization.logo_url} />
                <span className="access-role-copy"><strong>{organization.name}</strong><small>{organization.cnpj ? `CNPJ ${organization.cnpj}` : "CNPJ não informado"} · Criada em {new Date(organization.created_at).toLocaleDateString("pt-BR")}</small></span>
                <span className={`organization-status organization-status-${organization.lifecycle_status}`}>{lifecycleLabels[organization.lifecycle_status]}</span>
                <span className="access-count"><Users size={14} aria-hidden="true" /> {organization.member_count} {organization.member_count === 1 ? "usuário" : "usuários"}</span>
                <span className="organization-expand-label">{isOpen ? "Ocultar detalhes" : "Configurar e ver detalhes"}<ChevronDown size={16} className="access-chevron" aria-hidden="true" /></span>
              </button>
              {isOpen && <div className="organization-members-panel" id={membersPanelId}>
                <section className="organization-setup-section" aria-labelledby={`organization-template-${organization.id}`}>
                  <div className="organization-section-heading"><div><h3 id={`organization-template-${organization.id}`}>Padrão contratual</h3><p>Materiais, anexos, requisitos, listas por função, aliases e cursos, sem dados operacionais.</p></div>
                    {templateStatus?.is_source_organization
                      ? <span className="status-pill success">Fonte do padrão</span>
                      : templateStatus
                        ? <span className={`status-pill ${templateStatus.is_current ? "success" : "warning"}`}>{templateStatus.installed_version ? `v${templateStatus.installed_version} instalada` : "Não instalado"}</span>
                        : <span className="status-pill">{contractTemplateLoading ? "Consultando..." : "Indisponível"}</span>}
                  </div>
                  {contractTemplateError && <p className="organization-members-feedback" role="status">{contractTemplateError}</p>}
                  {templateStatus && <p className="organization-current-invite">Versão vigente: <strong>v{templateStatus.current_version}</strong>{templateStatus.installed_version ? ` · Conteúdo SHA-256 ${templateStatus.installed_sha256?.slice(0, 12)}…` : " · Esta organização ainda não recebeu o padrão."}</p>}
                  {templateStatus?.is_source_organization
                    ? <p className="organization-members-feedback">Esta organização é a fonte do catálogo e já está registrada na versão atual. Ela não recebe uma cópia sobre seus próprios dados.</p>
                    : templateIsOutdated && <>
                      {contractTemplateConfirmationId === organization.id
                        ? <div className="organization-action-confirm" role="group" aria-labelledby={`organization-template-confirm-${organization.id}`}>
                          <div className="organization-confirm-heading"><AlertTriangle size={17} aria-hidden="true" /><div><h4 id={`organization-template-confirm-${organization.id}`}>Aplicar versão v{templateStatus.current_version}?</h4><p>Campos contratuais ainda iguais ao padrão anterior podem ser atualizados. Personalizações e ativações dos anexos serão preservadas; itens ausentes não serão excluídos e ficarão para revisão. A operação é apenas para esta organização.</p></div><button type="button" className="close-modal" aria-label="Cancelar aplicação" onClick={() => setContractTemplateConfirmationId(null)}><X size={17} aria-hidden="true" /></button></div>
                          <div className="organization-confirm-actions"><button className="secondary-button" type="button" onClick={() => setContractTemplateConfirmationId(null)}>Cancelar</button><button className="primary-button" type="button" onClick={() => void applyContractTemplate(organization)} disabled={isApplyingTemplate} aria-busy={isApplyingTemplate}>{isApplyingTemplate ? "Aplicando..." : `Aplicar v${templateStatus.current_version}`}</button></div>
                        </div>
                        : <button className="secondary-button" type="button" onClick={() => setContractTemplateConfirmationId(organization.id)} disabled={contractTemplateLoading || Boolean(contractTemplateApplyingId)}><RotateCw size={15} aria-hidden="true" /> Aplicar padrão v{templateStatus.current_version}</button>}
                    </>}
                  {organization.lifecycle_status === "draft" && !templateStatus?.is_source_organization && <p className="organization-members-feedback">Ao criar um novo rascunho, a versão vigente é instalada automaticamente. Bases, colaboradores, cursos realizados e estoque devem ser cadastrados nesta organização.</p>}
                </section>
                {isEditable ? <>
                  <section className="organization-setup-section" aria-labelledby={`organization-config-${organization.id}`}>
                    <div className="organization-section-heading"><div><h3 id={`organization-config-${organization.id}`}>Dados e parâmetros gerais</h3><p>Os módulos operacionais detalhados poderão ser configurados em uma próxima etapa de gestão.</p></div><span>Preparação</span></div>
                    <form className="organization-config-grid" onSubmit={(event) => { event.preventDefault(); void saveOrganization(organization); }} aria-busy={isBusy}>
                      <label>Nome da organização<input value={form.name} onChange={(event) => updateForm(organization.id, "name", event.target.value)} minLength={2} maxLength={150} required /></label>
                      <label>CNPJ<input value={form.cnpj} onChange={(event) => updateForm(organization.id, "cnpj", event.target.value)} inputMode="numeric" /></label>
                      <label>Telefone<input value={form.phone} onChange={(event) => updateForm(organization.id, "phone", event.target.value)} autoComplete="tel" /></label>
                      <label>Responsável SESMT<input value={form.sesmt_manager} onChange={(event) => updateForm(organization.id, "sesmt_manager", event.target.value)} /></label>
                      <label className="organization-config-wide">Endereço<input value={form.address} onChange={(event) => updateForm(organization.id, "address", event.target.value)} autoComplete="street-address" /></label>
                      <label className="organization-config-wide">URL do logo<input type="url" value={form.logo_url} onChange={(event) => updateForm(organization.id, "logo_url", event.target.value)} placeholder="https://..." /></label>
                      <label>Alerta de validade (dias)<input type="number" min="0" max="365" step="1" value={form.validity_alert_days} onChange={(event) => updateForm(organization.id, "validity_alert_days", event.target.value)} required /></label>
                      <label>Alerta de troca prevista (dias)<input type="number" min="0" max="365" step="1" value={form.replacement_alert_days} onChange={(event) => updateForm(organization.id, "replacement_alert_days", event.target.value)} required /></label>
                      <label>Estoque mínimo padrão<input type="number" min="0" max="1000000" step="1" value={form.default_minimum_stock} onChange={(event) => updateForm(organization.id, "default_minimum_stock", event.target.value)} required /></label>
                      <div className="organization-form-actions"><button className="primary-button" type="submit" disabled={isBusy} aria-busy={isBusy}><Save size={16} aria-hidden="true" />{isBusy ? "Salvando..." : "Salvar configuração"}</button></div>
                    </form>
                  </section>

                  <section className="organization-setup-section" aria-labelledby={`organization-invite-${organization.id}`}>
                    <div className="organization-section-heading"><div><h3 id={`organization-invite-${organization.id}`}>Convidar o primeiro administrador</h3><p>O acesso completo à organização só será ativado depois que o convite for aceito.</p></div>{organization.first_admin_invitation_state && <span className={`organization-invitation-state invitation-${organization.first_admin_invitation_state}`}>{invitationLabels[organization.first_admin_invitation_state]}</span>}</div>
                    {organization.first_admin_email && <p className="organization-current-invite">Último e-mail informado: <strong>{organization.first_admin_email}</strong>{organization.first_admin_expires_at && organization.first_admin_invitation_state === "pending" ? ` · válido até ${new Date(organization.first_admin_expires_at).toLocaleDateString("pt-BR")}` : ""}</p>}
                    <div className="organization-invite-form">
                      <label htmlFor={`organization-admin-email-${organization.id}`}>E-mail do administrador<input id={`organization-admin-email-${organization.id}`} type="email" autoComplete="email" value={adminEmails[organization.id] ?? ""} onChange={(event) => setAdminEmails((current) => ({ ...current, [organization.id]: event.target.value }))} placeholder="nome@empresa.com" required /></label>
                      <button className="secondary-button" type="button" onClick={() => void inviteFirstAdmin(organization)} disabled={isBusy} aria-busy={isBusy}><Link2 size={15} aria-hidden="true" />{organization.first_admin_invitation_state === "pending" ? "Reemitir convite" : "Gerar convite"}</button>
                    </div>
                    {invitationLink && <div className="invite-link-box organization-invite-link"><input aria-label="Link do convite do primeiro administrador" value={invitationLink} readOnly onFocus={(event) => event.currentTarget.select()} /><button className="secondary-button" type="button" onClick={() => void copyInvitation(organization.id)}>{copiedOrganizationId === organization.id ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copiedOrganizationId === organization.id ? "Copiado" : "Copiar link"}</button></div>}
                    {organization.first_admin_invitation_state === "pending" && organization.first_admin_invitation_id && <button className="organization-text-action organization-danger-action" type="button" onClick={() => setConfirmation({ organizationId: organization.id, kind: "revoke", invitationId: organization.first_admin_invitation_id ?? undefined, reason: "" })} disabled={isBusy}><Ban size={14} aria-hidden="true" /> Revogar convite pendente</button>}
                  </section>
                </> : <section className="organization-setup-section">
                  <div className="organization-section-heading"><div><h3>Dados da organização</h3><p>Organização ativa; edição operacional pela plataforma depende do modo de gestão da próxima etapa.</p></div></div>
                  <dl className="organization-readonly-grid"><div><dt>CNPJ</dt><dd>{organization.cnpj || "Não informado"}</dd></div><div><dt>Telefone</dt><dd>{organization.phone || "Não informado"}</dd></div><div><dt>Responsável SESMT</dt><dd>{organization.sesmt_manager || "Não informado"}</dd></div><div><dt>Endereço</dt><dd>{organization.address || "Não informado"}</dd></div></dl>
                </section>}

                <section className="organization-setup-section" aria-labelledby={`organization-test-access-${organization.id}`}>
                  <div className="organization-section-heading"><div><h3 id={`organization-test-access-${organization.id}`}>Acesso temporário de teste</h3><p>Conta de administrador somente desta organização, útil para validar o sistema sem cadastrar um e-mail real. Expira em 7 dias.</p></div>{testAccess && <span className={`organization-test-access-status ${testAccess.is_active ? "is-active" : testAccess.revoked_at ? "is-revoked" : "is-expired"}`}>{testAccess.is_active ? "Ativo" : testAccess.revoked_at ? "Revogado" : organization.lifecycle_status === "suspended" ? "Suspenso" : "Expirado"}</span>}</div>
                  {testAccessError && <p className="organization-test-access-note" role="status">{testAccessError}</p>}
                  {testAccess && <p className="organization-current-invite">Usuário: <strong>{testAccess.login_name}</strong> · Válido até {new Date(testAccess.expires_at).toLocaleString("pt-BR")}</p>}
                  {issuedCredentials && <div className="organization-test-credentials" role="status" aria-live="polite">
                    <div><strong>Guarde a senha temporária agora</strong><p>Por segurança, a senha não é armazenada para consulta futura. Se ela for perdida, gere uma nova; a anterior deixará de funcionar.</p></div>
                    <dl><div><dt>Usuário</dt><dd>{issuedCredentials.login_name}</dd></div><div><dt>Senha temporária</dt><dd><code>{issuedCredentials.password}</code></dd></div><div><dt>Expira em</dt><dd>{new Date(issuedCredentials.expires_at).toLocaleString("pt-BR")}</dd></div></dl>
                    <button className="secondary-button" type="button" onClick={() => void copyTestCredentials(organization.id)}>{copiedTestCredentialsOrganizationId === organization.id ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copiedTestCredentialsOrganizationId === organization.id ? "Credenciais copiadas" : "Copiar credenciais"}</button>
                  </div>}
                  {isConfirmingTestAccess && <div className="organization-test-access-confirm" role="group" aria-labelledby={`organization-test-access-confirm-${organization.id}`}>
                    <div><h4 id={`organization-test-access-confirm-${organization.id}`}>{testAccessConfirmation?.action === "revoke" ? "Revogar o acesso de teste?" : "Gerar outro acesso?"}</h4><p>{testAccessConfirmation?.action === "revoke" ? "A conta será removida e sessões existentes perderão acesso aos dados desta organização." : "Será criado um novo usuário e senha; a conta anterior e suas sessões perderão acesso. O prazo de 7 dias começará novamente."}</p></div>
                    <div className="organization-test-access-actions"><button className="secondary-button" type="button" onClick={() => setTestAccessConfirmation(null)} disabled={isBusyWithTestAccess}>Cancelar</button><button className={testAccessConfirmation?.action === "revoke" ? "organization-text-action organization-danger-action" : "primary-button"} type="button" onClick={() => void manageOrganizationTestAccess(organization, testAccessConfirmation?.action === "revoke" ? "revoke" : "generate")} disabled={isBusyWithTestAccess} aria-busy={isBusyWithTestAccess}>{isBusyWithTestAccess ? "Processando..." : testAccessConfirmation?.action === "revoke" ? "Revogar acesso" : "Gerar novo acesso"}</button></div>
                  </div>}
                  <div className="organization-test-access-actions">
                    <button className="secondary-button" type="button" onClick={() => testAccess?.is_active ? setTestAccessConfirmation({ organizationId: organization.id, action: "rotate" }) : void manageOrganizationTestAccess(organization, "generate")} disabled={organization.lifecycle_status === "suspended" || testAccessLoading || Boolean(testAccessError) || isBusyWithTestAccess} aria-busy={isBusyWithTestAccess}>{isBusyWithTestAccess ? "Processando..." : organization.lifecycle_status === "suspended" ? "Organização suspensa" : testAccess?.is_active ? "Gerar novo acesso" : testAccess ? "Renovar acesso de teste" : "Gerar acesso de teste"}</button>
                    {testAccess && <button className="organization-text-action organization-danger-action" type="button" onClick={() => setTestAccessConfirmation({ organizationId: organization.id, action: "revoke" })} disabled={isBusyWithTestAccess}>{testAccess.revoked_at ? "Tentar remover conta" : "Revogar e remover conta"}</button>}
                  </div>
                </section>

                <section className="organization-setup-section" aria-label="Ações da organização">
                  <div className="organization-lifecycle-actions">
                    {organization.lifecycle_status !== "suspended" && <button className="secondary-button" type="button" onClick={() => { setManagementModalError(""); setManagementRequest({ organization, reason: "" }); }} disabled={isBusy}><Building2 size={15} aria-hidden="true" /> Abrir gestão</button>}
                    {organization.lifecycle_status === "suspended"
                      ? <button className="secondary-button" type="button" onClick={() => setConfirmation({ organizationId: organization.id, kind: "reactivate", reason: "" })}><RotateCw size={15} aria-hidden="true" /> Reativar organização</button>
                      : <button className="organization-text-action organization-danger-action" type="button" onClick={() => setConfirmation({ organizationId: organization.id, kind: "suspend", reason: "" })}><Ban size={14} aria-hidden="true" /> Suspender organização</button>}
                    {organization.lifecycle_status === "draft" && <button className="organization-text-action organization-danger-action" type="button" onClick={() => setConfirmation({ organizationId: organization.id, kind: "delete", reason: "" })}><Trash2 size={14} aria-hidden="true" /> Excluir rascunho vazio</button>}
                  </div>
                  {confirmation?.organizationId === organization.id && <div className="organization-action-confirm" role="group" aria-labelledby={`organization-action-${organization.id}`}>
                    <div className="organization-confirm-heading"><AlertTriangle size={17} aria-hidden="true" /><div><h4 id={`organization-action-${organization.id}`}>{confirmationTitle(confirmation.kind)}</h4><p>{confirmationDescription(confirmation.kind)}</p></div><button type="button" className="close-modal" aria-label="Cancelar ação" onClick={() => setConfirmation(null)}><X size={17} aria-hidden="true" /></button></div>
                    <label>Motivo para auditoria<textarea value={confirmation.reason} onChange={(event) => setConfirmation((current) => current ? { ...current, reason: event.target.value } : current)} minLength={3} maxLength={500} rows={2} placeholder="Descreva brevemente o motivo" required /></label>
                    <div className="organization-confirm-actions"><button className="secondary-button" type="button" onClick={() => setConfirmation(null)}>Cancelar</button><button className="primary-button" type="button" onClick={() => void confirmAction()} disabled={isBusy || confirmation.reason.trim().length < 3} aria-busy={isBusy}>{isBusy ? "Processando..." : confirmationTitle(confirmation.kind)}</button></div>
                  </div>}
                </section>

                <section className="organization-setup-section" aria-labelledby={`organization-members-title-${organization.id}`}>
                  <div className="organization-section-heading"><div><h3 id={`organization-members-title-${organization.id}`}>Membros da organização</h3><p>Consulte os usuários vinculados e o perfil de cada um.</p></div><span>{organization.member_count} {organization.member_count === 1 ? "pessoa" : "pessoas"}</span></div>
                  {loadingMembersByOrganization[organization.id] ? <p className="organization-members-feedback" role="status">Carregando usuários...</p>
                    : memberErrorsByOrganization[organization.id] ? <div className="organization-members-feedback" role="alert"><span>{memberErrorsByOrganization[organization.id]}</span><button type="button" className="secondary-button" onClick={() => void loadOrganizationMembers(organization.id)}>Tentar novamente</button></div>
                      : members.length === 0 ? <p className="organization-members-feedback">Ainda não há usuários vinculados.</p>
                        : <ul className="organization-members-list">{members.map((member) => <li className="organization-member-row" key={member.user_id}>
                          <span className="access-member-avatar" aria-hidden="true">{member.full_name.trim().slice(0, 1).toLocaleUpperCase("pt-BR") || "?"}</span>
                          <span className="organization-member-copy"><strong>{member.full_name}</strong><span>{member.email || "E-mail não informado"}</span></span>
                          <span className={`organization-user-role role-${member.role}`}>{roleLabels[member.role]}</span>
                        </li>)}</ul>}
                </section>
              </div>}
            </article>;
          })}
        </div>}
      </section>

      <p className="access-helper"><Link2 size={14} aria-hidden="true" /> Use “Abrir gestão” para acessar temporariamente os módulos da organização. Cada acesso exige justificativa, fica registrado e expira em 60 minutos.</p>
    </main>
  );
}
