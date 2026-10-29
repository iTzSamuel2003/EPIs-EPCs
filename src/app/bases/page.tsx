"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, MapPin, Plus, Search, Users } from "lucide-react";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";

type Base = { id: string; name: string; address: string | null; is_active: boolean };
type Employee = { id: string; registration: string | null; full_name: string; department: string | null; unit: string | null; base_id: string | null; status: string };
type Profile = { id: string; full_name: string; role: string };
type BaseAccess = { profile_id: string; base_id: string };

const employeeStatus: Record<string, string> = { active: "Ativo", away: "Afastado", terminated: "Desligado" };

export default function BasesPage() {
  const [bases, setBases] = useState<Base[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [baseAccess, setBaseAccess] = useState<BaseAccess[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [baseName, setBaseName] = useState("");
  const [baseAddress, setBaseAddress] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeBase, setEmployeeBase] = useState("all");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [bulkBaseId, setBulkBaseId] = useState("unselected");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedProfileBases, setSelectedProfileBases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBase, setSavingBase] = useState(false);
  const [savingEmployees, setSavingEmployees] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
      const { data: ownProfile, error: ownProfileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
      if (ownProfileError) throw ownProfileError;
      if (!ownProfile?.organization_id) throw new Error("Não foi possível identificar a organização.");
      const [{ data: baseRows, error: baseError }, { data: employeeRows, error: employeeError }, { data: profileRows, error: profileError }, { data: accessRows, error: accessError }] = await Promise.all([
        supabase.from("organization_bases").select("id,name,address,is_active").order("name"),
        supabase.from("employees").select("id,registration,full_name,department,unit,base_id,status").order("full_name"),
        supabase.from("profiles").select("id,full_name,role").eq("organization_id", ownProfile.organization_id).order("full_name"),
        supabase.from("profile_base_access").select("profile_id,base_id"),
      ]);
      if (baseError || employeeError || profileError || accessError) throw baseError ?? employeeError ?? profileError ?? accessError;
      setOrganizationId(ownProfile.organization_id);
      setBases((baseRows ?? []) as Base[]);
      setEmployees((employeeRows ?? []) as Employee[]);
      setProfiles((profileRows ?? []) as Profile[]);
      setBaseAccess((accessRows ?? []) as BaseAccess[]);
      setBulkBaseId((current) => current || "unselected");
      setSelectedProfileId((current) => current || profileRows?.find((profile) => profile.role === "tst")?.id || "");
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível carregar as bases e atribuições."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const profile = profiles.find((item) => item.id === selectedProfileId);
    setSelectedProfileBases(profile?.role === "tst"
      ? baseAccess.filter((access) => access.profile_id === profile.id).map((access) => access.base_id)
      : []);
  }, [baseAccess, profiles, selectedProfileId]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);

  const filteredEmployees = useMemo(() => {
    const term = employeeQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return employees.filter((employee) => {
      const matchesTerm = !term || `${employee.full_name} ${employee.registration ?? ""} ${employee.department ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(term);
      const matchesBase = employeeBase === "all" || (employeeBase === "unassigned" ? !employee.base_id : employee.base_id === employeeBase);
      return matchesTerm && matchesBase;
    });
  }, [employeeBase, employeeQuery, employees]);

  async function createBase(event: FormEvent) {
    event.preventDefault();
    if (!baseName.trim() || !organizationId || savingBase) return;
    setSavingBase(true); setError(""); setSuccess("");
    try {
      const { error: saveError } = await createClient().from("organization_bases").insert({ organization_id: organizationId, name: baseName.trim(), address: baseAddress.trim() || null });
      if (saveError) throw saveError;
      setBaseName(""); setBaseAddress(""); setSuccess("Base cadastrada."); await load();
    } catch (caught) { setError(friendlyError(caught, "Não foi possível cadastrar a base.")); }
    finally { setSavingBase(false); }
  }

  async function toggleBase(base: Base) {
    setError(""); setSuccess("");
    try {
      const { error: updateError } = await createClient().from("organization_bases").update({ is_active: !base.is_active }).eq("id", base.id);
      if (updateError) throw updateError;
      setSuccess(base.is_active ? "Base desativada." : "Base reativada."); await load();
    } catch (caught) { setError(friendlyError(caught, "Não foi possível alterar a situação da base.")); }
  }

  function toggleEmployee(employeeId: string) {
    setSelectedEmployees((current) => current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId]);
  }

  function toggleVisibleEmployees() {
    const visibleIds = filteredEmployees.map((employee) => employee.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedEmployees.includes(id));
    setSelectedEmployees((current) => allSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  }

  async function assignEmployees() {
    if (!selectedEmployees.length || bulkBaseId === "unselected" || savingEmployees) return;
    setSavingEmployees(true); setError(""); setSuccess("");
    try {
      const { error: assignError } = await createClient().rpc("assign_employees_base", { p_employee_ids: selectedEmployees, p_base_id: bulkBaseId || null });
      if (assignError) throw assignError;
      setSuccess(`${selectedEmployees.length} colaborador(es) atualizado(s).`); setSelectedEmployees([]); await load();
    } catch (caught) { setError(friendlyError(caught, "Não foi possível atualizar as bases dos colaboradores.")); }
    finally { setSavingEmployees(false); }
  }

  function toggleProfileBase(baseId: string) {
    setSelectedProfileBases((current) => current.includes(baseId) ? current.filter((id) => id !== baseId) : [...current, baseId]);
  }

  async function saveProfileAccess() {
    if (!selectedProfileId || savingProfile) return;
    setSavingProfile(true); setError(""); setSuccess("");
    try {
      const { error: saveError } = await createClient().rpc("set_profile_base_access", { p_profile_id: selectedProfileId, p_base_ids: selectedProfileBases });
      if (saveError) throw saveError;
      setSuccess("Acesso às bases atualizado."); await load();
    } catch (caught) { setError(friendlyError(caught, "Não foi possível atualizar o acesso do usuário.")); }
    finally { setSavingProfile(false); }
  }

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">ORGANIZAÇÃO E OPERAÇÃO</p><h1>Bases</h1><p className="module-subtitle">Separe funcionários e saldos por localidade e controle quem opera cada base.</p></div></header>
    {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}{error && <FeedbackMessage onRetry={() => void load()}>{error}</FeedbackMessage>}
    {loading ? <section className="panel module-loading"><LoaderCircle className="spin" size={22} /> Carregando bases…</section> : <>
      <section className="panel module-table-card">
        <div className="panel-header"><div><h2>Bases operacionais</h2><p>Os saldos em trânsito não ficam disponíveis no destino até a confirmação do recebimento.</p></div></div>
        <div className="module-summary">
          {bases.map((base) => <div key={base.id} className="base-summary-card"><div className="base-summary-heading"><MapPin size={18} /><strong>{base.name}</strong><span className={`status-pill ${base.is_active ? "success" : "danger"}`}>{base.is_active ? "Ativa" : "Inativa"}</span></div><span>{base.address || "Endereço não informado"}</span><button className="secondary-button" type="button" onClick={() => void toggleBase(base)}>{base.is_active ? "Desativar" : "Reativar"}</button></div>)}
        </div>
        <form className="material-form base-create-form" onSubmit={createBase}><div className="form-grid two"><label>Nome da nova base<input value={baseName} onChange={(event) => setBaseName(event.target.value)} placeholder="Ex.: Três Lagoas" required /></label><label>Endereço (opcional)<input value={baseAddress} onChange={(event) => setBaseAddress(event.target.value)} placeholder="Rua, cidade ou referência" /></label></div><div className="modal-actions"><button className="primary-button" disabled={savingBase}>{savingBase ? "Salvando…" : "Adicionar base"}<Plus size={16} /></button></div></form>
      </section>

      <section className="panel module-table-card">
        <div className="panel-header"><div><h2>Atribuir funcionários</h2><p>{employees.filter((employee) => !employee.base_id).length} funcionário(s) ainda sem base. Selecione vários para atribuir de uma vez.</p></div></div>
        <div className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar funcionário para atribuir base" value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Buscar por nome, matrícula ou setor" /></div><select aria-label="Filtrar funcionários por base" value={employeeBase} onChange={(event) => setEmployeeBase(event.target.value)}><option value="all">Todas as bases</option><option value="unassigned">Sem base</option>{bases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></div>
        <div className="base-bulk-toolbar"><label className="base-check-label"><input type="checkbox" checked={filteredEmployees.length > 0 && filteredEmployees.every((employee) => selectedEmployees.includes(employee.id))} onChange={toggleVisibleEmployees} /> Selecionar resultados visíveis ({filteredEmployees.length})</label><select aria-label="Base para os funcionários selecionados" value={bulkBaseId} onChange={(event) => setBulkBaseId(event.target.value)}><option value="unselected">Selecione uma base</option><option value="">Remover associação à base</option>{bases.filter((base) => base.is_active).map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select><button className="primary-button" type="button" disabled={!selectedEmployees.length || bulkBaseId === "unselected" || savingEmployees} onClick={() => void assignEmployees()}>{savingEmployees ? "Atualizando…" : `Aplicar a ${selectedEmployees.length || 0}`}<Check size={16} /></button></div>
        <div className="table-wrap"><table><thead><tr><th></th><th>COLABORADOR</th><th>MATRÍCULA</th><th>SETOR</th><th>BASE ATUAL</th><th>STATUS</th></tr></thead><tbody>{filteredEmployees.map((employee) => <tr key={employee.id}><td><input type="checkbox" aria-label={`Selecionar ${employee.full_name}`} checked={selectedEmployees.includes(employee.id)} onChange={() => toggleEmployee(employee.id)} /></td><td><strong>{employee.full_name}</strong></td><td>{employee.registration || "—"}</td><td>{employee.department || "—"}</td><td>{bases.find((base) => base.id === employee.base_id)?.name || "Sem base"}</td><td>{employeeStatus[employee.status] ?? employee.status}</td></tr>)}</tbody></table>{!filteredEmployees.length && <div className="empty-state"><Users size={25} /><strong>Nenhum funcionário encontrado</strong></div>}</div>
      </section>

      <section className="panel module-table-card">
        <div className="panel-header"><div><h2>Acesso dos usuários TST</h2><p>Administração e RH veem todas as bases. Vincule cada TST às bases em que pode operar.</p></div></div>
        <div className="form-grid two base-access-editor"><label>Usuário<select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}><option value="">Selecione um usuário</option>{profiles.filter((profile) => profile.role === "tst").map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label><div className="base-access-options"><span>Bases autorizadas</span>{bases.filter((base) => base.is_active).map((base) => <label className="base-check-label" key={base.id}><input type="checkbox" checked={selectedProfileBases.includes(base.id)} onChange={() => toggleProfileBase(base.id)} disabled={selectedProfile?.role !== "tst"} />{base.name}</label>)}<button className="primary-button" type="button" disabled={!selectedProfileId || selectedProfile?.role !== "tst" || savingProfile} onClick={() => void saveProfileAccess()}>{savingProfile ? "Salvando…" : "Salvar acessos"}<Check size={16} /></button></div></div>
        {!profiles.some((profile) => profile.role === "tst") && <p className="empty-state">Não há usuários TST da organização para vincular a uma base.</p>}
      </section>
    </>}
  </main>;
}
