"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, History, LoaderCircle, Paperclip, Plus, RotateCcw, ShieldCheck, UserRound, X } from "lucide-react";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";

const DOCUMENT_BUCKET = "employee-hr-history-documents";
const PAGE_SIZE = 30;
const EVENT_TYPES = [
  ["suspension", "Suspensão"],
  ["leave", "Afastamento formal"],
  ["recognition", "Reconhecimento / elogio"],
  ["other", "Outro registro de RH"],
] as const;
const ATTENDANCE_LABELS: Record<string, string> = {
  late: "Atraso na jornada",
  absence_justified: "Falta justificada",
  absence_unjustified: "Falta injustificada",
  convocation_absence: "Falta de convocação",
  medical_certificate: "Atestado médico",
  warning: "Advertência",
};

type Employee = {
  id: string;
  registration: string | null;
  full_name: string;
  job_title: string | null;
  function_name: string | null;
  function_classification: string | null;
};
type HistoryEvent = {
  event_id: string;
  employee_id: string;
  employee_name: string;
  registration: string | null;
  function_name: string | null;
  source: "attendance" | "hr";
  event_type: string;
  occurred_on: string;
  end_date: string | null;
  occurred_at: string | null;
  days_count: number;
  title: string;
  details: string | null;
  period_start: string | null;
  period_end: string | null;
  created_by_name: string | null;
  created_at: string;
  document_path: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
};

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function acceptedDocument(file: File) {
  return new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]).has(file.type) && file.size <= 10 * 1024 * 1024;
}

function documentExtension(file: File) {
  return file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
}

function eventTypeLabel(event: HistoryEvent) {
  return event.source === "attendance"
    ? ATTENDANCE_LABELS[event.event_type] ?? "Ocorrência de assiduidade"
    : EVENT_TYPES.find(([value]) => value === event.event_type)?.[1] ?? "Registro de RH";
}

function employeeFunction(employee: Employee) {
  const name = employee.function_name?.trim() || employee.job_title?.trim() || "Função não informada";
  return employee.function_classification?.trim() && !name.toLocaleLowerCase("pt-BR").endsWith(employee.function_classification.trim().toLocaleLowerCase("pt-BR"))
    ? `${name} ${employee.function_classification.trim()}`
    : name;
}

export default function EmployeeHistoryPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formType, setFormType] = useState<(typeof EVENT_TYPES)[number][0]>("suspension");
  const [formDate, setFormDate] = useState(localToday);
  const [formEndDate, setFormEndDate] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDetails, setFormDetails] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [voidTarget, setVoidTarget] = useState<HistoryEvent | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [openingDocumentId, setOpeningDocumentId] = useState("");
  const [uploadingDocumentId, setUploadingDocumentId] = useState("");
  const [uploadTarget, setUploadTarget] = useState<HistoryEvent | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const queryRequestRef = useRef(0);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const selectedEmployee = employees.find((employee) => employee.id === employeeId) ?? null;

  useEffect(() => {
    let active = true;
    async function loadEmployees() {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!auth.user || authError) {
        if (active) { setError("Sua sessão expirou. Entre novamente para acessar o histórico do RH."); setLoading(false); }
        return;
      }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id,role").eq("id", auth.user.id).maybeSingle();
      if (profileError || !profile?.organization_id || !["admin", "rh"].includes(profile.role)) {
        if (active) { setError("Esta página está disponível somente para RH e Administradores."); setLoading(false); }
        return;
      }
      const { data, error: employeeError } = await supabase.from("employees").select("id,registration,full_name,job_title,function_name,function_classification").order("full_name");
      if (!active) return;
      if (employeeError) setError("Não foi possível carregar os colaboradores. Confirme se a migração do histórico foi aplicada.");
      else {
        setOrganizationId(profile.organization_id);
        setEmployees((data ?? []) as Employee[]);
      }
      setLoading(false);
    }
    void loadEmployees();
    return () => { active = false; };
  }, []);

  const loadEvents = useCallback(async () => {
    if (!organizationId) return;
    const requestId = ++queryRequestRef.current;
    setLoading(true);
    setError("");
    const supabase = createClient();
    let request = supabase
      .from("employee_hr_history_feed")
      .select("event_id,employee_id,employee_name,registration,function_name,source,event_type,occurred_on,end_date,occurred_at,days_count,title,details,period_start,period_end,created_by_name,created_at,document_path,voided_at,voided_by_name,void_reason", { count: "exact" })
      .eq("organization_id", organizationId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (employeeId) request = request.eq("employee_id", employeeId);
    if (sourceFilter !== "all") request = request.eq("source", sourceFilter);
    if (typeFilter !== "all") request = request.eq("event_type", typeFilter);
    if (dateFrom) request = request.gte("occurred_on", dateFrom);
    if (dateTo) request = request.lte("occurred_on", dateTo);
    const { data, error: queryError, count } = await request;
    if (requestId !== queryRequestRef.current) return;
    if (queryError) setError("Não foi possível carregar o histórico. Confira se a migração foi aplicada e tente atualizar.");
    else {
      setEvents((data ?? []) as HistoryEvent[]);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }, [dateFrom, dateTo, employeeId, organizationId, page, sourceFilter, typeFilter]);

  useEffect(() => {
    void loadEvents();
    return () => { queryRequestRef.current += 1; };
  }, [loadEvents, refreshKey]);

  function resetFilters() {
    setEmployeeId("");
    setSourceFilter("all");
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }

  function openNewRecord() {
    setFormEmployeeId(employeeId);
    setFormType("suspension");
    setFormDate(localToday());
    setFormEndDate("");
    setFormTitle("");
    setFormDetails("");
    setFormFile(null);
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !formEmployeeId || saving) return;
    if (formEndDate && formEndDate < formDate) { setError("A data final não pode ser anterior à data inicial."); return; }
    if (formFile && !acceptedDocument(formFile)) {
      setError("O comprovante deve ser PDF, JPG, PNG ou WEBP de até 10 MB.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    const supabase = createClient();
    const { data, error: insertError } = await supabase.from("employee_hr_records").insert({
      organization_id: organizationId,
      employee_id: formEmployeeId,
      event_type: formType,
      occurred_on: formDate,
      end_date: formEndDate || null,
      title: formTitle.trim(),
      details: formDetails.trim(),
    }).select("id").single();
    if (insertError || !data?.id) {
      setError("Não foi possível registrar a ocorrência. Confira os dados e seu acesso ao RH.");
      setSaving(false);
      return;
    }

    let attachmentMessage = "";
    if (formFile) {
      const path = `${organizationId}/${formEmployeeId}/${data.id}/${crypto.randomUUID()}.${documentExtension(formFile)}`;
      const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, formFile, { contentType: formFile.type, upsert: false });
      if (uploadError) attachmentMessage = " O registro foi salvo, mas o comprovante não foi enviado; você poderá tentar anexá-lo depois.";
      else {
        const { error: pathError } = await supabase.from("employee_hr_records").update({ document_path: path }).eq("id", data.id);
        if (pathError) attachmentMessage = " O registro foi salvo, mas não foi possível vincular o comprovante. Avise o administrador do sistema.";
      }
    }
    setFormOpen(false);
    setFormFile(null);
    setSuccess(`Registro incluído no histórico.${attachmentMessage}`);
    setPage(0);
    setRefreshKey((current) => current + 1);
    setSaving(false);
  }

  async function attachDocument(event: HistoryEvent, file: File) {
    if (!organizationId || uploadingDocumentId) return;
    if (!acceptedDocument(file)) { setError("O comprovante deve ser PDF, JPG, PNG ou WEBP de até 10 MB."); return; }
    setUploadingDocumentId(event.event_id);
    setError("");
    setSuccess("");
    const path = `${organizationId}/${event.employee_id}/${event.event_id}/${crypto.randomUUID()}.${documentExtension(file)}`;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      setError("Não foi possível enviar o comprovante. Confira o arquivo e tente novamente.");
      setUploadingDocumentId("");
      return;
    }
    const { error: pathError } = await supabase.from("employee_hr_records").update({ document_path: path }).eq("id", event.event_id);
    if (pathError) setError("O arquivo foi enviado, mas não foi possível vinculá-lo ao registro. Solicite apoio ao administrador.");
    else {
      setSuccess("Comprovante anexado ao registro.");
      setRefreshKey((current) => current + 1);
    }
    setUploadingDocumentId("");
  }

  async function cancelRecord() {
    if (!voidTarget || saving || voidReason.trim().length < 3) return;
    setSaving(true);
    setError("");
    const { error: updateError } = await createClient().from("employee_hr_records").update({ void_reason: voidReason.trim() }).eq("id", voidTarget.event_id);
    if (updateError) setError("Não foi possível cancelar o registro. Atualize a página e tente novamente.");
    else {
      setSuccess("Registro cancelado e mantido no histórico com o motivo informado.");
      setVoidTarget(null);
      setVoidReason("");
      setRefreshKey((current) => current + 1);
    }
    setSaving(false);
  }

  async function openDocument(event: HistoryEvent) {
    if (!event.document_path || openingDocumentId) return;
    const openedWindow = window.open("about:blank", "_blank");
    if (openedWindow) openedWindow.opener = null;
    setOpeningDocumentId(event.event_id);
    setError("");
    const { data, error: signedUrlError } = await createClient().storage.from(DOCUMENT_BUCKET).createSignedUrl(event.document_path, 300);
    if (signedUrlError || !data?.signedUrl) {
      openedWindow?.close();
      setError("Não foi possível abrir o comprovante. Confira seu acesso ao RH e tente novamente.");
    } else if (openedWindow) openedWindow.location.replace(data.signedUrl);
    else setError("O navegador bloqueou a nova aba. Permita pop-ups para visualizar o comprovante.");
    setOpeningDocumentId("");
  }

  return <main className="module-shell employee-history-page">
    <input ref={attachmentInputRef} className="employee-history-hidden-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Selecionar comprovante" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file && uploadTarget) void attachDocument(uploadTarget, file); }} />
    <header className="module-header employee-history-header">
      <div><p className="eyebrow">RECURSOS HUMANOS</p><h1>Histórico de colaboradores</h1><p className="module-subtitle">Consulte as ocorrências de assiduidade e os registros complementares de RH em uma única linha do tempo.</p></div>
      <button className="primary-button" type="button" onClick={openNewRecord} disabled={!organizationId || loading}><Plus size={16} /> Novo registro de RH</button>
    </header>

    <section className="panel employee-history-intro">
      <div className="employee-history-intro-icon"><History size={21} /></div>
      <div><strong>Assiduidade integrada automaticamente</strong><p>Atrasos, faltas, atestados, faltas de convocação e advertências salvos em “Assiduidade” aparecem aqui sem recadastro. Use “Novo registro de RH” para suspensões, afastamentos formais, elogios e outras ocorrências complementares.</p></div>
      <span className="employee-history-count"><strong>{totalCount}</strong><small>registro(s) encontrado(s)</small></span>
    </section>

    {error && <FeedbackMessage>{error}</FeedbackMessage>}
    {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}

    <section className="panel employee-history-filters" aria-label="Filtros do histórico">
      <div className="employee-history-filter-heading"><div><h2>Filtrar histórico</h2><p>Escolha uma pessoa, tipo de registro ou intervalo de datas.</p></div><button className="text-action" type="button" onClick={resetFilters}>Limpar filtros</button></div>
      <div className="employee-history-filter-grid">
        <label className="employee-history-filter-employee"><span>Colaborador</span><select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setPage(0); }}><option value="">Todos os colaboradores</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}{employee.registration ? ` · ${employee.registration}` : ""}</option>)}</select></label>
        <label><span>Origem</span><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(0); }}><option value="all">Todas</option><option value="attendance">Assiduidade automática</option><option value="hr">Registro complementar de RH</option></select></label>
        <label><span>Tipo</span><select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(0); }}><option value="all">Todos os tipos</option>{Object.entries(ATTENDANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}{EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>De</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(0); }} /></label>
        <label><span>Até</span><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(0); }} /></label>
      </div>
      {selectedEmployee && <div className="employee-history-selected"><UserRound size={16} /><strong>{selectedEmployee.full_name}</strong><span>{selectedEmployee.registration ? `Matrícula ${selectedEmployee.registration}` : "Sem matrícula"}</span><span>{employeeFunction(selectedEmployee)}</span></div>}
    </section>

    <section className="panel employee-history-results" aria-labelledby="employee-history-results-heading">
      <div className="employee-history-results-heading"><div><h2 id="employee-history-results-heading">Linha do tempo</h2><p>Os registros são ordenados pela data da ocorrência; o horário abaixo indica quando o sistema recebeu o lançamento.</p></div><div className="employee-history-results-actions"><span className="employee-history-total">{totalCount} resultado(s)</span><button className="text-action" type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading}><RotateCcw size={14} /> Atualizar</button></div></div>
      {loading ? <div className="employee-history-state"><LoaderCircle size={21} className="spin" /> Carregando histórico...</div>
        : events.length === 0 ? <div className="employee-history-empty"><History size={25} /><strong>Nenhum registro encontrado</strong><span>Quando uma ocorrência for salva em Assiduidade ou um registro de RH for incluído, ela aparecerá aqui.</span></div>
          : <div className="employee-history-list">{events.map((item) => <article className={`employee-history-event ${item.voided_at ? "is-voided" : ""}`} key={`${item.source}-${item.event_id}`}>
            <div className="employee-history-event-date"><CalendarDays size={16} /><strong>{formatDate(item.occurred_on)}</strong>{item.end_date && <small>até {formatDate(item.end_date)}</small>}</div>
            <div className="employee-history-event-main">
              <div className="employee-history-event-heading"><div><h3>{item.title}</h3><p>{item.employee_name}{item.registration ? ` · Matrícula ${item.registration}` : ""}{item.function_name ? ` · ${item.function_name}` : ""}</p></div><span className={`employee-history-source source-${item.source}`}>{item.source === "attendance" ? "Assiduidade" : "RH"}</span></div>
              <div className="employee-history-event-meta">
                <span>{eventTypeLabel(item)}</span>
                {item.occurred_at && <span><Clock3 size={13} /> {item.occurred_at.slice(0, 5)}</span>}
                {item.source === "attendance" && item.days_count > 1 && <span>{item.days_count} dias</span>}
                {item.period_start && item.period_end && <span>Período {formatDate(item.period_start)}–{formatDate(item.period_end)}</span>}
              </div>
              {item.details && <p className="employee-history-event-details">{item.details}</p>}
              {item.voided_at && <div className="employee-history-void-note"><strong>Cancelado{item.voided_by_name ? ` por ${item.voided_by_name}` : ""} · {formatDateTime(item.voided_at)}</strong><span>{item.void_reason}</span></div>}
              <div className="employee-history-event-footer"><span>{item.created_by_name ? `Lançado por ${item.created_by_name}` : "Responsável não identificado em registros antigos"} · {formatDateTime(item.created_at)}</span><div>
                {item.document_path && <button className="text-action" type="button" onClick={() => void openDocument(item)} disabled={openingDocumentId !== ""}><Download size={14} /> {openingDocumentId === item.event_id ? "Abrindo..." : "Ver comprovante"}</button>}
                {item.source === "hr" && !item.document_path && !item.voided_at && <button className="text-action" type="button" onClick={() => { setUploadTarget(item); attachmentInputRef.current?.click(); }} disabled={uploadingDocumentId !== ""}>{uploadingDocumentId === item.event_id ? "Enviando..." : <><Paperclip size={14} /> Anexar comprovante</>}</button>}
                {item.source === "hr" && !item.voided_at && <button className="employee-history-cancel-button" type="button" onClick={() => { setVoidTarget(item); setVoidReason(""); }}><X size={14} /> Cancelar registro</button>}
              </div></div>
            </div>
          </article>)}</div>}
      {!loading && totalCount > PAGE_SIZE && <div className="employee-history-pagination"><span>Página {page + 1} de {pageCount}</span><div><button className="secondary-button" type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}><ChevronLeft size={16} /> Anterior</button><button className="secondary-button" type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page + 1 >= pageCount}>Próxima <ChevronRight size={16} /></button></div></div>}
    </section>

    {formOpen && <div className="employee-history-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}>
      <section className="employee-history-modal" role="dialog" aria-modal="true" aria-labelledby="employee-history-form-title" onKeyDown={(event) => { if (event.key === "Escape" && !saving) setFormOpen(false); }}>
        <div className="employee-history-modal-heading"><div><span className="eyebrow">REGISTRO COMPLEMENTAR</span><h2 id="employee-history-form-title">Novo registro de RH</h2><p>Inclua fatos que não foram registrados na tela de Assiduidade.</p></div><button className="icon-button" type="button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Fechar formulário"><X size={19} /></button></div>
        <form onSubmit={(event) => void createRecord(event)}>
          <label><span>Colaborador</span><select required value={formEmployeeId} onChange={(event) => setFormEmployeeId(event.target.value)}><option value="">Selecione um colaborador</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}{employee.registration ? ` · ${employee.registration}` : ""}</option>)}</select></label>
          <div className="employee-history-form-grid"><label><span>Tipo de registro</span><select value={formType} onChange={(event) => setFormType(event.target.value as (typeof EVENT_TYPES)[number][0])}>{EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Data inicial</span><input type="date" required value={formDate} onChange={(event) => setFormDate(event.target.value)} /></label><label><span>Data final (se aplicável)</span><input type="date" min={formDate} value={formEndDate} onChange={(event) => setFormEndDate(event.target.value)} /></label></div>
          <label><span>Título</span><input required minLength={2} maxLength={160} value={formTitle} onChange={(event) => setFormTitle(event.target.value)} placeholder="Ex.: Suspensão disciplinar — 1 dia" /></label>
          <label><span>Descrição / observações</span><textarea maxLength={4000} rows={4} value={formDetails} onChange={(event) => setFormDetails(event.target.value)} placeholder="Registre o contexto e informações relevantes, sem incluir dados desnecessários." /></label>
          <label className="employee-history-file-field"><span>Comprovante (opcional)</span><span className="employee-history-file-picker"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFormFile(event.target.files?.[0] ?? null)} /><Paperclip size={16} /><span>{formFile?.name || "Escolher PDF ou imagem (máx. 10 MB)"}</span></span><small>Arquivo privado, visível somente para perfis RH e Administrador.</small></label>
          <div className="employee-history-duplicate-note"><ShieldCheck size={16} /><span>Faltas e advertências lançadas em Assiduidade já entram automaticamente no histórico. Não as registre novamente aqui.</span></div>
          {error && <FeedbackMessage>{error}</FeedbackMessage>}
          <div className="employee-history-modal-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button><button className="primary-button" type="submit" disabled={saving || !formEmployeeId || !formTitle.trim()}>{saving ? <><LoaderCircle size={15} className="spin" /> Salvando...</> : <><Plus size={15} /> Salvar registro</>}</button></div>
        </form>
      </section>
    </div>}

    {voidTarget && <div className="employee-history-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setVoidTarget(null); }}>
      <section className="employee-history-modal employee-history-void-modal" role="dialog" aria-modal="true" aria-labelledby="employee-history-void-title" onKeyDown={(event) => { if (event.key === "Escape" && !saving) setVoidTarget(null); }}>
        <div className="employee-history-modal-heading"><div><span className="eyebrow">PRESERVAÇÃO DO HISTÓRICO</span><h2 id="employee-history-void-title">Cancelar registro?</h2><p>O lançamento não será apagado; ficará identificado como cancelado.</p></div><button className="icon-button" type="button" onClick={() => setVoidTarget(null)} disabled={saving} aria-label="Fechar confirmação"><X size={19} /></button></div>
        <label><span>Motivo do cancelamento</span><textarea rows={3} maxLength={500} minLength={3} required value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Explique por que este registro está sendo cancelado." /></label>
        {error && <FeedbackMessage>{error}</FeedbackMessage>}
        <div className="employee-history-modal-actions"><button className="secondary-button" type="button" onClick={() => setVoidTarget(null)} disabled={saving}>Manter registro</button><button className="employee-history-confirm-cancel" type="button" onClick={() => void cancelRecord()} disabled={saving || voidReason.trim().length < 3}>{saving ? "Cancelando..." : "Confirmar cancelamento"}</button></div>
      </section>
    </div>}
  </main>;
}
