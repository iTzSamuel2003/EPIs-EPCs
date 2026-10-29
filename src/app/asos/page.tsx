"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, Check, ChevronDown, CircleHelp, ClipboardList, Download, FileCheck2, FilePlus2, LoaderCircle, Paperclip, Plus, RotateCcw, Search, ShieldCheck, Stethoscope, UserRound, X } from "lucide-react";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";

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
type AsoSummary = {
  organization_id: string;
  employee_id: string;
  registration: string | null;
  full_name: string;
  job_title: string | null;
  function_name: string | null;
  department: string | null;
  unit: string | null;
  employee_status: string;
  aso_id: string | null;
  exam_type: ExamType | null;
  exam_date: string | null;
  next_exam_due_date: string | null;
  fitness_result: FitnessResult | null;
  clinic_name: string | null;
  physician_name: string | null;
  physician_registry: string | null;
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

function examLabel(value: string | null) {
  return EXAM_TYPES.find(([key]) => key === value)?.[1] ?? "—";
}

function resultLabel(value: string | null) {
  return FITNESS_RESULTS.find(([key]) => key === value)?.[1] ?? "Não informado";
}

function dueState(row: AsoSummary): "missing" | "no-date" | "overdue" | "soon" | "ok" {
  if (!row.aso_id) return "missing";
  if (!row.next_exam_due_date) return "no-date";
  const today = localToday();
  if (row.next_exam_due_date < today) return "overdue";
  const cutoff = new Date(`${today}T12:00:00`);
  cutoff.setDate(cutoff.getDate() + 30);
  if (row.next_exam_due_date <= `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`) return "soon";
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
  return status === "terminated" ? "Desligado" : status === "away" ? "Afastado" : "Ativo";
}

export default function AsosPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [rows, setRows] = useState<AsoSummary[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
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
    const { data, error: queryError } = await createClient()
      .from("employee_aso_current_status")
      .select("organization_id,employee_id,registration,full_name,job_title,function_name,department,unit,employee_status,aso_id,exam_type,exam_date,next_exam_due_date,fitness_result,clinic_name,physician_name,physician_registry,document_path,created_by_name_snapshot,aso_created_at")
      .eq("organization_id", organizationId)
      .order("full_name", { ascending: true });
    if (queryError) setError("Não foi possível carregar os ASOs. Confirme se a atualização do banco foi aplicada e tente novamente.");
    else setRows((data ?? []) as AsoSummary[]);
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
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id,role").eq("id", auth.user.id).maybeSingle();
      if (profileError || !profile?.organization_id || !["admin", "rh"].includes(profile.role)) {
        if (active) { setError("Esta página está disponível somente para RH e Administradores."); setLoading(false); }
        return;
      }
      if (active) setOrganizationId(profile.organization_id);
    }
    void authorize();
    return () => { active = false; };
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const currentEmployees = useMemo(() => rows.filter((row) => row.employee_status !== "terminated"), [rows]);
  const counts = useMemo(() => currentEmployees.reduce((result, row) => {
    result[dueState(row)] += 1;
    return result;
  }, { missing: 0, "no-date": 0, overdue: 0, soon: 0, ok: 0 }), [currentEmployees]);

  const filteredRows = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => {
      const state = dueState(row);
      if (filter !== "all" && state !== filter) return false;
      if (!normalized) return true;
      return [row.full_name, row.registration, row.function_name, row.job_title, row.department, row.unit]
        .some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
    });
  }, [filter, rows, search]);

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

    <section className="asos-metrics" aria-label="Resumo dos ASOs">
      <article><small>Ativos e afastados</small><strong>{currentEmployees.length}</strong><span>Base atual para acompanhamento</span></article>
      <article className={counts.overdue ? "is-warning" : ""}><small>Data recomendada vencida</small><strong>{counts.overdue}</strong><span>Requer acompanhamento do RH</span></article>
      <article className={counts.soon ? "is-attention" : ""}><small>Próximos 30 dias</small><strong>{counts.soon}</strong><span>Conforme a data registrada</span></article>
      <article><small>Sem ASO registrado</small><strong>{counts.missing}</strong><span>Para conferir o cadastro</span></article>
    </section>

    <section className="panel asos-list-panel">
      <div className="asos-list-heading"><div><h2>Acompanhamento por colaborador</h2><p>Exibe o exame mais recente não cancelado; use “Histórico” para consultar registros anteriores.</p></div><button className="text-action" type="button" onClick={() => void loadRows(true)} disabled={refreshing || loading}><RotateCcw size={14} className={refreshing ? "spin" : ""} /> Atualizar</button></div>
      <div className="asos-filters">
        <label className="asos-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por colaborador, matrícula, função ou unidade" /></label>
        <label className="asos-status-filter"><span>Situação</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todas</option><option value="overdue">Data vencida</option><option value="soon">Próximos 30 dias</option><option value="ok">Em acompanhamento</option><option value="no-date">Sem próxima data</option><option value="missing">Sem ASO registrado</option></select><ChevronDown size={14} aria-hidden="true" /></label>
      </div>
      {loading ? <div className="asos-state"><LoaderCircle size={21} className="spin" /> Carregando ASOs...</div>
        : filteredRows.length === 0 ? <div className="asos-empty"><Stethoscope size={26} /><strong>Nenhum colaborador encontrado</strong><span>Confira os filtros ou registre o primeiro ASO do colaborador.</span></div>
          : <div className="asos-table-wrap"><table className="asos-table"><thead><tr><th>Colaborador</th><th>Exame mais recente</th><th>Próxima data recomendada</th><th>Situação</th><th>Documento</th><th>Ações</th></tr></thead><tbody>
            {filteredRows.map((row) => {
              const state = dueState(row);
              const stateLabels = { missing: "Sem ASO", "no-date": "Sem data prevista", overdue: "Data vencida", soon: "Até 30 dias", ok: "Em acompanhamento" };
              return <tr key={row.employee_id}>
                <td><div className="asos-person"><span className="asos-avatar"><UserRound size={16} /></span><span><strong>{row.full_name}</strong><small>{row.registration ? `Matrícula ${row.registration}` : "Sem matrícula"} · {employeeFunction(row)}</small><small className={`asos-employee-status employee-${row.employee_status}`}>{employmentLabel(row.employee_status)}</small>{(row.department || row.unit) && <small>{[row.department, row.unit].filter(Boolean).join(" · ")}</small>}</span></div></td>
                <td>{row.aso_id ? <><strong className="asos-cell-primary">{examLabel(row.exam_type)}</strong><small className="asos-cell-secondary">{formatDate(row.exam_date)} · {resultLabel(row.fitness_result)}</small></> : <span className="asos-muted">Sem registro</span>}</td>
                <td>{row.next_exam_due_date ? formatDate(row.next_exam_due_date) : <span className="asos-muted">Não informada</span>}</td>
                <td><span className={`asos-status-pill status-${state}`}>{state === "overdue" ? <AlertTriangle size={13} /> : state === "ok" ? <Check size={13} /> : <CalendarClock size={13} />}{stateLabels[state]}</span></td>
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
