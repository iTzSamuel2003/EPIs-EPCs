"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Scenario = { id: string; name: string; source_annex: string; team_size: number | null; active: boolean };
type Employee = { id: string; full_name: string; registration: string | null; job_title?: string | null; function_name?: string | null; function_classification?: string | null };
type TeamMember = { employee_id: string; role: string | null; active?: boolean; employee: Employee | null };
type Team = { id: string; name: string; scenario_id: string; vehicle_identifier: string | null; notes: string | null; status: string; scenario: Scenario | null; members: TeamMember[] };
const emptyForm = { name: "", scenario_id: "", vehicle_identifier: "", notes: "" };
function employeeTeamRole(employee: Employee) {
  const title = (employee.job_title || employee.function_name || "").replace(/\s+(VI|V|IV|III|II|I)$/i, "").trim();
  return [title, employee.function_classification ? `Classe ${employee.function_classification}` : ""].filter(Boolean).join(" · ");
}

export default function TeamsPage() {
  const [retryKey, setRetryKey] = useState(0);
  const [scenarios, setScenarios] = useState<Scenario[]>([]); const [employees, setEmployees] = useState<Employee[]>([]); const [teams, setTeams] = useState<Team[]>([]); const [form, setForm] = useState(emptyForm); const [teamId, setTeamId] = useState(""); const [employeeId, setEmployeeId] = useState(""); const [role, setRole] = useState(""); const [memberToManage, setMemberToManage] = useState<TeamMember | null>(null); const [memberRole, setMemberRole] = useState(""); const [targetTeamId, setTargetTeamId] = useState(""); const [confirmRemoveMember, setConfirmRemoveMember] = useState(false); const [showAddMember, setShowAddMember] = useState(false); const [editingTeamId, setEditingTeamId] = useState<string | null>(null); const [showForm, setShowForm] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(true);
  async function load() {
    mountedRef.current = true;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: scenarioData, error: scenarioError }, { data: employeeData, error: employeeError }, { data: teamData, error: teamError }] = await Promise.all([
        supabase.from("contract_scenarios").select("id,name,source_annex,team_size,active").eq("active", true).order("name"),
        supabase.from("employees").select("id,full_name,registration,job_title,function_name,function_classification").eq("status", "active").order("full_name"),
        supabase.from("contract_teams").select("id,name,scenario_id,vehicle_identifier,notes,status,scenario:contract_scenarios(id,name,source_annex,team_size,active),members:contract_team_members(employee_id,role,active,employee:employees(id,full_name,registration))").order("name"),
      ]);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      const firstError = scenarioError ?? employeeError ?? teamError;
      if (firstError) {
        setScenarios([]);
        setEmployees([]);
        setTeams([]);
        setError(friendlyError(firstError, "Não foi possível carregar as equipes."));
        return;
      }
      setScenarios((scenarioData ?? []) as Scenario[]);
      setEmployees((employeeData ?? []) as Employee[]);
      const loadedTeams = (teamData ?? []) as unknown as Team[];
      setTeams(loadedTeams.map((team) => ({ ...team, members: team.members.filter((member) => member.active !== false) })));
    } catch (unexpectedError) {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setScenarios([]);
        setEmployees([]);
        setTeams([]);
        setError(friendlyError(unexpectedError, "Não foi possível carregar as equipes."));
      }
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); return () => { mountedRef.current = false; }; }, [retryKey]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);
  function retryLoad() { setError(""); setScenarios([]); setEmployees([]); setTeams([]); setRetryKey((current) => current + 1); }
  async function getOrganizationContext() {
    const supabase = createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) return { supabase, organizationId: null, error: friendlyError(authError, "Não foi possível concluir a operação.") };
    if (!auth.user) return { supabase, organizationId: null, error: "Sua sessão expirou. Entre novamente." };
    const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single();
    if (profileError) return { supabase, organizationId: null, error: friendlyError(profileError, "Não foi possível concluir a operação.") };
    if (!profile?.organization_id) return { supabase, organizationId: null, error: "Não foi possível identificar a organização do usuário." };
    return { supabase, organizationId: profile.organization_id, error: "" };
  }
  async function saveTeam(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const { supabase, organizationId, error: contextError } = await getOrganizationContext();
    if (!organizationId) { setError(contextError); setSaving(false); return; }
    let saveError = "";
    if (editingTeamId) {
      const { data: updatedTeam, error: updateError } = await supabase.from("contract_teams").update(form).eq("id", editingTeamId).eq("organization_id", organizationId).select("id").maybeSingle();
      if (updateError) saveError = friendlyError(updateError, "Não foi possível atualizar a equipe.");
      else if (!updatedTeam) saveError = "A equipe não foi encontrada nesta organização.";
    } else {
      const { error: insertError } = await supabase.from("contract_teams").insert({ ...form, organization_id: organizationId });
      if (insertError) saveError = friendlyError(insertError, "Não foi possível cadastrar a equipe.");
    }
    if (saveError) setError(saveError);
    else { setSuccess(editingTeamId ? "Dados da equipe atualizados." : "Equipe contratual cadastrada."); closeTeamForm(); await load(); }
    setSaving(false);
  }
  async function addMember(event: FormEvent) { event.preventDefault(); if (!teamId || !employeeId) return; setSaving(true); setError(""); const { supabase, organizationId, error: contextError } = await getOrganizationContext(); if (!organizationId) { setError(contextError); setSaving(false); return; } const { error: memberError } = await supabase.from("contract_team_members").upsert({ organization_id: organizationId, team_id: teamId, employee_id: employeeId, role: role || null, active: true }, { onConflict: "team_id,employee_id" }); if (memberError) setError(friendlyError(memberError, "Não foi possível concluir a operação.")); else { setSuccess("Colaborador vinculado à equipe."); setEmployeeId(""); setRole(""); setShowAddMember(false); await load(); } setSaving(false); }
  async function saveMemberRole() {
    if (!selectedTeam || !memberToManage) return;
    setSaving(true); setError("");
    const { supabase, organizationId, error: contextError } = await getOrganizationContext();
    if (!organizationId) { setError(contextError); setSaving(false); return; }
    const { data: updatedMember, error: updateError } = await supabase.from("contract_team_members").update({ role: memberRole.trim() || null }).eq("organization_id", organizationId).eq("team_id", selectedTeam.id).eq("employee_id", memberToManage.employee_id).eq("active", true).select("employee_id").maybeSingle();
    if (updateError) setError(friendlyError(updateError, "Não foi possível atualizar os dados do vínculo."));
    else if (!updatedMember) setError("O vínculo não foi encontrado. Atualize a página e tente novamente.");
    else { setSuccess("Função na equipe atualizada."); setMemberToManage(null); setMemberRole(""); await load(); }
    setSaving(false);
  }
  async function moveMember() {
    if (!selectedTeam || !memberToManage || !targetTeamId) return;
    const targetTeam = teams.find((team) => team.id === targetTeamId);
    if (!targetTeam || targetTeam.members.some((member) => member.employee_id === memberToManage.employee_id)) { setError("Este colaborador já está vinculado à equipe selecionada."); return; }
    setSaving(true); setError("");
    const { supabase, organizationId, error: contextError } = await getOrganizationContext();
    if (!organizationId) { setError(contextError); setSaving(false); return; }
    const { data: movedMember, error: moveError } = await supabase.from("contract_team_members").update({ team_id: targetTeamId }).eq("organization_id", organizationId).eq("team_id", selectedTeam.id).eq("employee_id", memberToManage.employee_id).eq("active", true).select("employee_id").maybeSingle();
    if (moveError) setError(friendlyError(moveError, "Não foi possível transferir o colaborador."));
    else if (!movedMember) setError("O vínculo não foi encontrado. Atualize a página e tente novamente.");
    else { setSuccess(`Colaborador transferido para ${targetTeam.name}.`); setMemberToManage(null); setMemberRole(""); setTargetTeamId(""); await load(); }
    setSaving(false);
  }
  async function removeMember() {
    if (!selectedTeam || !memberToManage) return;
    setSaving(true); setError("");
    const { supabase, organizationId, error: contextError } = await getOrganizationContext();
    if (!organizationId) { setError(contextError); setSaving(false); return; }
    const { data: removedMember, error: removeError } = await supabase.from("contract_team_members").delete().eq("organization_id", organizationId).eq("team_id", selectedTeam.id).eq("employee_id", memberToManage.employee_id).select("employee_id").maybeSingle();
    if (removeError) setError(friendlyError(removeError, "Não foi possível remover o colaborador da equipe."));
    else if (!removedMember) setError("O vínculo não foi encontrado. Atualize a página e tente novamente.");
    else { setSuccess("Colaborador removido da equipe. O cadastro do funcionário foi mantido."); setMemberToManage(null); setMemberRole(""); setTargetTeamId(""); setConfirmRemoveMember(false); await load(); }
    setSaving(false);
  }
  const selectedTeam = teams.find((team) => team.id === teamId);
  const destinationTeams = memberToManage ? teams.filter((team) => team.status === "active" && team.id !== teamId && !team.members.some((member) => member.employee_id === memberToManage.employee_id)) : [];
  function openTeamEditor(team: Team) { setEditingTeamId(team.id); setForm({ name: team.name, scenario_id: team.scenario_id, vehicle_identifier: team.vehicle_identifier ?? "", notes: team.notes ?? "" }); setShowForm(true); setError(""); }
  function openNewTeamForm() { setEditingTeamId(null); setForm(emptyForm); setShowForm(true); setError(""); }
  function closeTeamForm() { setShowForm(false); setEditingTeamId(null); setForm(emptyForm); setError(""); }
  function openMemberManager(member: TeamMember) { const employee = employees.find((candidate) => candidate.id === member.employee_id); setMemberToManage(member); setMemberRole(member.role || (employee ? employeeTeamRole(employee) : "")); setTargetTeamId(""); setConfirmRemoveMember(false); setError(""); }
  function closeMemberManager() { setMemberToManage(null); setMemberRole(""); setTargetTeamId(""); setConfirmRemoveMember(false); setError(""); }
  if (error && !showForm && !loading && !memberToManage) return <main className="module-shell teams-page"><header className="module-header"><div><p className="eyebrow">OPERAÇÃO CONTRATUAL</p><h1>Equipes</h1><p className="module-subtitle">Organize equipes, cenário contratual, veículo e composição real.</p></div></header><section className="panel runtime-error-card"><FeedbackMessage onRetry={retryLoad}>{error}</FeedbackMessage></section></main>;
  return (
    <main className="module-shell teams-page">
      <header className="module-header">
        <div><p className="eyebrow">OPERAÇÃO CONTRATUAL</p><h1>Equipes</h1><p className="module-subtitle">Organize equipes, cenário contratual, veículo e composição real.</p></div>
        <button className="primary-button" type="button" onClick={openNewTeamForm}><Plus size={17} /> Nova equipe</button>
      </header>
      {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}
      {error && !showForm && !memberToManage && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando equipes...</div> : (
        <section className="function-template-layout">
          <div className="panel template-selector">
            <div className="panel-header"><div><h2>Equipes cadastradas</h2><p>{teams.length} equipe(s)</p></div></div>
            <div className="template-options">
              {teams.map((team) => (
                <button
                  type="button"
                  key={team.id}
                  aria-expanded={team.id === selectedTeam?.id}
                  aria-controls={`team-detail-${team.id}`}
                  className={team.id === selectedTeam?.id ? "selected" : ""}
                  onClick={() => {
                    const nextTeamId = team.id === teamId ? "" : team.id;
                    setTeamId(nextTeamId); setEmployeeId(""); setRole(""); setShowAddMember(false); setError("");
                  }}
                >
                  <span><strong>{team.name}</strong><small>{team.scenario?.name ?? "Sem cenário"}</small></span>
                </button>
              ))}
            </div>
            {!teams.length && <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhuma equipe cadastrada</strong><span>Cadastre a primeira equipe contratual.</span></div>}
          </div>
          {selectedTeam && (
            <section id={`team-detail-${selectedTeam.id}`} className="panel template-detail">
              <div className="panel-header">
                <div><p className="eyebrow">COMPOSIÇÃO OPERACIONAL</p><h2>{selectedTeam.name}</h2><p>{selectedTeam.scenario?.name} · base de {selectedTeam.scenario?.team_size ?? "—"} integrantes · veículo {selectedTeam.vehicle_identifier || "não informado"}</p></div>
                <button type="button" className="secondary-button" onClick={() => openTeamEditor(selectedTeam)}><Pencil size={15} /> Editar equipe</button>
              </div>
              <div className="table-wrap">
                <table className="team-members-table">
                  <thead><tr><th>COLABORADOR</th><th>MATRÍCULA</th><th>FUNÇÃO NA EQUIPE</th><th>AÇÕES</th></tr></thead>
                  <tbody>
                    {selectedTeam.members.map((member) => (
                      <tr key={member.employee_id}>
                        <td><strong>{member.employee?.full_name}</strong></td>
                        <td>{member.employee?.registration || "—"}</td>
                        <td>{member.role || "Não informada"}</td>
                        <td><button type="button" className="secondary-button team-member-manage-button" aria-label={`Alterar vínculo de ${member.employee?.full_name ?? "colaborador"}`} onClick={() => openMemberManager(member)}>Alterar vínculo</button></td>
                      </tr>
                    ))}
                    {!selectedTeam.members.length && <tr><td colSpan={4} className="team-members-empty">Nenhum colaborador vinculado a esta equipe.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="team-member-actions">
                {showAddMember ? (
                  <form className="material-form team-member-form" onSubmit={addMember}>
                    <div className="form-grid two">
                      <label>Adicionar colaborador
                        <select value={employeeId} onChange={(event) => { const employee = employees.find((candidate) => candidate.id === event.target.value); setEmployeeId(event.target.value); setRole(employee ? employeeTeamRole(employee) : ""); }} required>
                          <option value="">Selecione</option>
                          {employees.filter((employee) => !selectedTeam.members.some((member) => member.employee_id === employee.id)).map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name} · {employee.registration || "Sem matrícula"}</option>)}
                        </select>
                      </label>
                      <label>Função na equipe<input value={role} readOnly placeholder={employeeId ? "Função não informada no cadastro" : "Preenchida pelo cadastro do colaborador"} /></label>
                    </div>
                    <div className="team-member-actions-buttons">
                      <button type="button" className="secondary-button" onClick={() => { setShowAddMember(false); setEmployeeId(""); setRole(""); }}>Cancelar</button>
                      <button className="secondary-button" disabled={saving}><Plus size={16} /> Vincular colaborador</button>
                    </div>
                  </form>
                ) : <button type="button" className="secondary-button" onClick={() => { setError(""); setShowAddMember(true); }}><Plus size={16} /> Adicionar colaborador</button>}
              </div>
            </section>
          )}
        </section>
      )}
      {memberToManage && selectedTeam && (
        <div className="modal-backdrop">
          <section className="modal-card member-management-modal" role="dialog" aria-modal="true" aria-label="Alterar vínculo do colaborador">
            <div className="modal-header">
              <div><p className="eyebrow">{selectedTeam.name}</p><h2>Alterar vínculo</h2></div>
              <button className="close-modal" type="button" onClick={closeMemberManager} aria-label="Fechar"><X size={19} /></button>
            </div>
            <div className="member-management-summary">
              <strong>{memberToManage.employee?.full_name}</strong>
              <span>Matrícula: {memberToManage.employee?.registration || "Não informada"}</span>
              <span>Função no cadastro: {employeeTeamRole(employees.find((employee) => employee.id === memberToManage.employee_id) ?? { id: memberToManage.employee_id, full_name: "", registration: null }) || "Não informada"}</span>
            </div>
            <label className="member-destination-field">Função na equipe
              <input value={memberRole} onChange={(event) => setMemberRole(event.target.value)} placeholder="Informe a função nesta equipe" />
            </label>
            <button type="button" className="secondary-button member-save-role" onClick={saveMemberRole} disabled={saving}><Check size={16} /> {saving ? "Salvando..." : "Salvar função na equipe"}</button>
            <label className="member-destination-field">Mover para outra equipe
              <select value={targetTeamId} onChange={(event) => setTargetTeamId(event.target.value)} disabled={!destinationTeams.length}>
                <option value="">{destinationTeams.length ? "Selecione a equipe de destino" : "Não há outra equipe disponível"}</option>
                {destinationTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <div className="member-management-actions">
              <button type="button" className="primary-button" onClick={moveMember} disabled={saving || !targetTeamId}><ArrowRightLeft size={16} /> {saving ? "Salvando..." : "Mover para equipe"}</button>
              {!confirmRemoveMember ? (
                <button type="button" className="danger-outline-button" onClick={() => { setError(""); setConfirmRemoveMember(true); }} disabled={saving}><Trash2 size={16} /> Remover desta equipe</button>
              ) : (
                <div className="member-remove-confirmation">
                  <p>Isso remove o vínculo deste colaborador com a equipe. O cadastro do funcionário e os demais dados dele serão mantidos.</p>
                  {error && <p className="login-error">{error}</p>}
                  <div className="team-member-actions-buttons">
                    <button type="button" className="secondary-button" onClick={() => { setConfirmRemoveMember(false); setError(""); }} disabled={saving}>Manter na equipe</button>
                    <button type="button" className="danger-button" onClick={removeMember} disabled={saving}><Trash2 size={16} /> {saving ? "Removendo..." : "Confirmar remoção"}</button>
                  </div>
                </div>
              )}
              {error && !confirmRemoveMember && <p className="login-error">{error}</p>}
            </div>
          </section>
        </div>
      )}
      {showForm && (
        <div className="modal-backdrop">
          <section className="modal-card team-editor-modal" role="dialog" aria-modal="true" aria-label={editingTeamId ? "Editar equipe" : "Cadastro de equipe"}>
            <div className="modal-header">
              <div><p className="eyebrow">{editingTeamId ? "DADOS DA EQUIPE" : "NOVA EQUIPE"}</p><h2>{editingTeamId ? "Editar equipe" : "Cadastrar equipe contratual"}</h2></div>
              <button className="close-modal" type="button" onClick={closeTeamForm} aria-label="Fechar"><X size={19} /></button>
            </div>
            <form className="material-form" onSubmit={saveTeam}>
              <div className="form-grid two">
                <label>Nome da equipe<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Equipe LM 01" required /></label>
                <label>Cenário contratual<select value={form.scenario_id} onChange={(event) => setForm({ ...form, scenario_id: event.target.value })} required><option value="">Selecione</option>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>
              </div>
              <div className="form-grid two">
                <label>Veículo / ativo<input value={form.vehicle_identifier} onChange={(event) => setForm({ ...form, vehicle_identifier: event.target.value })} placeholder="Placa, patrimônio ou guindauto" /></label>
                <label>Observações<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
              </div>
              {error && <p className="login-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={closeTeamForm}>Cancelar</button>
                <button className="primary-button" disabled={saving}>{saving ? "Salvando..." : editingTeamId ? "Salvar alterações" : "Cadastrar equipe"}<Check size={16} /></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
