"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Check, ClipboardCheck, LoaderCircle, Plus, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Material = { id: string; name: string; internal_code: string; type: "EPI" | "EPC" | "FERRAMENTAL"; unit: string; test_required: boolean };
type MaterialTest = { id: string; performed_at: string; interval_months: number; next_due_at: string; result: "approved" | "approved_with_restrictions" | "failed" | "pending"; examiner: string | null; professional_registration: string | null; art_number: string | null; certificate_number: string | null; report_reference: string | null; report_url: string | null; material: Material | null };
type TestOverview = { material: Material; latestTest: MaterialTest | null; stockQuantity: number };

const results = [["approved", "Aprovado"], ["approved_with_restrictions", "Aprovado com restrições"], ["failed", "Reprovado"], ["pending", "Pendente"]];

function todayLocal() { const date = new Date(); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10); }

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
  const [performedAt, setPerformedAt] = useState(todayLocal());
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
  const [stockByMaterial, setStockByMaterial] = useState<Record<string, number>>({});
  const [retryKey, setRetryKey] = useState(0);
  const loadVersion = useRef(0);

  async function loadData() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const [{ data: materialData, error: materialError }, { data: testData, error: testError }, { data: lotData, error: lotError }] = await Promise.all([
        supabase.from("materials").select("id, name, internal_code, type, unit, test_required").eq("status", "active").order("name"),
        supabase.from("material_tests").select("id, performed_at, interval_months, next_due_at, result, examiner, professional_registration, art_number, certificate_number, report_reference, report_url, material:materials(id, name, internal_code, type, unit, test_required)").order("performed_at", { ascending: false }),
        supabase.from("material_lots").select("material_id, available_quantity"),
      ]);
      if (version !== loadVersion.current) return;
      if (materialError || testError || lotError) {
        setError(friendlyError(materialError ?? testError ?? lotError, "Não foi possível carregar os ensaios."));
        return;
      }
      setMaterials((materialData ?? []) as Material[]);
      setTests((testData ?? []) as unknown as MaterialTest[]);
      setStockByMaterial((lotData ?? []).reduce<Record<string, number>>((stock, lot) => ({ ...stock, [lot.material_id]: (stock[lot.material_id] ?? 0) + Number(lot.available_quantity ?? 0) }), {}));
    } catch (caught) {
      if (version === loadVersion.current) setError(friendlyError(caught, "Não foi possível carregar os ensaios."));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => { void Promise.resolve().then(() => loadData()); }, [retryKey]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);

  function retryLoad() { setRetryKey((current) => current + 1); }

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
    stockQuantity: stockByMaterial[material.id] ?? 0,
  })), [materials, latestTestsByMaterial, stockByMaterial]);

  function getOverviewState(overview: TestOverview) {
    const test = overview.latestTest;
    const days = daysUntil(test?.next_due_at ?? null);
    if (!test) return { label: "Pendente de ensaio", className: "warning", detail: "Registre o primeiro ensaio" };
    if (!test.next_due_at) return { label: "Validade pendente", className: "warning", detail: "Informe a data do próximo ensaio" };
    if (test.result === "pending") return { label: "Resultado pendente", className: "warning", detail: "Conclua a avaliação do ensaio" };
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
    const matchesQuery = text.includes(query.trim().toLowerCase());
    const matchesFilter = filter === "all"
      || (filter === "pending" && (!test || test.result === "pending"))
      || (filter === "overdue" && state.label === "Vencido")
      || (filter === "urgent" && days !== null && days >= 0 && days <= 30)
      || (filter === "approved" && (test?.result === "approved" || test?.result === "approved_with_restrictions"));
    return matchesQuery && matchesFilter;
  }), [overviews, query, filter]);

  const counts = useMemo(() => ({
    total: overviews.length,
    pending: overviews.filter((overview) => !overview.latestTest || overview.latestTest.result === "pending").length,
    overdue: overviews.filter((overview) => getOverviewState(overview).label === "Vencido").length,
    urgent: overviews.filter((overview) => { const days = daysUntil(overview.latestTest?.next_due_at ?? null); return days !== null && days >= 0 && days <= 30; }).length,
  }), [overviews]);

  const materialOptions = useMemo(() => { const normalizedQuery = materialQuery.trim().toLowerCase(); return materials.filter((material) => material.test_required && `${material.name} ${material.internal_code}`.toLowerCase().includes(normalizedQuery)); }, [materials, materialQuery]);

  function resetForm() {
    setMaterialId(""); setMaterialQuery(""); setMaterialSuggestionsOpen(false); setPerformedAt(todayLocal()); setInterval("6"); setResult("approved"); setExaminer(""); setRegistration(""); setArtNumber(""); setCertificate(""); setReportReference(""); setReportUrl(""); setNotes("");
  }

  async function saveTest(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    if (!materialId) { setError("Selecione um material ensaiável."); return; }
    if (!isRealDate(performedAt)) { setError("Informe uma data de ensaio válida."); return; }
    if (performedAt > todayLocal()) { setError("A data do ensaio não pode ser futura."); return; }
    if (!([6, 12] as number[]).includes(Number(interval))) { setError("A periodicidade deve ser de 6 ou 12 meses."); return; }
    if (reportUrl && !isHttpUrl(reportUrl)) { setError("O link do laudo deve começar com http:// ou https://."); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: testId, error: saveError } = await supabase.rpc("register_material_test", { p_material_id: materialId, p_performed_at: performedAt, p_interval_months: Number(interval), p_result: result, p_examiner: examiner || null, p_certificate_number: certificate || null, p_notes: notes || null });
      if (saveError || !testId) { setError(friendlyError(saveError, "Não foi possível registrar o ensaio.")); return; }
      const { error: detailsError } = await supabase.from("material_tests").update({ professional_registration: registration || null, art_number: artNumber || null, report_reference: reportReference || null, report_url: reportUrl || null }).eq("id", testId);
      if (detailsError) {
        await supabase.from("material_tests").delete().eq("id", testId);
        setError(`Não foi possível concluir o registro do ensaio: ${friendlyError(detailsError, "tente novamente")}`);
        return;
      }
      setSuccess("Ensaio, responsável técnico, ART e laudo registrados com sucesso.");
      setShowForm(false);
      resetForm();
      await loadData();
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível registrar o ensaio."));
    } finally {
      setSaving(false);
    }
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CONTROLE TÉCNICO</p><h1>Ensaios</h1><p className="module-subtitle">Acompanhe os materiais que exigem ensaio, suas validades e próximos vencimentos.</p></div><button type="button" className="primary-button" onClick={() => { resetForm(); setShowForm(true); setError(""); setSuccess(""); }}><Plus size={17} /> Registrar ensaio</button></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && !showForm && <FeedbackMessage onRetry={retryLoad}>{error}</FeedbackMessage>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar material, certificado ou ART" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar material, certificado ou ART" /></div><select aria-label="Filtrar ensaios por situação" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos os materiais</option><option value="pending">Pendentes de ensaio</option><option value="overdue">Vencidos</option><option value="urgent">Até 30 dias</option><option value="approved">Aprovados</option></select></section>
    {!loading && (<section className="module-summary"><div><strong>{counts.total}</strong><span>materiais ensaiáveis</span></div><div><strong>{counts.pending}</strong><span>pendentes de ensaio</span></div><div><strong>{counts.overdue}</strong><span>vencidos</span></div><div><strong>{counts.urgent}</strong><span>até 30 dias</span></div></section>)}
    <section className="panel module-table-card"><div className="panel-header"><div><h2>Materiais que exigem ensaio</h2><p>{filtered.length} material(is) listado(s)</p></div></div>
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando ensaios...</div> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>MATERIAL</th><th>ESTOQUE</th><th>STATUS</th><th>ÚLTIMO ENSAIO</th><th>PRÓXIMO ENSAIO</th><th>RESULTADO</th><th>LAUDO / ART</th></tr></thead><tbody>{filtered.map((overview) => { const test = overview.latestTest; const state = getOverviewState(overview); const resultLabel = test ? results.find(([value]) => value === test.result)?.[1] ?? test.result : "Ainda não realizado"; return <tr key={overview.material.id}><td><div className="material-cell"><div className="material-type-icon epi"><ClipboardCheck size={17} /></div><div><strong>{overview.material.name}</strong><small>Ensaio obrigatório · {overview.material.type}</small></div></div></td><td><strong>{overview.stockQuantity}</strong> {overview.material.unit}</td><td><span className={`status-pill ${state.className}`}>{state.label}</span><small className="muted-cell">{state.detail}</small></td><td>{test ? formatDate(test.performed_at) : "Ainda não realizado"}</td><td><strong>{formatDate(test?.next_due_at ?? null)}</strong>{test?.next_due_at && <small className="muted-cell">{state.detail}</small>}</td><td><span className={`status-pill ${test?.result === "failed" ? "danger" : test ? "success" : "warning"}`}>{resultLabel}</span></td><td><strong>{test?.art_number || "ART pendente"}</strong><small>{test?.report_url ? <a href={test.report_url} target="_blank" rel="noreferrer">Abrir laudo</a> : test?.report_reference || "Laudo pendente"}</small></td></tr>; })}</tbody></table></div> : <div className="empty-state"><CalendarCheck size={27} /><strong>{overviews.length ? "Nenhum resultado encontrado" : "Nenhum material ensaiável em estoque"}</strong><span>{overviews.length ? "Ajuste a busca ou o filtro para ver outros materiais." : "Registre uma entrada de estoque para acompanhar os ensaios."}</span></div>}
    </section>
    {showForm && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-label="Cadastro de ensaio"><div className="modal-header"><div><p className="eyebrow">NOVO REGISTRO</p><h2>Registrar ensaio</h2></div><button className="close-modal" type="button" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveTest}><div className="form-grid two"><label className="material-picker">Material<div className="material-picker-control"><input value={materialQuery} onChange={(event) => { setMaterialQuery(event.target.value); setMaterialId(""); setMaterialSuggestionsOpen(true); }} onFocus={() => { if (!materialId) setMaterialSuggestionsOpen(true); }} placeholder="Digite o nome do material" required disabled={loading} autoComplete="off" />{materialSuggestionsOpen && materialQuery && <div className="employee-suggestions">{materialOptions.map((material) => <button type="button" key={material.id} onMouseDown={() => { setMaterialId(material.id); setMaterialQuery(material.name); setMaterialSuggestionsOpen(false); }}><strong>{material.name}</strong></button>)}{!materialOptions.length && <span>Nenhum material ensaiável encontrado.</span>}</div>}</div></label><label>Data do ensaio<input type="date" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} required /></label></div><div className="form-grid three"><label>Periodicidade<select value={interval} onChange={(event) => setInterval(event.target.value)}><option value="6">A cada 6 meses</option><option value="12">A cada 12 meses</option></select></label><label>Resultado<select value={result} onChange={(event) => setResult(event.target.value)}>{results.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Responsável técnico<input value={examiner} onChange={(event) => setExaminer(event.target.value)} placeholder="Nome ou empresa" required /></label></div><div className="form-grid three"><label>Registro profissional<input value={registration} onChange={(event) => setRegistration(event.target.value)} placeholder="CREA/registro" /></label><label>Número da ART<input value={artNumber} onChange={(event) => setArtNumber(event.target.value)} placeholder="ART obrigatória quando aplicável" /></label><label>Certificado / laudo<input value={certificate} onChange={(event) => setCertificate(event.target.value)} placeholder="Número do documento" /></label></div><div className="form-grid two"><label>Referência do laudo<input value={reportReference} onChange={(event) => setReportReference(event.target.value)} placeholder="Arquivo ou identificação" /></label><label>Link do laudo<input type="url" value={reportUrl} onChange={(event) => setReportUrl(event.target.value)} placeholder="https://..." /></label></div><label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Norma aplicada, condições ou observações" rows={3} /></label>{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving || loading || !materialId}>{saving ? "Salvando..." : "Registrar ensaio"}<Check size={16} /></button></div></form></section></div>}
  </main>;
}

function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
function isRealDate(value: string) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false; const date = new Date(`${value}T00:00:00`); return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(match[1]) && date.getMonth() + 1 === Number(match[2]) && date.getDate() === Number(match[3]); }
