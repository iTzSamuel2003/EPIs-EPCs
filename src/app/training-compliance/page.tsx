"use client";

import Link from "next/link";
import { BookOpenCheck, Check, CheckCircle2, ClipboardList, LoaderCircle, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentOrganizationProfile } from "@/lib/organization-context";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Requirement = { id: string; function_group: string; course_name: string; source_annex: string; mandatory: boolean; validity_months: number | null; notes: string | null };
type ComplianceCount = { requirement_id: string; applicable_count: number; approved_count: number; active_employee_count: number };
type AnnexSetting = { annex_number: string; active: boolean };

function annexNumber(value: string | null | undefined) { return value?.match(/\d{1,2}/)?.[0].padStart(2, "0") ?? null; }
function isAnnexEnabled(sourceAnnex: string | null | undefined, enabledAnnexes: Set<string>) { const number = annexNumber(sourceAnnex); return !number || enabledAnnexes.has(number); }

export default function TrainingCompliancePage() {
  const [requirements, setRequirements] = useState<Requirement[]>([]); const [counts, setCounts] = useState<ComplianceCount[]>([]); const [functionFilter, setFunctionFilter] = useState("all"); const [courseFilter, setCourseFilter] = useState("all"); const [statusFilter, setStatusFilter] = useState("all"); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [annexActive, setAnnexActive] = useState(true); const [annexSettingsLoaded, setAnnexSettingsLoaded] = useState(false); const [savingAnnex, setSavingAnnex] = useState(false); const [retryKey, setRetryKey] = useState(0); const loadVersion = useRef(0); const mountedRef = useRef(true);
  async function load() {
    const version = ++loadVersion.current;
    if (mountedRef.current) {
      setLoading(true);
      setError("");
      setAnnexSettingsLoaded(false);
      setRequirements([]);
      setCounts([]);
    }
    try {
      const supabase = createClient();
      const [{ data: requirementData, error: requirementError }, { data: countData, error: countError }, { data: annexSettings, error: annexSettingsError }] = await Promise.all([
        supabase.from("contract_training_requirements").select("id, function_group, course_name, source_annex, mandatory, validity_months, notes").order("function_group").order("course_name"),
        supabase.rpc("get_training_compliance_counts"),
        supabase.from("organization_annex_settings").select("annex_number,active"),
      ]);
      if (!mountedRef.current || version !== loadVersion.current) return;
      const loadError = requirementError ?? countError ?? annexSettingsError;
      if (loadError) { setError(friendlyError(loadError, "Não foi possível carregar a matriz de treinamentos.")); return; }
      const settings = (annexSettings ?? []) as AnnexSetting[];
      const trainingAnnex = settings.find((setting) => annexNumber(setting.annex_number) === "03");
      const trainingAnnexActive = trainingAnnex?.active ?? true;
      setAnnexActive(trainingAnnexActive);
      setAnnexSettingsLoaded(true);
      const enabledAnnexes = new Set(settings.filter((setting) => setting.active).map((setting) => annexNumber(setting.annex_number) ?? ""));
      if (trainingAnnexActive) enabledAnnexes.add("03");
      const visibleRequirements = ((requirementData ?? []) as Requirement[]).filter((requirement) => isAnnexEnabled(requirement.source_annex, enabledAnnexes));
      const visibleRequirementIds = new Set(visibleRequirements.map((requirement) => requirement.id));
      setRequirements(visibleRequirements);
      setCounts(((countData ?? []) as ComplianceCount[]).filter((count) => visibleRequirementIds.has(count.requirement_id)));
    } catch (caught) {
      if (mountedRef.current && version === loadVersion.current) setError(friendlyError(caught, "Não foi possível carregar a matriz de treinamentos."));
    } finally {
      if (mountedRef.current && version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => { mountedRef.current = true; void load(); return () => { mountedRef.current = false; loadVersion.current += 1; }; }, [retryKey]);
  async function updateTrainingAnnex(active: boolean) {
    if (savingAnnex || !annexSettingsLoaded) return;
    setSavingAnnex(true);
    setError("");
    setSuccess("");
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error("Sessão expirada. Entre novamente.");
      const { data: profile, error: profileError } = await getCurrentOrganizationProfile(supabase, user.id, user.user_metadata?.full_name);
      if (profileError || !profile?.organization_id) throw profileError ?? new Error("Usuário sem organização vinculada.");
      const { error: saveError } = await supabase.from("organization_annex_settings").upsert({ organization_id: profile.organization_id, annex_number: "03", active, updated_at: new Date().toISOString() }, { onConflict: "organization_id,annex_number" });
      if (saveError) throw saveError;
      setAnnexActive(active);
      setSuccess(`Anexo 03 — Treinamentos obrigatórios ${active ? "ativado" : "desativado"}.`);
      await load();
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível atualizar o Anexo 03."));
    } finally {
      setSavingAnnex(false);
    }
  }
  const functionOptions = useMemo(() => [...new Set(requirements.map((item) => item.function_group))].sort(), [requirements]);
  const courseOptions = useMemo(() => [...new Set(requirements.map((item) => item.course_name))].sort(), [requirements]);
  const rows = useMemo(() => {
    const countByRequirement = new Map(counts.map((item) => [item.requirement_id, item]));
    return requirements.map((requirement) => {
      const count = countByRequirement.get(requirement.id);
      const applicable = Number(count?.applicable_count ?? 0);
      const completed = Number(count?.approved_count ?? 0);
      return { requirement, applicable, completed, pending: Math.max(applicable - completed, 0) };
    }).filter((row) => (functionFilter === "all" || row.requirement.function_group === functionFilter) && (courseFilter === "all" || row.requirement.course_name === courseFilter) && (statusFilter === "all" || (statusFilter === "pending" ? row.pending > 0 : row.applicable > 0 && row.pending === 0)));
  }, [requirements, counts, functionFilter, courseFilter, statusFilter]);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0); const covered = rows.reduce((sum, row) => sum + row.completed, 0);
  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CONFORMIDADE CONTRATUAL</p><h1>Treinamentos obrigatórios</h1><p className="module-subtitle">Acompanhe pendências por função, curso e situação.</p></div><Link className="secondary-button" href="/employees"><ClipboardList size={16} /> Funcionários</Link></header>
    {success && <div className="feedback success-feedback" role="status"><Check size={17} /> {success}</div>}
    <section className="panel annex-settings-panel" aria-labelledby="training-annex-settings-title"><div className="panel-header"><div><h2 id="training-annex-settings-title">Anexo contratual de treinamentos</h2><p>O Anexo 03 trata de cursos e certificados dos colaboradores, não de materiais de estoque.</p></div><span className="annex-settings-count">1 anexo</span></div>{annexSettingsLoaded ? <div className="annex-settings-grid"><label className={`annex-setting-card ${annexActive ? "is-active" : "is-inactive"}`}><input type="checkbox" checked={annexActive} disabled={savingAnnex} onChange={(event) => void updateTrainingAnnex(event.target.checked)} aria-label={`${annexActive ? "Desativar" : "Ativar"} Anexo 03 — Treinamentos obrigatórios`} /><span className="annex-setting-copy"><strong>Anexo 03 — Treinamentos obrigatórios</strong><small>Cursos e certificados dos colaboradores</small></span><span className={`status-pill ${annexActive ? "success" : "danger"}`}>{savingAnnex ? "Salvando..." : annexActive ? "Ativo" : "Desativado"}</span></label></div> : <p className="annex-settings-loading">Carregando situação do anexo...</p>}</section>
    {error && <FeedbackMessage onRetry={() => setRetryKey((current) => current + 1)}>{error}</FeedbackMessage>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando matriz...</div> : <>
      <section className="module-summary">
        <div><BookOpenCheck size={18} /><strong>{requirements.length}</strong><span>requisitos cadastrados</span></div>
        <div><CheckCircle2 size={18} /><strong>{covered}</strong><span>coberturas identificadas</span></div>
        <div><ShieldAlert size={18} /><strong>{pending}</strong><span>pendências filtradas</span></div>
        <div><ClipboardList size={18} /><strong>{Number(counts[0]?.active_employee_count ?? 0)}</strong><span>colaboradores ativos</span></div>
      </section>
      <section className="module-toolbar training-filters"><SlidersHorizontal size={17} /><select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value)} aria-label="Filtrar por função"><option value="all">Todas as funções</option>{functionOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} aria-label="Filtrar por curso"><option value="all">Todos os cursos</option>{courseOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por situação"><option value="all">Todas as situações</option><option value="pending">Com pendências</option><option value="complete">Concluídos</option></select></section>
      <section className="panel module-table-card"><div className="panel-header"><div><h2>Matriz de treinamentos</h2><p>Os cursos só contam como cobertura após aprovação do RH.</p></div></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>GRUPO / FUNÇÃO</th><th>CURSO</th><th>VALIDADE</th><th>APLICÁVEL</th><th>COBERTOS</th><th>PENDÊNCIAS</th><th>AÇÃO</th></tr></thead><tbody>{rows.map((row) => <tr key={row.requirement.id}><td><strong>{row.requirement.function_group}</strong><small>{row.requirement.source_annex}</small></td><td><strong>{row.requirement.course_name}</strong><small>{row.requirement.notes || "Curso obrigatório"}</small></td><td>{row.requirement.validity_months ? `${row.requirement.validity_months} meses` : "Conforme curso"}</td><td>{row.applicable}</td><td><span className="status-pill success">{row.completed}</span></td><td><span className={`status-pill ${row.pending ? "danger" : "success"}`}>{row.pending || "OK"}</span></td><td>{row.pending > 0 ? <Link className="text-link" href="/employees">Ver colaboradores <ClipboardList size={14} /></Link> : "Regularizado"}</td></tr>)}</tbody></table></div> : <div className="empty-state"><BookOpenCheck size={27} /><strong>Nenhum requisito encontrado</strong><span>Ajuste os filtros ou cadastre os requisitos contratuais.</span></div>}</section>
    </>}
  </main>;
}
