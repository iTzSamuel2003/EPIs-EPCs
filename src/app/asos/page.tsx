"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BarChart3, CalendarClock, CalendarDays, Check, ChevronDown, CircleHelp, ClipboardList, Download, FileCheck2, FilePlus2, Filter, LoaderCircle, MapPin, Paperclip, Plus, RotateCcw, Search, ShieldCheck, Stethoscope, UserRound, X } from "lucide-react";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";
import { getCurrentOrganizationProfile } from "@/lib/organization-context";

const BUCKET = "employee-aso-documents";
const EXAM_TYPES = [
  ["admission", "Admissional"],
  ["periodic", "Periódico"],
  ["return_to_work", "Retorno ao trabalho"],
  ["risk_change", "Mudança de riscos ocupacionais"],
  ["dismissal", "Demissional"],
  ["other", "Outro"],
] as const;
const FITNESS_RESULTS = [
  ["not_recorded", "Não informado"],
  ["fit", "Apto"],
  ["unfit", "Inapto"],
] as const;

type ExamType = (typeof EXAM_TYPES)[number][0];
type FitnessResult = (typeof FITNESS_RESULTS)[number][0];
type AsoDueState = "missing" | "no-date" | "overdue" | "due-0-7" | "due-8-15" | "due-16-30" | "due-31-60" | "ok";
const DUE_LABELS: Record<AsoDueState, string> = {
  missing: "Sem ASO",
  "no-date": "Sem previsão",
  overdue: "Vencido",
  "due-0-7": "Até 7 dias",
  "due-8-15": "8–15 dias",
  "due-16-30": "16–30 dias",
  "due-31-60": "31–60 dias",
  ok: "Acima de 60 dias",
};
const DUE_COLORS: Record<AsoDueState, string> = {
  missing: "#a5adbb",
  "no-date": "#d4b353",
  overdue: "#c65c51",
  "due-0-7": "#e27c45",
  "due-8-15": "#e9a348",
  "due-16-30": "#d8bd43",
  "due-31-60": "#6492ce",
  ok: "#54a77e",
};
type AsoSummary = {
  organization_id: string;
  employee_id: string;
  registration: string | null;
  full_name: string;
  job_title: string | null;
  function_name: string | null;
  department: string | null;
  unit: string | null;
  base_name: string | null;
  employee_status: string;
  aso_id: string | null;
  exam_type: ExamType | null;
  exam_date: string | null;
  next_exam_due_date: string | null;
  fitness_result: FitnessResult | null;
  document_path: string | null;
  created_by_name_snapshot: string | null;
  aso_created_at: string | null;
};
type AsoRecord = {
  id: string;
  organization_id: string;
  employee_id: string;
  exam_type: ExamType;
  exam_date: string;
  next_exam_due_date: string | null;
  fitness_result: FitnessResult;
  clinic_name: string | null;
  physician_name: string | null;
  physician_registry: string | null;
  employee_name_snapshot: string;
  registration_snapshot: string | null;
  function_name_snapshot: string | null;
  document_path: string | null;
  created_by_name_snapshot: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by_name_snapshot: string | null;
  void_reason: string | null;
};

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function dueDescription(value: string | null) {
  if (!value) return "";
  const days = daysUntilDue(value);
  if (days < 0) return `Vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"}`;
  if (days === 0) return "Vence hoje";
  return `Vence em ${days} dia${days === 1 ? "" : "s"}`;
}

function examLabel(value: string | null) {
  return EXAM_TYPES.find(([key]) => key === value)?.[1] ?? "—";
}

function resultLabel(value: string | null) {
  return FITNESS_RESULTS.find(([key]) => key === value)?.[1] ?? "Não informado";
}

function daysUntilDue(date: string) {
  const today = Date.parse(`${localToday()}T00:00:00Z`);
  const due = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.round((due - today) / 86_400_000);
}

function dueState(row: AsoSummary): AsoDueState {
  if (!row.aso_id) return "missing";
  if (!row.next_exam_due_date) return "no-date";
  const days = daysUntilDue(row.next_exam_due_date);
  if (days < 0) return "overdue";
  if (days <= 7) return "due-0-7";
  if (days <= 15) return "due-8-15";
  if (days <= 30) return "due-16-30";
  if (days <= 60) return "due-31-60";
  return "ok";
}

function acceptedDocument(file: File) {
  return new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]).has(file.type) && file.size <= 10 * 1024 * 1024;
}

function documentExtension(file: File) {
  return file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
}

function employeeFunction(row: Pick<AsoSummary, "function_name" | "job_title">) {
  return row.function_name?.trim() || row.job_title?.trim() || "Função não informada";
}

function employmentLabel(status: string) {
  return status === "terminated" ? "Desligado" : status === "away" ? "Afastado" : status === "active" ? "Ativo" : status;
}

export default function AsosPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [rows, setRows] = useState<AsoSummary[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("current");
  const [examFilter, setExamFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [baseFilter, setBaseFilter] = useState("all");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formExamType, setFormExamType] = useState<ExamType>("periodic");
  const [formExamDate, setFormExamDate] = useState(localToday);
  const [formDueDate, setFormDueDate] = useState("");
  const [formResult, setFormResult] = useState<FitnessResult>("not_recorded");
  const [formClinic, setFormClinic] = useState("");
  const [formPhysician, setFormPhysician] = useState("");
  const [formRegistry, setFormRegistry] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [historyEmployee, setHistoryEmployee] = useState<AsoSummary | null>(null);
  const [history, setHistory] = useState<AsoRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [voidTarget, setVoidTarget] = useState<AsoRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<AsoRecord | null>(null);

  const loadRows = useCallback(async (quiet = false) => {
    if (!organizationId) return;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    const supabase = createClient();
    const [asoResult, employeeBaseResult, baseResult] = await Promise.all([
      supabase.from("employee_aso_current_status")
        .select("organization_id,employee_id,registration,full_name,job_title,function_name,department,unit,employee_status,aso_id,exam_type,exam_date,next_exam_due_date,fitness_result,document_path,created_by_name_snapshot,aso_created_at")
        .eq("organization_id", organizationId)
        .order("full_name", { ascending: true }),
      supabase.from("employees").select("id,base_id").eq("organization_id", organizationId),
      supabase.from("organization_bases").select("id,name").eq("organization_id", organizationId),
    ]);
    const queryError = asoResult.error || employeeBaseResult.error || baseResult.error;
    if (queryError) setError("Não foi possível carregar os ASOs. Confirme se a atualização do banco foi aplicada e tente novamente.");
    else {
      const baseByEmployee = new Map((employeeBaseResult.data ?? []).map((employee) => [employee.id, employee.base_id]));
      const baseNames = new Map((baseResult.data ?? []).map((base) => [base.id, base.name]));
      const rowsWithBase = (asoResult.data ?? []).map((row) => ({
        ...row,
        base_name: baseNames.get(baseByEmployee.get(row.employee_id) ?? "") ?? null,
      }));
      setRows(rowsWithBase as AsoSummary[]);
      setLastUpdatedAt(new Date());
    }
    setLoading(false);
    setRefreshing(false);
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    async function authorize() {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!auth.user || authError) {
        if (active) { setError("Sua sessão expirou. Entre novamente para acessar os ASOs."); setLoading(false); }
        return;
      }
      const { data: profile, error: profileError } = await getCurrentOrganizationProfile(supabase, auth.user.id, auth.user.user_metadata?.full_name);
      if (profileError || !profile?.organization_id || !profile.role || !["admin", "rh"].includes(profile.role)) {
        if (active) { setError("Esta página está disponível somente para RH e Administradores."); setLoading(false); }
        return;
      }
      if (active) setOrganizationId(profile.organization_id);
    }
    void authorize();
    return () => { active = false; };
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const departments = useMemo(() => [...new Set(rows.map((row) => row.department?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [rows]);
  const bases = useMemo(() => [...new Set(rows.map((row) => row.base_name?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [rows]);

  const analysisRows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => {
      if (employeeFilter === "current" && row.employee_status === "terminated") return false;
      if (employeeFilter !== "all" && employeeFilter !== "current" && row.employee_status !== employeeFilter) return false;
      if (examFilter !== "all" && row.exam_type !== examFilter) return false;
      if (departmentFilter !== "all" && row.department !== departmentFilter) return false;
      if (baseFilter === "unassigned" && row.base_name) return false;
      if (baseFilter !== "all" && baseFilter !== "unassigned" && row.base_name !== baseFilter) return false;
      if (!normalized) return true;
      return [row.full_name, row.registration, row.function_name, row.job_title, row.department, row.unit, row.base_name]
        .some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
    });
  }, [baseFilter, departmentFilter, employeeFilter, examFilter, rows, search]);

  const counts = useMemo(() => analysisRows.reduce<Record<AsoDueState, number>>((result, row) => {
    result[dueState(row)] += 1;
    return result;
  }, { missing: 0, "no-date": 0, overdue: 0, "due-0-7": 0, "due-8-15": 0, "due-16-30": 0, "due-31-60": 0, ok: 0 }), [analysisRows]);

  const filteredRows = useMemo(() => analysisRows.filter((row) => filter === "all" || dueState(row) === filter), [analysisRows, filter]);
  const donutGradient = useMemo(() => {
    if (!analysisRows.length) return "conic-gradient(#edf0f5 0deg 360deg)";
    const states = Object.keys(DUE_LABELS) as AsoDueState[];
    let cursor = 0;
    const segments = states.flatMap((state) => {
      const amount = counts[state];
      if (!amount) return [];
      const start = cursor;
      cursor += (amount / analysisRows.length) * 360;
      return [`${DUE_COLORS[state]} ${start}deg ${cursor}deg`];
    });
    return `conic-gradient(${segments.join(", ")})`;
  }, [analysisRows.length, counts]);

  const unitSummary = useMemo(() => {
    const grouped = new Map<string, { total: number; overdue: number; due30: number }>();
    analysisRows.forEach((row) => {
      const name = row.base_name?.trim() || "Sem base atribuída";
      const entry = grouped.get(name) ?? { total: 0, overdue: 0, due30: 0 };
      entry.total += 1;
      const state = dueState(row);
      if (state === "overdue") entry.overdue += 1;
      if (["due-0-7", "due-8-15", "due-16-30"].includes(state)) entry.due30 += 1;
      grouped.set(name, entry);
    });
    return [...grouped.entries()].map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => (b.overdue + b.due30) - (a.overdue + a.due30) || a.name.localeCompare(b.name, "pt-BR"))
      .slice(0, 6);
  }, [analysisRows]);

  const hasActiveFilters = filter !== "all" || employeeFilter !== "current" || examFilter !== "all" || departmentFilter !== "all" || baseFilter !== "all" || search.trim() !== "";

  function clearFilters() {
    setSearch("");
    setFilter("all");
    setEmployeeFilter("current");
    setExamFilter("all");
    setDepartmentFilter("all");
    setBaseFilter("all");
  }

  function openNewRecord(employeeId = "") {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFormEmployeeId(employeeId);
    setFormExamType("periodic");
    setFormExamDate(localToday());
    setFormDueDate("");
    setFormResult("not_recorded");
    setFormClinic("");
    setFormPhysician("");
    setFormRegistry("");
    setFormFile(null);
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  async function createAso(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !formEmployeeId || saving) return;
    if (formFile && !acceptedDocument(formFile)) {
      setError("O ASO deve ser PDF, JPG, PNG ou WEBP de até 10 MB.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    const supabase = createClient();
    const { data, error: insertError } = await supabase.from("employee_asos").insert({
      organization_id: organizationId,
      employee_id: formEmployeeId,
      exam_type: formExamType,
      exam_date: formExamDate,
      next_exam_due_date: formDueDate || null,
      fitness_result: formResult,
      clinic_name: formClinic.trim() || null,
      physician_name: formPhysician.trim() || null,
      physician_registry: formRegistry.trim() || null,
    }).select("id,employee_id").single();
    if (insertError || !data) {
      setError("Não foi possível registrar o ASO. Confira as datas e tente novamente.");
      setSaving(false);
      return;
    }

    let attachmentWarning = "";
    if (formFile) {
      const path = `${organizationId}/${formEmployeeId}/${data.id}/${crypto.randomUUID()}.${documentExtension(formFile)}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, formFile, { contentType: formFile.type, upsert: false });
      if (uploadError) attachmentWarning = " O cadastro foi salvo, mas o arquivo não foi anexado; você poderá anexá-lo pelo histórico.";
      else {
        const { error: pathError } = await supabase.from("employee_asos").update({ document_path: path }).eq("id", data.id);
        if (pathError) {
          const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([path]);
          attachmentWarning = cleanupError
            ? " O cadastro foi salvo; o anexo não foi vinculado e precisa de atenção do administrador."
            : " O cadastro foi salvo, mas o anexo não pôde ser vinculado. Anexe-o pelo histórico.";
        }
      }
    }
    setFormOpen(false);
    setFormFile(null);
    setSuccess(`ASO registrado.${attachmentWarning}`);
    await loadRows(true);
    setSaving(false);
  }

  async function loadHistory(employee: AsoSummary) {
    setHistoryEmployee(employee);
    setHistory([]);
    setHistoryLoading(true);
    setError("");
    const { data, error: queryError } = await createClient().from("employee_asos")
      .select("id,organization_id,employee_id,exam_type,exam_date,next_exam_due_date,fitness_result,clinic_name,physician_name,physician_registry,employee_name_snapshot,registration_snapshot,function_name_snapshot,document_path,created_by_name_snapshot,created_at,voided_at,voided_by_name_snapshot,void_reason")
      .eq("organization_id", organizationId)
      .eq("employee_id", employee.employee_id)
      .order("exam_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (queryError) setError("Não foi possível carregar o histórico de ASOs deste colaborador.");
    else setHistory((data ?? []) as AsoRecord[]);
    setHistoryLoading(false);
  }

  async function attachDocument(record: AsoRecord, file: File) {
    if (!acceptedDocument(file)) { setError("O ASO deve ser PDF, JPG, PNG ou WEBP de até 10 MB."); return; }
    const path = `${organizationId}/${record.employee_id}/${record.id}/${crypto.randomUUID()}.${documentExtension(file)}`;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setError("Não foi possível anexar este documento. Confira o formato e tente novamente."); return; }
    const { error: pathError } = await supabase.from("employee_asos").update({ document_path: path }).eq("id", record.id);
    if (pathError) {
      await supabase.storage.from(BUCKET).remove([path]);
      setError("O arquivo foi enviado, mas não pôde ser vinculado ao registro.");
      return;
    }
    setSuccess("Documento anexado ao ASO.");
    if (historyEmployee) await loadHistory(historyEmployee);
    await loadRows(true);
  }

  async function openDocument(record: Pick<AsoRecord, "id" | "document_path">) {
    if (!record.document_path || openingId) return;
    const openedWindow = window.open("about:blank", "_blank");
    if (openedWindow) openedWindow.opener = null;
    setOpeningId(record.id);
    const { data, error: urlError } = await createClient().storage.from(BUCKET).createSignedUrl(record.document_path, 300);
    if (urlError || !data?.signedUrl) {
      openedWindow?.close();
      setError("Não foi possível abrir o ASO. Confira seu acesso e tente novamente.");
    } else if (openedWindow) openedWindow.location.replace(data.signedUrl);
    else setError("O navegador bloqueou a nova aba. Permita pop-ups para visualizar o ASO.");
    setOpeningId("");
  }

  async function cancelAso() {
    if (!voidTarget || cancelling || voidReason.trim().length < 3) return;
    setCancelling(true);
    setError("");
    const { error: updateError } = await createClient().from("employee_asos").update({ void_reason: voidReason.trim() }).eq("id", voidTarget.id);
    if (updateError) setError("Não foi possível cancelar o registro. Atualize e tente novamente.");
    else {
      setSuccess("ASO cancelado e preservado no histórico com o motivo informado.");
      setVoidTarget(null);
      setVoidReason("");
      if (historyEmployee) await loadHistory(historyEmployee);
      await loadRows(true);
    }
    setCancelling(false);
  }

  return <main className="module-shell asos-page">
    <header className="module-header asos-header">
      <div><p className="eyebrow">RECURSOS HUMANOS</p><h1>ASOs</h1><p className="module-subtitle">Controle os exames ocupacionais, acompanhe as datas recomendadas e consulte os documentos do colaborador.</p></div>
      <button className="primary-button" type="button" onClick={() => openNewRecord()} disabled={!organizationId}><Plus size={16} /> Registrar ASO</button>
    </header>

    <section className="panel asos-guidance">
      <div className="asos-guidance-icon"><ShieldCheck size={21} /></div>
      <div><strong>Documentos médicos restritos ao RH</strong><p>Os anexos ficam em armazenamento privado e são abertos por link temporário. Não registre diagnóstico, CID, resultados laboratoriais ou observações clínicas nesta tela.</p></div>
      <span><CircleHelp size={15} /> A próxima data é definida pelo PCMSO / médico responsável</span>
    </section>

    {error && <FeedbackMessage>{error}</FeedbackMessage>}
    {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}

    <section className="asos-metrics" aria-label="Resumo dos ASOs filtrados">
      <article><small>Colaboradores no filtro</small><strong>{analysisRows.length}</strong><span>Ativos e afastados por padrão</span></article>
      <article className={counts.overdue ? "is-warning" : ""}><small>Vencidos</small><strong>{counts.overdue}</strong><span>Precisam de acompanhamento</span></article>
      <article className={counts["due-0-7"] + counts["due-8-15"] + counts["due-16-30"] ? "is-attention" : ""}><small>Vencem em até 30 dias</small><strong>{counts["due-0-7"] + counts["due-8-15"] + counts["due-16-30"]}</strong><span>Planeje o próximo exame</span></article>
      <article><small>Sem ASO ou previsão</small><strong>{counts.missing + counts["no-date"]}</strong><span>Verifique os registros</span></article>
    </section>

    <section className="panel asos-analytics" aria-label="Análise de vencimentos de ASO">
      <div className="asos-analytics-heading"><div><span className="asos-section-icon"><BarChart3 size={17} /></span><div><h2>Visão de vencimentos</h2><p>Distribuição dos exames mais recentes não cancelados, considerando os filtros selecionados.</p></div></div><span className="asos-updated">{lastUpdatedAt ? `Atualizado em ${formatDateTime(lastUpdatedAt.toISOString())}` : "Aguardando dados"}</span></div>
      <div className="asos-analytics-grid">
        <div className="asos-distribution">
          <div className="asos-donut" role="img" aria-label={`Distribuição de vencimentos para ${analysisRows.length} colaboradores`} style={{ background: donutGradient }}><div><strong>{analysisRows.length}</strong><span>colaboradores</span></div></div>
          <div className="asos-donut-legend">{(Object.keys(DUE_LABELS) as AsoDueState[]).map((state) => <div key={state}><span style={{ backgroundColor: DUE_COLORS[state] }} /><span>{DUE_LABELS[state]}</span><strong>{counts[state]}</strong></div>)}</div>
        </div>
        <div className="asos-unit-summary"><div className="asos-unit-summary-heading"><MapPin size={16} /><h3>Resumo por base operacional</h3></div>
          {unitSummary.length ? <div className="asos-unit-table-wrap"><table><thead><tr><th>Base</th><th>Vencidos</th><th>Até 30 dias</th><th>Total</th></tr></thead><tbody>{unitSummary.map((unit) => <tr key={unit.name}><td>{unit.name}</td><td className={unit.overdue ? "is-warning" : ""}>{unit.overdue}</td><td className={unit.due30 ? "is-attention" : ""}>{unit.due30}</td><td>{unit.total}</td></tr>)}</tbody></table></div> : <p className="asos-unit-empty">Nenhuma base encontrada para os filtros atuais.</p>}
        </div>
      </div>
    </section>

    <section className="panel asos-list-panel">
      <div className="asos-list-heading"><div><h2>Detalhamento por colaborador</h2><p>{filteredRows.length} de {analysisRows.length} colaboradores · exame mais recente não cancelado; use “Histórico” para consultar registros anteriores.</p></div><button className="text-action" type="button" onClick={() => void loadRows(true)} disabled={refreshing || loading}><RotateCcw size={14} className={refreshing ? "spin" : ""} /> Atualizar</button></div>
      <div className="asos-expiry-filters" aria-label="Filtrar por vencimento">
        <button type="button" className={filter === "all" ? "is-selected" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}><span>Todos</span><strong>{analysisRows.length}</strong></button>
        {(Object.keys(DUE_LABELS) as AsoDueState[]).map((state) => <button type="button" key={state} className={filter === state ? "is-selected" : ""} aria-pressed={filter === state} onClick={() => setFilter(filter === state ? "all" : state)}><span><i style={{ backgroundColor: DUE_COLORS[state] }} />{DUE_LABELS[state]}</span><strong>{counts[state]}</strong></button>)}
      </div>
      <div className="asos-filters">
        <label className="asos-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por colaborador, matrícula, função ou base" /></label>
        <label className="asos-status-filter"><span>Vínculo</span><select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="current">Ativos e afastados</option><option value="active">Ativos</option><option value="away">Afastados</option><option value="terminated">Desligados</option><option value="all">Todos</option></select><ChevronDown size={14} aria-hidden="true" /></label>
        <label className="asos-status-filter"><span>Tipo de exame</span><select value={examFilter} onChange={(event) => setExamFilter(event.target.value)}><option value="all">Todos</option>{EXAM_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
        <label className="asos-status-filter"><span>Setor / contrato</span><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="all">Todos</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
        <label className="asos-status-filter"><span>Base operacional</span><select value={baseFilter} onChange={(event) => setBaseFilter(event.target.value)}><option value="all">Todas</option><option value="unassigned">Sem base atribuída</option>{bases.map((base) => <option key={base} value={base}>{base}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
        {hasActiveFilters && <button className="asos-clear-filters" type="button" onClick={clearFilters}><Filter size={14} /> Limpar filtros</button>}
      </div>
      {loading ? <div className="asos-state"><LoaderCircle size={21} className="spin" /> Carregando ASOs...</div>
        : filteredRows.length === 0 ? <div className="asos-empty"><Stethoscope size={26} /><strong>Nenhum colaborador encontrado</strong><span>Confira os filtros ou registre o primeiro ASO do colaborador.</span></div>
          : <div className="asos-table-wrap"><table className="asos-table"><thead><tr><th>Colaborador</th><th>Exame mais recente</th><th>Próxima data recomendada</th><th>Situação</th><th>Documento</th><th>Ações</th></tr></thead><tbody>
            {filteredRows.map((row) => {
              const state = dueState(row);
              return <tr key={row.employee_id}>
                <td><div className="asos-person"><span className="asos-avatar"><UserRound size={16} /></span><span><strong>{row.full_name}</strong><small>{row.registration ? `Matrícula ${row.registration}` : "Sem matrícula"} · {employeeFunction(row)}</small><small className={`asos-employee-status employee-${row.employee_status}`}>{employmentLabel(row.employee_status)}</small><small>{[row.department, row.base_name || "Sem base atribuída"].filter(Boolean).join(" · ")}</small></span></div></td>
                <td>{row.aso_id ? <><strong className="asos-cell-primary">{examLabel(row.exam_type)}</strong><small className="asos-cell-secondary">{formatDate(row.exam_date)} · {resultLabel(row.fitness_result)}</small></> : <span className="asos-muted">Sem registro</span>}</td>
                <td>{row.next_exam_due_date ? <><strong className="asos-cell-primary">{formatDate(row.next_exam_due_date)}</strong><small className="asos-cell-secondary">{dueDescription(row.next_exam_due_date)}</small></> : <span className="asos-muted">Não informada</span>}</td>
                <td><span className={`asos-status-pill status-${state}`}>{state === "overdue" ? <AlertTriangle size={13} /> : state === "ok" ? <Check size={13} /> : <CalendarClock size={13} />}{DUE_LABELS[state]}</span></td>
                <td>{row.document_path ? <span className="asos-document-state"><FileCheck2 size={14} /> Anexado</span> : row.aso_id ? <span className="asos-muted">Pendente</span> : "—"}</td>
                <td><div className="asos-row-actions"><button className="text-action" type="button" onClick={() => void loadHistory(row)}><ClipboardList size={14} /> Histórico</button><button className="text-action" type="button" onClick={() => openNewRecord(row.employee_id)}><Plus size={14} /> Novo ASO</button></div></td>
              </tr>;
            })}
          </tbody></table></div>}
      <div className="asos-legal-note"><CalendarDays size={15} /><span>A data exibida é de acompanhamento registrada pelo RH com base na orientação do PCMSO/médico responsável; não representa uma validade legal automática do ASO.</span></div>
    </section>

    {formOpen && <div className="asos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}>
      <section className="asos-modal" role="dialog" aria-modal="true" aria-labelledby="asos-form-heading">
        <div className="asos-modal-heading"><div><span className="eyebrow">REGISTRO OCUPACIONAL</span><h2 id="asos-form-heading">Registrar ASO</h2><p>Cadastre os dados administrativos e anexe o documento, se disponível.</p></div><button className="icon-button" type="button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Fechar"><X size={18} /></button></div>
        <form onSubmit={(event) => void createAso(event)}>
          <label><span>Colaborador</span><select required value={formEmployeeId} onChange={(event) => setFormEmployeeId(event.target.value)}><option value="">Selecione o colaborador</option>{rows.map((row) => <option key={row.employee_id} value={row.employee_id}>{row.full_name}{row.registration ? ` · ${row.registration}` : ""}</option>)}</select></label>
          <div className="asos-form-grid"><label><span>Tipo de exame</span><select value={formExamType} onChange={(event) => setFormExamType(event.target.value as ExamType)}>{EXAM_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Data do exame</span><input required type="date" value={formExamDate} onChange={(event) => setFormExamDate(event.target.value)} /></label><label><span>Próximo exame previsto</span><input type="date" min={formExamDate} value={formDueDate} onChange={(event) => setFormDueDate(event.target.value)} /><small>Conforme PCMSO ou orientação do médico.</small></label><label><span>Resultado registrado no ASO</span><select value={formResult} onChange={(event) => setFormResult(event.target.value as FitnessResult)}>{FITNESS_RESULTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <div className="asos-form-grid"><label><span>Clínica / prestador (opcional)</span><input maxLength={180} value={formClinic} onChange={(event) => setFormClinic(event.target.value)} /></label><label><span>Médico examinador (opcional)</span><input maxLength={180} value={formPhysician} onChange={(event) => setFormPhysician(event.target.value)} /></label><label><span>Registro profissional (opcional)</span><input maxLength={80} value={formRegistry} onChange={(event) => setFormRegistry(event.target.value)} placeholder="Ex.: CRM/UF" /></label></div>
          <label className="asos-file-field"><span>Documento do ASO (opcional)</span><span className="asos-file-picker"><input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFormFile(event.target.files?.[0] ?? null)} /><Paperclip size={16} /><span>{formFile?.name || "Escolher PDF ou imagem · máximo 10 MB"}</span></span><small>Armazenado em bucket privado, acessível somente por RH e Administradores.</small></label>
          <div className="asos-privacy-note"><ShieldCheck size={16} /><span>Cadastre somente dados administrativos necessários. Não inclua diagnóstico, CID, prontuário ou exames laboratoriais.</span></div>
          {error && <FeedbackMessage>{error}</FeedbackMessage>}
          <div className="asos-modal-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || !formEmployeeId}>{saving ? <><LoaderCircle size={15} className="spin" /> Salvando...</> : <><FilePlus2 size={15} /> Registrar ASO</>}</button></div>
        </form>
      </section>
    </div>}

    {historyEmployee && <div className="asos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancelling) setHistoryEmployee(null); }}>
      <section className="asos-modal asos-history-modal" role="dialog" aria-modal="true" aria-labelledby="asos-history-heading">
        <div className="asos-modal-heading"><div><span className="eyebrow">PRONTUÁRIO ADMINISTRATIVO DE ASOS</span><h2 id="asos-history-heading">{historyEmployee.full_name}</h2><p>{historyEmployee.registration ? `Matrícula ${historyEmployee.registration} · ` : ""}{employeeFunction(historyEmployee)}{historyEmployee.department ? ` · ${historyEmployee.department}` : ""}</p></div><button className="icon-button" type="button" onClick={() => setHistoryEmployee(null)} aria-label="Fechar histórico"><X size={18} /></button></div>
        {historyLoading ? <div className="asos-state"><LoaderCircle size={20} className="spin" /> Carregando histórico...</div>
          : history.length === 0 ? <div className="asos-empty"><Stethoscope size={25} /><strong>Nenhum ASO registrado</strong><span>Inclua um exame para iniciar o acompanhamento.</span><button className="primary-button" type="button" onClick={() => { setHistoryEmployee(null); openNewRecord(historyEmployee.employee_id); }}><Plus size={15} /> Registrar ASO</button></div>
            : <div className="asos-history-list">{history.map((record) => <article className={`asos-history-item ${record.voided_at ? "is-voided" : ""}`} key={record.id}>
              <div className="asos-history-date"><CalendarDays size={15} /><strong>{formatDate(record.exam_date)}</strong></div>
              <div className="asos-history-content"><div className="asos-history-title"><div><strong>{examLabel(record.exam_type)}</strong><span>{resultLabel(record.fitness_result)}</span></div>{record.voided_at && <span className="asos-cancelled-badge">Cancelado</span>}</div>
                <div className="asos-history-facts"><span>Próximo exame: {formatDate(record.next_exam_due_date)}</span>{record.clinic_name && <span>{record.clinic_name}</span>}{record.physician_name && <span>{record.physician_name}{record.physician_registry ? ` · ${record.physician_registry}` : ""}</span>}</div>
                {record.voided_at && <p className="asos-void-reason">Cancelado por {record.voided_by_name_snapshot || "usuário"} · {formatDateTime(record.voided_at)}. Motivo: {record.void_reason}</p>}
                <div className="asos-history-footer"><span>Registrado por {record.created_by_name_snapshot || "usuário"} · {formatDateTime(record.created_at)}</span><div>
                  {record.document_path && <button className="text-action" type="button" onClick={() => void openDocument(record)} disabled={openingId !== ""}><Download size={14} /> {openingId === record.id ? "Abrindo..." : "Visualizar documento"}</button>}
                  {!record.document_path && !record.voided_at && <button className="text-action" type="button" onClick={() => { setUploadTarget(record); uploadFileInputRef.current?.click(); }}><Paperclip size={14} /> Anexar ASO</button>}
                  {!record.voided_at && <button className="asos-cancel-button" type="button" onClick={() => { setVoidTarget(record); setVoidReason(""); }}><X size={14} /> Cancelar registro</button>}
                </div></div>
              </div>
            </article>)}</div>}
        <div className="asos-modal-actions"><button className="secondary-button" type="button" onClick={() => { setHistoryEmployee(null); openNewRecord(historyEmployee.employee_id); }}><Plus size={15} /> Novo ASO</button><button className="primary-button" type="button" onClick={() => setHistoryEmployee(null)}>Concluir</button></div>
      </section>
    </div>}

    <input ref={uploadFileInputRef} className="asos-hidden-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Selecionar documento do ASO" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; const target = uploadTarget; setUploadTarget(null); if (file && target) void attachDocument(target, file); }} />

    {voidTarget && <div className="asos-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancelling) setVoidTarget(null); }}>
      <section className="asos-modal asos-void-modal" role="dialog" aria-modal="true" aria-labelledby="asos-cancel-heading">
        <div className="asos-modal-heading"><div><span className="eyebrow">PRESERVAÇÃO DO HISTÓRICO</span><h2 id="asos-cancel-heading">Cancelar registro de ASO?</h2><p>O registro não será apagado; ficará marcado como cancelado.</p></div><button className="icon-button" type="button" onClick={() => setVoidTarget(null)} disabled={cancelling} aria-label="Fechar"><X size={18} /></button></div>
        <label className="asos-void-reason"><span>Motivo do cancelamento</span><textarea required minLength={3} maxLength={500} rows={4} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Explique por que este registro está sendo cancelado." /></label>
        {error && <FeedbackMessage>{error}</FeedbackMessage>}
        <div className="asos-modal-actions"><button className="secondary-button" type="button" onClick={() => setVoidTarget(null)} disabled={cancelling}>Manter registro</button><button className="asos-confirm-cancel" type="button" onClick={() => void cancelAso()} disabled={cancelling || voidReason.trim().length < 3}>{cancelling ? "Cancelando..." : "Confirmar cancelamento"}</button></div>
      </section>
    </div>}
  </main>;
}
