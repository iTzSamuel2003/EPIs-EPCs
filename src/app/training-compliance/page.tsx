"use client";

import Link from "next/link";
import { BookOpenCheck, CheckCircle2, ClipboardList, LoaderCircle, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Requirement = { id: string; function_group: string; course_name: string; source_annex: string; mandatory: boolean; validity_months: number | null; notes: string | null };
type ComplianceCount = { requirement_id: string; applicable_count: number; approved_count: number; active_employee_count: number };

export default function TrainingCompliancePage() {
  const [requirements, setRequirements] = useState<Requirement[]>([]); const [counts, setCounts] = useState<ComplianceCount[]>([]); const [functionFilter, setFunctionFilter] = useState("all"); const [courseFilter, setCourseFilter] = useState("all"); const [statusFilter, setStatusFilter] = useState("all"); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retryKey, setRetryKey] = useState(0); const loadVersion = useRef(0); const mountedRef = useRef(true);
  async function load() {
    const version = ++loadVersion.current;
    if (mountedRef.current) {
      setLoading(true);
      setError("");
      setRequirements([]);
      setCounts([]);
    }
    try {
      const supabase = createClient();
      const [{ data: requirementData, error: requirementError }, { data: countData, error: countError }] = await Promise.all([
        supabase.from("contract_training_requirements").select("id, function_group, course_name, source_annex, mandatory, validity_months, notes").order("function_group").order("course_name"),
        supabase.rpc("get_training_compliance_counts"),
      ]);
      if (!mountedRef.current || version !== loadVersion.current) return;
      const loadError = requirementError ?? countError;
      if (loadError) { setError(friendlyError(loadError, "Não foi possível carregar a matriz de treinamentos.")); return; }
      setRequirements((requirementData ?? []) as Requirement[]);
      setCounts((countData ?? []) as ComplianceCount[]);
    } catch (caught) {
      if (mountedRef.current && version === loadVersion.current) setError(friendlyError(caught, "Não foi possível carregar a matriz de treinamentos."));
    } finally {
      if (mountedRef.current && version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => { mountedRef.current = true; void load(); return () => { mountedRef.current = false; loadVersion.current += 1; }; }, [retryKey]);
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
