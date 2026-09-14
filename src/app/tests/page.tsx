"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Check, ClipboardCheck, LoaderCircle, Plus, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Material = { id: string; name: string; internal_code: string; type: "EPI" | "EPC" | "FERRAMENTAL"; unit: string; test_required: boolean };
type MaterialTest = { id: string; performed_at: string; interval_months: number; next_due_at: string; result: "approved" | "approved_with_restrictions" | "failed" | "pending"; examiner: string | null; professional_registration: string | null; art_number: string | null; certificate_number: string | null; report_reference: string | null; report_url: string | null; material: Material | null };
type TestOverview = { material: Material; latestTest: MaterialTest | null };

const results = [["approved", "Aprovado"], ["approved_with_restrictions", "Aprovado com restrições"], ["failed", "Reprovado"], ["pending", "Pendente"]];

function daysUntil(value: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(`${value}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "Não informado";
}

export default function TestsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tests, setTests] = useState<MaterialTest[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [materialSuggestionsOpen, setMaterialSuggestionsOpen] = useState(false);
  const [performedAt, setPerformedAt] = useState(new Date().toISOString().slice(0, 10));
  const [interval, setInterval] = useState("6");
  const [result, setResult] = useState("approved");
  const [examiner, setExaminer] = useState("");
  const [registration, setRegistration] = useState("");
  const [artNumber, setArtNumber] = useState("");
  const [certificate, setCertificate] = useState("");
  const [reportReference, setReportReference] = useState("");
  const [reportUrl, setReportUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    const supabase = createClient();
    const [{ data: materialData, error: materialError }, { data: testData, error: testError }] = await Promise.all([
      supabase.from("materials").select("id, name, internal_code, type, unit, test_required").eq("status", "active").order("name"),
      supabase.from("material_tests").select("id, performed_at, interval_months, next_due_at, result, examiner, professional_registration, art_number, certificate_number, report_reference, report_url, material:materials(id, name, internal_code, type, unit, test_required)").order("performed_at", { ascending: false }),
    ]);

    if (materialError || testError) setError((materialError ?? testError)?.message ?? "Não foi possível carregar os ensaios.");
    else {
      setMaterials((materialData ?? []) as Material[]);
      setTests((testData ?? []) as unknown as MaterialTest[]);
    }
    setLoading(false);
  }

  useEffect(() => { void Promise.resolve().then(() => loadData()); }, []);

  const latestTestsByMaterial = useMemo(() => {
    const latest = new Map<string, MaterialTest>();
    tests.forEach((test) => {
      if (test.material?.id && !latest.has(test.material.id)) latest.set(test.material.id, test);
    });
    return latest;
  }, [tests]);

  const overviews = useMemo<TestOverview[]>(() => materials.filter((material) => material.test_required).map((material) => ({
    material,
    latestTest: latestTestsByMaterial.get(material.id) ?? null,
  })), [materials, latestTestsByMaterial]);

  function getOverviewState(overview: TestOverview) {
    const test = overview.latestTest;
    const days = daysUntil(test?.next_due_at ?? null);
    if (!test) return { label: "Pendente de ensaio", className: "warning", detail: "Registre o primeiro ensaio" };
    if (!test.next_due_at) return { label: "Validade pendente", className: "warning", detail: "Informe a data do próximo ensaio" };
    if (test.result === "failed") return { label: "Reprovado", className: "danger", detail: "Novo ensaio necessário" };
    if (days !== null && days < 0) return { label: "Vencido", className: "danger", detail: `Vencido há ${Math.abs(days)} dia(s)` };
    if (days !== null && days <= 30) return { label: "Próximo do vencimento", className: "warning", detail: `Em ${days} dia(s)` };
    return { label: "Em dia", className: "success", detail: `Em ${days} dia(s)` };
  }

  const filtered = useMemo(() => overviews.filter((overview) => {
    const test = overview.latestTest;
    const state = getOverviewState(overview);
    const days = daysUntil(test?.next_due_at ?? null);
    const text = `${overview.material.name} ${overview.material.internal_code} ${test?.certificate_number ?? ""} ${test?.art_number ?? ""}`.toLowerCase();
    const matchesQuery = text.includes(query.toLowerCase());
    const matchesFilter = filter === "all"
      || (filter === "pending" && !test)
      || (filter === "overdue" && state.label === "Vencido")
      || (filter === "urgent" && days !== null && days >= 0 && days <= 30)
      || (filter === "approved" && (test?.result === "approved" || test?.result === "approved_with_restrictions"));
    return matchesQuery && matchesFilter;
  }), [overviews, query, filter]);

  const counts = useMemo(() => ({
    total: overviews.length,
    pending: overviews.filter((overview) => !overview.latestTest).length,
    overdue: overviews.filter((overview) => getOverviewState(overview).label === "Vencido").length,
    urgent: overviews.filter((overview) => { const days = daysUntil(overview.latestTest?.next_due_at ?? null); return days !== null && days >= 0 && days <= 30; }).length,
  }), [overviews]);

  const materialOptions = useMemo(() => materials.filter((material) => material.test_required && material.name.toLowerCase().includes(materialQuery.toLowerCase())), [materials, materialQuery]);

  function resetForm() {
    setMaterialId(""); setMaterialQuery(""); setMaterialSuggestionsOpen(false); setExaminer(""); setRegistration(""); setArtNumber(""); setCertificate(""); setReportReference(""); setReportUrl(""); setNotes("");
  }

  async function saveTest(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    if (reportUrl && !isHttpUrl(reportUrl)) { setError("O link do laudo deve começar com http:// ou https://."); return; }
    setSaving(true);
    const supabase = createClient();
    const { data: testId, error: saveError } = await supabase.rpc("register_material_test", { p_material_id: materialId, p_performed_at: performedAt, p_interval_months: Number(interval), p_result: result, p_examiner: examiner || null, p_certificate_number: certificate || null, p_notes: notes || null });
    if (saveError || !testId) setError(saveError?.message ?? "Não foi possível registrar o ensaio.");
    else {
      const { error: detailsError } = await supabase.from("material_tests").update({ professional_registration: registration || null, art_number: artNumber || null, report_reference: reportReference || null, report_url: reportUrl || null }).eq("id", testId);
      if (detailsError) setError(detailsError.message);
      else { setSuccess("Ensaio, responsável técnico, ART e laudo registrados com sucesso."); setShowForm(false); resetForm(); await loadData(); }
    }
    setSaving(false);
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CONTROLE TÉCNICO</p><h1>Ensaios</h1><p className="module-subtitle">Acompanhe os materiais que exigem ensaio, suas validades e próximos vencimentos.</p></div><button type="button" className="primary-button" onClick={() => { setShowForm(true); setError(""); setSuccess(""); }}><Plus size={17} /> Registrar ensaio</button></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && !showForm && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar material, certificado ou ART" /></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos os materiais</option><option value="pending">Pendentes de ensaio</option><option value="overdue">Vencidos</option><option value="urgent">Até 30 dias</option><option value="approved">Aprovados</option></select></section>
    <section className="module-summary"><div><strong>{counts.total}</strong><span>materiais ensaiáveis</span></div><div><strong>{counts.pending}</strong><span>pendentes de ensaio</span></div><div><strong>{counts.overdue}</strong><span>vencidos</span></div><div><strong>{counts.urgent}</strong><span>até 30 dias</span></div></section>
    <section className="panel module-table-card"><div className="panel-header"><div><h2>Materiais que exigem ensaio</h2><p>{filtered.length} material(is) listado(s)</p></div></div>
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando ensaios...</div> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>MATERIAL</th><th>STATUS</th><th>ÚLTIMO ENSAIO</th><th>PRÓXIMO ENSAIO</th><th>RESULTADO</th><th>LAUDO / ART</th></tr></thead><tbody>{filtered.map((overview) => { const test = overview.latestTest; const state = getOverviewState(overview); const resultLabel = test ? results.find(([value]) => value === test.result)?.[1] ?? test.result : "Ainda não realizado"; return <tr key={overview.material.id}><td><div className="material-cell"><div className="material-type-icon epi"><ClipboardCheck size={17} /></div><div><strong>{overview.material.name}</strong><small>Ensaio obrigatório · {overview.material.type}</small></div></div></td><td><span className={`status-pill ${state.className}`}>{state.label}</span><small className="muted-cell">{state.detail}</small></td><td>{test ? formatDate(test.performed_at) : "Ainda não realizado"}</td><td><strong>{formatDate(test?.next_due_at ?? null)}</strong>{test?.next_due_at && <small className="muted-cell">{state.detail}</small>}</td><td><span className={`status-pill ${test?.result === "failed" ? "danger" : test ? "success" : "warning"}`}>{resultLabel}</span></td><td><strong>{test?.art_number || "ART pendente"}</strong><small>{test?.report_url ? <a href={test.report_url} target="_blank" rel="noreferrer">Abrir laudo</a> : test?.report_reference || "Laudo pendente"}</small></td></tr>; })}</tbody></table></div> : <div className="empty-state"><CalendarCheck size={27} /><strong>Nenhum material ensaiável encontrado</strong><span>Cadastre materiais com ensaio obrigatório ou ajuste os filtros.</span></div>}
    </section>
    {showForm && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-label="Cadastro de ensaio"><div className="modal-header"><div><p className="eyebrow">NOVO REGISTRO</p><h2>Registrar ensaio</h2></div><button className="close-modal" type="button" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveTest}><div className="form-grid two"><label className="material-picker">Material<div className="material-picker-control"><input value={materialQuery} onChange={(event) => { setMaterialQuery(event.target.value); setMaterialId(""); setMaterialSuggestionsOpen(true); }} onFocus={() => { if (!materialId) setMaterialSuggestionsOpen(true); }} placeholder="Digite o nome do material" required disabled={loading} autoComplete="off" />{materialSuggestionsOpen && materialQuery && <div className="employee-suggestions">{materialOptions.map((material) => <button type="button" key={material.id} onMouseDown={() => { setMaterialId(material.id); setMaterialQuery(material.name); setMaterialSuggestionsOpen(false); }}><strong>{material.name}</strong></button>)}{!materialOptions.length && <span>Nenhum material ensaiável encontrado.</span>}</div>}</div></label><label>Data do ensaio<input type="date" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required /></label></div><div className="form-grid three"><label>Periodicidade<select value={interval} onChange={(event) => setInterval(event.target.value)}><option value="6">A cada 6 meses</option><option value="12">A cada 12 meses</option></select></label><label>Resultado<select value={result} onChange={(event) => setResult(event.target.value)}>{results.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Responsável técnico<input value={examiner} onChange={(event) => setExaminer(event.target.value)} placeholder="Nome ou empresa" required /></label></div><div className="form-grid three"><label>Registro profissional<input value={registration} onChange={(event) => setRegistration(event.target.value)} placeholder="CREA/registro" /></label><label>Número da ART<input value={artNumber} onChange={(event) => setArtNumber(event.target.value)} placeholder="ART obrigatória quando aplicável" /></label><label>Certificado / laudo<input value={certificate} onChange={(event) => setCertificate(event.target.value)} placeholder="Número do documento" /></label></div><div className="form-grid two"><label>Referência do laudo<input value={reportReference} onChange={(event) => setReportReference(event.target.value)} placeholder="Arquivo ou identificação" /></label><label>Link do laudo<input type="url" value={reportUrl} onChange={(event) => setReportUrl(event.target.value)} placeholder="https://..." /></label></div><label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Norma aplicada, condições ou observações" rows={3} /></label>{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving || loading || !materialId}>{saving ? "Salvando..." : "Registrar ensaio"}<Check size={16} /></button></div></form></section></div>}
  </main>;
}

function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }

