"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle, Plus, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";
import { getCurrentOrganizationProfile } from "@/lib/organization-context";
import { friendlyError } from "@/lib/ui-feedback";
import { useCurrentUser } from "@/components/app-shell";
import { emptyEmployeeHrPrivateData, EmployeeHrPrivateFields, type EmployeeHrPrivateData } from "@/components/employee-hr-private-fields";

type Employee = { id: string; registration: string | null; full_name: string; cpf?: string; job_title: string | null; function_name: string | null; function_classification: string | null; department: string | null; unit: string | null; admission_date?: string | null; termination_date?: string | null; phone?: string | null; email?: string | null; status: "active" | "away" | "terminated"; notes?: string | null; shirt_size?: string | null; pants_size?: string | null; shoe_size?: string | null; helmet_size?: string | null; glove_size?: string | null };
type EmployeeForm = { registration: string; full_name: string; cpf: string; cargo_funcao: string; function_classification: string; department: string; unit: string; admission_date: string; phone: string; email: string; status: "active" | "away" | "terminated"; notes: string };
type FunctionTemplate = { id: string; name: string; contract_scenario: { source_annex: string } | { source_annex: string }[] | null };
type OperationalBase = { id: string; name: string; is_active: boolean };
type AnnexSetting = { annex_number: string; active: boolean };

const emptyForm: EmployeeForm = { registration: "", full_name: "", cpf: "", cargo_funcao: "", function_classification: "", department: "", unit: "", admission_date: "", phone: "", email: "", status: "active", notes: "" };
const statusLabels = { active: ["Ativo", "success"], away: ["Afastado", "warning"], terminated: ["Desligado", "danger"] } as const;
const functionLabel = (value: string) => value.replace(/\s+(VI|V|IV|III|II|I)$/i, "");
const classificationOptions = ["I", "II", "III", "IV", "V", "VI"];
function normalizeSearch(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function annexNumber(value: string | null | undefined) { return value?.match(/\d{1,2}/)?.[0].padStart(2, "0") ?? null; }
function isAnnexEnabled(sourceAnnex: string | null | undefined, enabledAnnexes: Set<string>) { const number = annexNumber(sourceAnnex); return !number || enabledAnnexes.has(number); }
function templateAnnex(template: Pick<FunctionTemplate, "contract_scenario">) { const scenario = Array.isArray(template.contract_scenario) ? template.contract_scenario[0] : template.contract_scenario; return scenario?.source_annex; }
function isValidCpf(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^([0-9])\1+$/.test(digits)) return false;
  const calculate = (length: number) => {
    const total = digits.slice(0, length).split("").reduce((sum, digit, index) => sum + Number(digit) * (length + 1 - index), 0);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calculate(9) === Number(digits[9]) && calculate(10) === Number(digits[10]);
}
function isValidDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export default function EmployeesPage() {
  const router = useRouter();
  const { role } = useCurrentUser();
  const isTst = role === "tst";
  const canRevealSensitiveData = role === "admin" || role === "rh";
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bases, setBases] = useState<OperationalBase[]>([]);
  const [functionTemplates, setFunctionTemplates] = useState<FunctionTemplate[]>([]);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [privateData, setPrivateData] = useState<EmployeeHrPrivateData>(emptyEmployeeHrPrivateData);
  const [query, setQuery] = useState("");
  const [showSensitiveData, setShowSensitiveData] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(true);

  const loadEmployees = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      if (isTst) {
        const { data, error: loadError } = await supabase.rpc("get_tst_employee_directory", { p_employee_id: null });
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        if (loadError) {
          setEmployees([]);
          setError(friendlyError(loadError, "Não foi possível carregar os funcionários das suas bases."));
        } else {
          setEmployees((data ?? []) as Employee[]);
        }
        setBases([]);
        setFunctionTemplates([]);
        return;
      }
      const [{ data, error: loadError }, { data: templateData, error: templateError }, { data: baseData, error: baseError }, { data: annexSettings, error: annexSettingsError }] = await Promise.all([
        supabase.rpc("get_hr_employee_records", { p_employee_id: null }),
        supabase.from("function_templates").select("id,name,contract_scenario:contract_scenarios(source_annex)").order("name"),
        supabase.from("organization_bases").select("id,name,is_active").order("name"),
        supabase.from("organization_annex_settings").select("annex_number,active"),
      ]);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      if (loadError || baseError) {
        setEmployees([]);
        setFunctionTemplates([]);
        setBases([]);
        setError(friendlyError(loadError ?? baseError, "Não foi possível carregar os dados."));
      }
      else {
        setEmployees((data ?? []) as Employee[]);
        setBases((baseData ?? []) as OperationalBase[]);
        if (templateError || annexSettingsError) {
          setFunctionTemplates([]);
          setError(friendlyError(templateError ?? annexSettingsError, "Não foi possível carregar as funções disponíveis."));
        } else {
          const enabledAnnexes = new Set(((annexSettings ?? []) as AnnexSetting[]).filter((setting) => setting.active).map((setting) => setting.annex_number.trim().match(/\d{1,2}/)?.[0].padStart(2, "0") ?? ""));
          setFunctionTemplates(((templateData ?? []) as FunctionTemplate[]).filter((template) => isAnnexEnabled(templateAnnex(template), enabledAnnexes)));
        }
      }
    } catch (caught) {
      if (mountedRef.current && requestId === loadRequestRef.current) setError(friendlyError(caught, "Não foi possível carregar os dados."));
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) setLoading(false);
    }
  }, [isTst]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(() => loadEmployees());
    return () => { mountedRef.current = false; };
  }, [loadEmployees]);

  useEffect(() => {
    if (!showForm) setPrivateData(emptyEmployeeHrPrivateData);
  }, [showForm]);

  const normalizedQuery = normalizeSearch(query);
  const showCpf = canRevealSensitiveData && showSensitiveData;
  const filtered = employees.filter((employee) => normalizeSearch(`${employee.full_name} ${employee.registration ?? ""} ${showCpf ? employee.cpf ?? "" : ""} ${employee.department ?? ""} ${employee.function_name ?? ""} ${employee.function_classification ?? ""}`).includes(normalizedQuery) && (statusFilter === "all" || employee.status === statusFilter));
  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedEmployees = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [query, statusFilter]);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  function update(field: keyof EmployeeForm, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  function updatePrivateData(field: keyof EmployeeHrPrivateData, value: string) { setPrivateData((current) => ({ ...current, [field]: value })); }

  async function saveEmployee(event: FormEvent) {
    event.preventDefault();
    if (isTst || saving) return;
    setError("");
    setSuccess("");
    if (!form.full_name.trim() || !form.cpf.trim()) {
      setError("Informe o nome completo e o CPF do funcionário.");
      return;
    }
    if (!isValidCpf(form.cpf)) {
      setError("Informe um CPF válido com 11 dígitos.");
      return;
    }
    if (form.admission_date && (!isValidDateValue(form.admission_date) || form.admission_date > new Date().toISOString().slice(0, 10))) {
      setError("Informe uma data de admissão válida e não futura.");
      return;
    }
    if (privateData.birth_date && (!isValidDateValue(privateData.birth_date) || privateData.birth_date > new Date().toISOString().slice(0, 10))) {
      setError("Informe uma data de nascimento válida e não futura.");
      return;
    }
    setSaving(true);
    try {
      const typedClassification = form.cargo_funcao.match(/\s+(VI|V|IV|III|II|I)$/i)?.[1]?.toUpperCase() ?? "";
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sua sessão expirou. Entre novamente.");
      const { data: profile, error: profileError } = await getCurrentOrganizationProfile(supabase, auth.user.id, auth.user.user_metadata?.full_name);
      if (profileError) throw profileError;
      if (!profile?.organization_id) throw new Error("Não foi possível identificar a organização do usuário.");
      const { error: insertError } = await supabase.rpc("create_hr_employee_with_private_data", {
        p_registration: form.registration.trim() || null,
        p_full_name: form.full_name.trim(),
        p_cpf: form.cpf.trim(),
        p_function_name: form.cargo_funcao.trim() || null,
        p_function_classification: form.function_classification || typedClassification || null,
        p_department: form.department.trim() || null,
        p_unit: form.unit || null,
        p_admission_date: form.admission_date || null,
        p_phone: form.phone.trim() || null,
        p_email: form.email.trim() || null,
        p_status: form.status,
        p_notes: form.notes.trim() || null,
        p_birth_date: privateData.birth_date || null,
        p_address: privateData.address.trim() || null,
        p_pis: privateData.pis.trim() || null,
        p_bank_name: privateData.bank_name.trim() || null,
        p_bank_account: privateData.bank_account.trim() || null,
        p_bank_branch: privateData.bank_branch.trim() || null,
        p_marital_status: privateData.marital_status || null,
        p_dependents: privateData.dependents.trim() || null,
        p_emergency_contact_name: privateData.emergency_contact_name.trim() || null,
        p_emergency_contact_phone: privateData.emergency_contact_phone.trim() || null,
      });
      if (insertError) throw insertError;
      setSuccess("Funcionário cadastrado com sucesso."); setForm(emptyForm); setShowForm(false); await loadEmployees();
    } catch (caught) {
      setError(caught && typeof caught === "object" && "code" in caught && caught.code === "23505" ? "Já existe um funcionário com esta matrícula ou CPF." : friendlyError(caught, "Não foi possível salvar as alterações."));
    } finally {
      setSaving(false);
    }
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CADASTRO DE PESSOAS</p><h1>Funcionários</h1><p className="module-subtitle">{isTst ? "Consulte os funcionários das suas bases e os tamanhos cadastrados." : "Mantenha os colaboradores organizados para registrar entregas e devoluções."}</p></div>{!isTst && <div className="header-actions">{canRevealSensitiveData && <button className="secondary-button" type="button" onClick={() => setShowSensitiveData((current) => !current)} aria-controls="employees-table" aria-pressed={showCpf}>{showCpf ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{showCpf ? "Ocultar CPF" : "Exibir CPF"}</button>}<button className="primary-button" onClick={() => { setForm(emptyForm); setShowForm(true); setError(""); setSuccess(""); }}><Plus size={17} /> Novo funcionário</button></div>}</header>
    {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}{error && !showForm && <FeedbackMessage onRetry={() => void loadEmployees()}>{error}</FeedbackMessage>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar funcionários" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isTst || !showCpf ? "Buscar por nome, matrícula ou setor" : "Buscar por nome, matrícula, CPF ou setor"} /></div><select aria-label="Filtrar funcionários por status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos os status</option><option value="active">Ativos</option><option value="away">Afastados</option><option value="terminated">Desligados</option></select></section>
    {!loading && <section className="module-summary"><div><strong>{employees.length}</strong><span>funcionários cadastrados</span></div><div><strong>{employees.filter((item) => item.status === "active").length}</strong><span>ativos</span></div><div><strong>{employees.filter((item) => item.status === "away").length}</strong><span>afastados</span></div><div><strong>{employees.filter((item) => item.status === "terminated").length}</strong><span>desligados</span></div></section>}
    <section className="panel module-table-card employees-table-card">
      <div className="panel-header"><div><h2>Colaboradores</h2><p>{filtered.length} resultado(s) encontrados</p></div></div>
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando funcionários...</div> : (
        <div className="table-wrap">
          <table id="employees-table">
            <thead><tr><th>FUNCIONÁRIO</th><th>MATRÍCULA</th><th>CARGO / FUNÇÃO</th><th>SETOR</th><th>BASE</th><th>STATUS</th></tr></thead>
            <tbody>{paginatedEmployees.map((employee) => {
              const [label, tone] = statusLabels[employee.status];
              const employeeHref = isTst ? `/employees/${employee.id}/profile` : `/employees/${employee.id}`;
              const cpfLabel = showCpf ? employee.cpf || "Não informado" : employee.cpf ? "***.***.***-**" : "Não informado";
              return <tr key={employee.id} className="employee-clickable-row" onClick={() => router.push(employeeHref)}>
                <td><div className="material-cell"><div className="employee-avatar"><UserRound size={16} /></div><div><strong><Link href={employeeHref} className="employee-row-name" onClick={(event) => event.stopPropagation()}>{employee.full_name}</Link></strong>{!isTst && <small>CPF {cpfLabel}</small>}</div></div></td>
                <td>{employee.registration || <span className="muted-cell">Pendente</span>}</td>
                <td>{employee.job_title || employee.function_name ? <div><strong>{functionLabel(employee.job_title || employee.function_name || "")}</strong>{employee.function_classification && <small>Classe {employee.function_classification}</small>}</div> : <span className="muted-cell">Não informado</span>}</td>
                <td>{employee.department || <span className="muted-cell">Não informado</span>}</td>
                <td>{employee.unit || <span className="muted-cell">Sem base atribuída</span>}</td>
                <td><span className={`status-pill ${tone}`}>{label}</span></td>
              </tr>;
            })}</tbody>
          </table>
          {!filtered.length && <div className="empty-state"><UserRound size={27} /><strong>Nenhum funcionário encontrado</strong><span>Ajuste os filtros ou cadastre o primeiro colaborador.</span></div>}
          {filtered.length > 0 && <nav className="pagination-controls" aria-label="Paginação de funcionários"><span>Mostrando {(page - 1) * pageSize + 1} – {Math.min(page * pageSize, filtered.length)} de {filtered.length} · Página {page} de {pageCount}</span><div><button className="secondary-button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><button className="secondary-button" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Próxima</button></div></nav>}
        </div>
      )}
    </section>
    {showForm && <div className="modal-backdrop"><section className="modal-card employee-create-modal" role="dialog" aria-modal="true" aria-label="Cadastro de funcionário"><div className="modal-header"><div><p className="eyebrow">NOVO CADASTRO</p><h2>Cadastrar funcionário</h2></div><button type="button" className="close-modal" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveEmployee}><div className="form-section-title"><h2>Dados principais</h2><p>Preencha os mesmos dados disponíveis na edição do colaborador.</p></div><div className="form-grid three"><label>Matrícula<input value={form.registration} onChange={(event) => update("registration", event.target.value)} placeholder="Preencher posteriormente" /></label><label>Nome completo<input value={form.full_name} onChange={(event) => update("full_name", event.target.value)} placeholder="Nome do funcionário" required /></label><label>CPF<input value={form.cpf} onChange={(event) => update("cpf", event.target.value)} placeholder="000.000.000-00" required /></label></div><div className="form-grid three"><label>Função<select value={form.cargo_funcao} onChange={(event) => update("cargo_funcao", event.target.value)}><option value="">Selecione a função</option>{functionTemplates.map((template) => <option key={template.id} value={template.name}>{functionLabel(template.name)}</option>)}</select></label><label>Classificação<select value={form.function_classification} onChange={(event) => update("function_classification", event.target.value)}><option value="">Sem classificação</option>{classificationOptions.map((classification) => <option key={classification} value={classification}>{classification}</option>)}</select></label><label>Setor<input value={form.department} onChange={(event) => update("department", event.target.value)} placeholder="Setor" /></label></div><div className="form-section-title"><h2>Base e contato</h2><p>A base define a localização operacional e o estoque utilizado pelo colaborador.</p></div><div className="form-grid three"><label>Base operacional<select value={form.unit} onChange={(event) => update("unit", event.target.value)}><option value="">Sem base atribuída</option>{bases.filter((base) => base.is_active).map((base) => <option key={base.id} value={base.name}>{base.name}</option>)}</select></label><label>Data de admissão<input type="date" value={form.admission_date} onChange={(event) => update("admission_date", event.target.value)} /></label><label>Telefone<input value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="(00) 00000-0000" /></label></div><div className="form-grid two"><label>E-mail<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="funcionario@empresa.com" /></label><label>Status<select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="active">Ativo</option><option value="away">Afastado</option><option value="terminated">Desligado</option></select></label></div><label>Observações<textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Observações internas" rows={3} /></label>{canRevealSensitiveData && <EmployeeHrPrivateFields value={privateData} onChange={updatePrivateData} />}{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Cadastrar funcionário"}<Plus size={16} /></button></div></form></section></div>}
  </main>;
}
