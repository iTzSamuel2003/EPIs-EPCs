"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Copy, Link2, LockKeyhole, RotateCcw, Save, Shield, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { FeedbackMessage } from "@/components/feedback-message";
import { PAGE_PERMISSIONS, rolePageDefaults } from "@/lib/access-control";

type Role = "admin" | "rh" | "tst" | "user";
type ManagedRole = Exclude<Role, "admin">;
type Member = { id: string; full_name: string; role: Role; customPaths: string[] | null };
type RoleAccess = Record<ManagedRole, string[]>;
const roles: ManagedRole[] = ["rh", "tst", "user"];
const roleLabel: Record<Role, string> = { admin: "Administrador", rh: "RH", tst: "TST", user: "Usuário" };
const roleDescription: Record<ManagedRole, string> = { rh: "Rotinas de pessoal, entregas e acompanhamento dos colaboradores.", tst: "Materiais, estoque, ensaios e rotinas de segurança.", user: "Acesso básico ao painel e à central de ajuda." };
const pageGroups = [
  { label: "Visão geral", paths: ["/"] },
  { label: "Cadastros", paths: ["/materials", "/employees", "/teams", "/units", "/variants", "/function-templates"] },
  { label: "Operações", paths: ["/entries", "/deliveries", "/returns", "/discounts", "/requests", "/stock", "/validities"] },
  { label: "Recursos Humanos", paths: ["/attendance"] },
  { label: "Conformidade", paths: ["/ca", "/contract-requirements", "/tests", "/training-compliance", "/compliance"] },
  { label: "Gestão e suporte", paths: ["/costs", "/reports", "/movements", "/audit", "/settings", "/help"] },
];
const pageLabel = new Map<string, string>(PAGE_PERMISSIONS.map(([path, label]) => [path, label]));
const emptyRoleAccess = (): RoleAccess => ({ rh: [...rolePageDefaults.rh], tst: [...rolePageDefaults.tst], user: [...rolePageDefaults.user] });

export default function UsersSettingsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [roleAccess, setRoleAccess] = useState<RoleAccess>(emptyRoleAccess);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("user");
  const [invitePaths, setInvitePaths] = useState<string[]>([...rolePageDefaults.user]);
  const [inviteLink, setInviteLink] = useState("");
  const [expandedRole, setExpandedRole] = useState<ManagedRole | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [viewerId, setViewerId] = useState("");

  const filteredMembers = useMemo(() => members.filter((member) => member.full_name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))), [members, search]);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (!auth.user) { setError(authError?.message || "Sua sessão expirou. Entre novamente."); setLoading(false); return; }
    const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id,role").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profile?.organization_id || profile.role !== "admin") { setError("Somente administradores podem gerenciar os acessos da organização."); setLoading(false); return; }
    setViewerId(auth.user.id);
    const [memberResult, roleResult, overrideResult] = await Promise.all([
      supabase.from("profiles").select("id,full_name,role").eq("organization_id", profile.organization_id).order("full_name"),
      supabase.from("organization_role_access").select("role,page_paths").eq("organization_id", profile.organization_id),
      supabase.from("profile_access_overrides").select("profile_id,page_paths").eq("organization_id", profile.organization_id),
    ]);
    if (memberResult.error || roleResult.error || overrideResult.error) {
      setError("Não foi possível carregar todos os acessos. Confira se a atualização do banco de dados foi aplicada.");
      setLoading(false);
      return;
    }
    const nextRoles = emptyRoleAccess();
    for (const row of roleResult.data ?? []) if (row.role in nextRoles) nextRoles[row.role as ManagedRole] = row.page_paths ?? [];
    const overrides = new Map((overrideResult.data ?? []).map((row) => [row.profile_id, row.page_paths ?? []]));
    setRoleAccess(nextRoles);
    setInvitePaths([...nextRoles.user]);
    setMembers((memberResult.data ?? []).map((member) => ({ id: member.id, full_name: member.full_name || "Usuário sem nome", role: member.role as Role, customPaths: member.role === "admin" ? null : overrides.get(member.id) ?? null })));
    setLoading(false);
  }

  function effectivePaths(member: Member) {
    if (member.role === "admin") return PAGE_PERMISSIONS.map(([path]) => path);
    return member.customPaths ?? roleAccess[member.role];
  }

  async function saveRole(role: ManagedRole) {
    setSaving(true); setError(""); setSuccess("");
    const { data: auth } = await createClient().auth.getUser();
    const { data: profile } = auth.user ? await createClient().from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null };
    if (!profile?.organization_id) { setError("Não foi possível identificar a organização."); setSaving(false); return; }
    const { error: saveError } = await createClient().from("organization_role_access").upsert({ organization_id: profile.organization_id, role, page_paths: roleAccess[role], updated_at: new Date().toISOString() }, { onConflict: "organization_id,role" });
    if (saveError) setError("Não foi possível salvar o acesso padrão deste perfil.");
    else { setSuccess(`Acesso padrão de ${roleLabel[role]} atualizado.`); setExpandedRole(null); }
    setSaving(false);
  }

  async function saveMember(member: Member) {
    setSaving(true); setError(""); setSuccess("");
    const supabase = createClient();
    const { error: roleError } = await supabase.from("profiles").update({ role: member.role }).eq("id", member.id);
    if (roleError) { setError("Não foi possível atualizar o perfil do usuário."); setSaving(false); return; }
    if (member.role !== "admin" && member.customPaths !== null) {
      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle() : { data: null };
      if (!profile?.organization_id) { setError("Não foi possível identificar a organização."); setSaving(false); return; }
      const { error: accessError } = await supabase.from("profile_access_overrides").upsert({ organization_id: profile.organization_id, profile_id: member.id, page_paths: member.customPaths, updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
      if (accessError) { setError("O perfil foi atualizado, mas não foi possível salvar os acessos personalizados."); setSaving(false); return; }
    } else {
      const { error: clearError } = await supabase.from("profile_access_overrides").delete().eq("profile_id", member.id);
      if (clearError) { setError("O perfil foi atualizado, mas não foi possível restaurar o padrão de acesso."); setSaving(false); return; }
    }
    setSuccess(member.role === "admin" ? "Perfil atualizado. Administradores mantêm acesso completo." : member.customPaths === null ? "Perfil atualizado; este usuário seguirá o padrão da função." : "Perfil e acessos individuais atualizados.");
    setSaving(false);
  }

  async function createInvite() {
    if (!email.trim()) { setError("Informe o e-mail do usuário."); return; }
    setSaving(true); setError(""); setSuccess(""); setInviteLink("");
    try {
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const { data, error: inviteError } = await createClient().rpc("create_organization_invitation", { p_email: email.trim(), p_role: inviteRole, p_page_paths: inviteRole === "admin" ? PAGE_PERMISSIONS.map(([path]) => path) : invitePaths, p_token: token });
      if (inviteError || !data?.[0]) { setError(inviteError?.message || "Não foi possível criar o convite."); return; }
      setInviteLink(`${window.location.origin}/invite/${token}`);
      setSuccess("Convite criado. Copie o link e envie ao usuário; ele vale por 7 dias.");
      setEmail("");
    } finally { setSaving(false); }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setSuccess("Link copiado para a área de transferência.");
  }

  function updateMember(id: string, update: Partial<Member>) {
    setMembers((current) => current.map((member) => member.id === id ? { ...member, ...update } : member));
  }

  if (loading) return <main className="module-shell"><div className="module-loading" role="status">Carregando usuários e acessos...</div></main>;

  return (
    <main className="module-shell access-management-page">
      <header className="module-header">
        <div><Link className="employee-back-link" href="/settings"><ArrowLeft size={14} /> Configurações</Link><p className="eyebrow">ADMINISTRAÇÃO DA ORGANIZAÇÃO</p><h1>Usuários e acessos</h1><p className="module-subtitle">Defina o padrão de cada função e personalize o acesso de pessoas específicas.</p></div>
      </header>
      {error && <FeedbackMessage>{error}</FeedbackMessage>}{success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}

      <section className="panel access-panel" aria-labelledby="role-access-title">
        <div className="access-panel-heading"><div className="access-heading-icon"><Shield size={20} /></div><div><h2 id="role-access-title">Acesso por função</h2><p>Use um padrão para novos convites e para usuários sem personalização individual.</p></div></div>
        <div className="access-role-list">
          {roles.map((role) => {
            const open = expandedRole === role;
            return <article className={`access-role-card ${open ? "is-open" : ""}`} key={role}>
              <button className="access-role-summary" type="button" onClick={() => setExpandedRole(open ? null : role)} aria-expanded={open}>
                <span className="access-role-icon"><Users size={18} /></span><span className="access-role-copy"><strong>{roleLabel[role]}</strong><small>{roleDescription[role]}</small></span>
                <span className="access-count">{roleAccess[role].length} páginas</span><ChevronDown size={18} className="access-chevron" />
              </button>
              {open && <div className="access-role-editor"><PermissionPicker role={role} paths={roleAccess[role]} onChange={(paths) => setRoleAccess((current) => ({ ...current, [role]: paths }))} /><div className="access-editor-footer"><span>{roleAccess[role].length} páginas liberadas para este perfil</span><button className="primary-button" type="button" onClick={() => void saveRole(role)} disabled={saving}><Save size={15} /> {saving ? "Salvando..." : "Salvar padrão da função"}</button></div></div>}
            </article>;
          })}
          <div className="access-admin-note"><LockKeyhole size={17} /><span><strong>Administrador</strong><small>Tem acesso completo ao sistema para gerenciar a organização e evitar bloqueios administrativos.</small></span></div>
        </div>
      </section>

      <section className="panel access-panel" aria-labelledby="member-access-title">
        <div className="access-panel-heading"><div className="access-heading-icon"><Users size={20} /></div><div><h2 id="member-access-title">Acesso por usuário</h2><p>Troque o perfil ou abra uma pessoa para ajustar suas páginas individualmente.</p></div><span className="access-count">{members.length} usuários</span></div>
        <label className="access-search">Buscar usuário<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite o nome do usuário" /></label>
        <div className="access-member-list">
          {filteredMembers.map((member) => {
            const open = expandedMember === member.id;
            const paths = effectivePaths(member);
            return <article className={`access-member-card ${open ? "is-open" : ""}`} key={member.id}>
              <div className="access-member-summary"><div className="access-member-avatar">{member.full_name.trim().slice(0, 1).toLocaleUpperCase("pt-BR")}</div><div className="access-member-copy"><strong>{member.full_name}</strong><span>{roleLabel[member.role]} · {member.role === "admin" ? "Acesso completo" : member.customPaths === null ? "Segue o padrão da função" : "Acesso personalizado"}</span></div>{member.role !== "admin" && <span className="access-count">{paths.length} páginas</span>}<button className="secondary-button access-edit-button" type="button" onClick={() => setExpandedMember(open ? null : member.id)} aria-expanded={open}>{open ? "Fechar" : "Editar acesso"}<ChevronDown size={16} /></button></div>
              {open && <div className="access-member-editor"><div className="access-member-controls"><label>Função do usuário<select value={member.role} disabled={member.id === viewerId} onChange={(event) => { const nextRole = event.target.value as Role; const customPaths = nextRole === "admin" ? null : member.customPaths?.filter((path) => nextRole === "rh" || path !== "/attendance") ?? null; updateMember(member.id, { role: nextRole, customPaths }); }} aria-describedby={member.id === viewerId ? `self-role-${member.id}` : undefined}>{Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{member.id === viewerId && <small id={`self-role-${member.id}`}>Para proteger o acesso administrativo, você não pode alterar o próprio perfil.</small>}</label>{member.role !== "admin" && <button className="text-action" type="button" onClick={() => updateMember(member.id, { customPaths: null })}><RotateCcw size={14} /> Usar padrão de {roleLabel[member.role]}</button>}</div>
                {member.role === "admin" ? <div className="access-admin-note"><LockKeyhole size={17} /><span><strong>Acesso completo</strong><small>Esse perfil não pode ter páginas removidas por esta tela.</small></span></div> : <><p className="access-helper">{member.customPaths === null ? `Este usuário usa o padrão atual de ${roleLabel[member.role]}. Marque ou desmarque páginas abaixo para criar uma exceção individual.` : "Este usuário tem uma configuração própria, independente do padrão da função."}</p><PermissionPicker role={member.role} paths={paths} onChange={(nextPaths) => updateMember(member.id, { customPaths: nextPaths })} /></>}
                <div className="access-editor-footer"><span>{member.role === "admin" ? "Acesso completo" : `${paths.length} páginas liberadas`}</span><button className="primary-button" type="button" onClick={() => void saveMember(member)} disabled={saving}><Save size={15} /> {saving ? "Salvando..." : "Salvar usuário"}</button></div>
              </div>}
            </article>;
          })}
          {filteredMembers.length === 0 && <p className="access-empty">Nenhum usuário encontrado.</p>}
        </div>
      </section>

      <section className="panel access-panel access-invite-panel" aria-labelledby="invite-title">
        <div className="access-panel-heading"><div className="access-heading-icon"><UserPlus size={20} /></div><div><h2 id="invite-title">Convidar usuário</h2><p>O convite permite que a pessoa crie a senha e entre na organização.</p></div></div>
        <div className="access-invite-fields"><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com" /></label><label>Função inicial<select value={inviteRole} onChange={(event) => { const nextRole = event.target.value as Role; setInviteRole(nextRole); setInvitePaths(nextRole === "admin" ? PAGE_PERMISSIONS.map(([path]) => path) : [...roleAccess[nextRole]]); }}>{[...roles, "admin" as const].map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}</select></label><div className="access-invite-count"><Check size={17} /><span><strong>{inviteRole === "admin" ? "Acesso completo" : `${invitePaths.length} páginas liberadas`}</strong><small>{inviteRole === "admin" ? "Administradores acessam todas as páginas." : "O convite usa o padrão atual da função."}</small></span></div></div>
        {inviteRole === "admin" ? <div className="access-admin-note"><LockKeyhole size={17} /><span><strong>Administrador</strong><small>Este perfil terá acesso completo e poderá gerenciar os usuários da organização.</small></span></div> : <details className="access-invite-details"><summary>Personalizar os acessos deste convite</summary><PermissionPicker role={inviteRole} paths={invitePaths} onChange={setInvitePaths} /></details>}
        <div className="access-invite-actions"><button className="primary-button" type="button" onClick={() => void createInvite()} disabled={saving}><Link2 size={16} /> {saving ? "Gerando convite..." : "Gerar link de convite"}</button>{inviteLink && <div className="invite-link-box"><input readOnly value={inviteLink} aria-label="Link de convite gerado" /><button className="secondary-button" type="button" onClick={() => void copyInvite()}><Copy size={15} /> Copiar link</button></div>}</div>
      </section>
    </main>
  );
}

function PermissionPicker({ paths, role, onChange }: { paths: string[]; role: ManagedRole; onChange: (paths: string[]) => void }) {
  return <div className="access-permission-groups">{pageGroups.map((group) => {
    const pages = group.paths.map((path) => [path, pageLabel.get(path)] as const).filter((item): item is readonly [string, string] => Boolean(item[1]));
    if (!pages.length) return null;
    const selectedCount = pages.filter(([path]) => paths.includes(path)).length;
    return <fieldset className="access-permission-group" key={group.label}><legend>{group.label}<span>{selectedCount}/{pages.length}</span></legend><div className="access-permission-options">{pages.map(([path, label]) => { const rhOnly = path === "/attendance" && role !== "rh"; return <label className={`access-permission-option ${rhOnly ? "permission-rh-only" : ""}`} key={path} title={rhOnly ? "Disponível somente para os perfis RH e Administrador." : undefined}><input type="checkbox" checked={paths.includes(path)} disabled={rhOnly} onChange={() => onChange(paths.includes(path) ? paths.filter((item) => item !== path) : [...paths, path])} /><span>{label}{rhOnly && <small>Somente RH</small>}</span></label>; })}</div></fieldset>;
  })}</div>;
}
