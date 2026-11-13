"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Save, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";
import { EmployeeNavigation } from "@/components/employee-navigation";
import { emptyEmployeeHrPrivateData, EmployeeHrPrivateFields, type EmployeeHrPrivateData } from "@/components/employee-hr-private-fields";

type FunctionTemplate = { id: string; name: string; contract_scenario: { source_annex: string } | { source_annex: string }[] | null };
type EmployeeForm = { registration: string; full_name: string; cpf: string; cargo_funcao: string; function_classification: string; department: string; unit: string; admission_date: string; termination_date: string; phone: string; email: string; status: "active" | "away" | "terminated"; notes: string } & EmployeeHrPrivateData;
type AnnexSetting = { annex_number: string; active: boolean };
const emptyForm: EmployeeForm = { registration: "", full_name: "", cpf: "", cargo_funcao: "", function_classification: "", department: "", unit: "", admission_date: "", termination_date: "", phone: "", email: "", status: "active", notes: "", ...emptyEmployeeHrPrivateData };
const classificationOptions = ["I", "II", "III", "IV", "V", "VI"];
const functionLabel = (value: string) => value.replace(/\s+(VI|V|IV|III|II|I)$/i, "");
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

export default function EditEmployeePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [functionTemplates, setFunctionTemplates] = useState<FunctionTemplate[]>([]);
  const [currentFunctionInactive, setCurrentFunctionInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const loadVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const version = ++loadVersion.current;
    async function load() {
      setLoading(true); setError("");
      try {
        const supabase = createClient();
        const [{ data, error: employeeError }, { data: privateData, error: privateDataError }, { data: templateData, error: templateError }, { data: annexSettings, error: annexSettingsError }] = await Promise.all([
          supabase.rpc("get_hr_employee_records", { p_employee_id: params.id }),
          supabase.rpc("get_hr_employee_private_data", { p_employee_id: params.id }),
          supabase.from("function_templates").select("id,name,contract_scenario:contract_scenarios(source_annex)").order("name"),
          supabase.from("organization_annex_settings").select("annex_number,active"),
        ]);
        if (!active || version !== loadVersion.current) return;
        if (employeeError || !data?.[0]) { setError(friendlyError(employeeError, "Não foi possível carregar os dados do funcionário.")); return; }
        if (privateDataError) { setError(friendlyError(privateDataError, "Não foi possível carregar os dados restritos do RH.")); return; }
        const employee = data[0];
        const privateEmployee = privateData?.[0] ?? {};
        // A lista de funções é auxiliar; uma falha nela não bloqueia a edição.
        if (templateError || annexSettingsError) {
          setFunctionTemplates([]);
          setCurrentFunctionInactive(false);
          setError(friendlyError(templateError ?? annexSettingsError, "Não foi possível carregar as funções disponíveis."));
        } else {
          const enabledAnnexes = new Set(((annexSettings ?? []) as AnnexSetting[]).filter((setting) => setting.active).map((setting) => setting.annex_number.trim().match(/\d{1,2}/)?.[0].padStart(2, "0") ?? ""));
          const templates = (templateData ?? []) as FunctionTemplate[];
          const currentFunction = employee.job_title || employee.function_name || "";
          const currentTemplate = templates.find((template) => template.name === currentFunction);
          setCurrentFunctionInactive(Boolean(currentTemplate && !isAnnexEnabled(templateAnnex(currentTemplate), enabledAnnexes)));
          setFunctionTemplates(templates.filter((template) => isAnnexEnabled(templateAnnex(template), enabledAnnexes)));
        }
        setForm({ ...emptyForm, registration: employee.registration ?? "", full_name: employee.full_name, cpf: employee.cpf, cargo_funcao: employee.job_title || employee.function_name || "", function_classification: employee.function_classification ?? "", department: employee.department ?? "", unit: employee.unit ?? "", admission_date: employee.admission_date ?? "", termination_date: employee.termination_date ?? "", phone: employee.phone ?? "", email: employee.email ?? "", status: employee.status, notes: employee.notes ?? "", birth_date: privateEmployee.birth_date ?? "", address: privateEmployee.address ?? "", pis: privateEmployee.pis ?? "", bank_name: privateEmployee.bank_name ?? "", bank_account: privateEmployee.bank_account ?? "", bank_branch: privateEmployee.bank_branch ?? "", marital_status: privateEmployee.marital_status ?? "", dependents: privateEmployee.dependents ?? "", emergency_contact_name: privateEmployee.emergency_contact_name ?? "", emergency_contact_phone: privateEmployee.emergency_contact_phone ?? "" });
      } catch (caught) {
        if (active && version === loadVersion.current) setError(friendlyError(caught, "Não foi possível carregar os dados do funcionário."));
      } finally {
        if (active && version === loadVersion.current) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [params.id, retryKey]);

  function update(field: keyof EmployeeForm, value: string) { setForm((current) => ({ ...current, [field]: value })); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(""); setSuccess("");
    if (!form.full_name.trim()) { setError("Informe o nome completo do funcionário."); return; }
    if (!isValidCpf(form.cpf)) { setError("Informe um CPF válido com 11 dígitos."); return; }
    if (form.admission_date && (!isValidDateValue(form.admission_date) || form.admission_date > new Date().toISOString().slice(0, 10))) { setError("Informe uma data de admissão válida e não futura."); return; }
    if (form.birth_date && (!isValidDateValue(form.birth_date) || form.birth_date > new Date().toISOString().slice(0, 10))) { setError("Informe uma data de nascimento válida e não futura."); return; }
    if (form.status === "terminated" && !form.termination_date) { setError("Informe a data de desligamento do funcionário."); return; }
    if (form.termination_date && (!isValidDateValue(form.termination_date) || form.termination_date > new Date().toISOString().slice(0, 10) || (form.admission_date && form.termination_date < form.admission_date))) { setError("Informe uma data de desligamento válida, após a admissão e não futura."); return; }
    setSaving(true);
    try {
      const { error: updateError } = await createClient().rpc("update_hr_employee_with_private_data", {
        p_employee_id: params.id,
        p_registration: form.registration.trim() || null,
        p_full_name: form.full_name.trim(),
        p_cpf: form.cpf.trim(),
        p_function_name: form.cargo_funcao.trim() || null,
        p_function_classification: form.function_classification || null,
        p_department: form.department.trim() || null,
        p_unit: form.unit || null,
        p_admission_date: form.admission_date || null,
        p_termination_date: form.termination_date || null,
        p_phone: form.phone.trim() || null,
        p_email: form.email.trim() || null,
        p_status: form.status,
        p_notes: form.notes.trim() || null,
        p_birth_date: form.birth_date || null,
        p_address: form.address.trim() || null,
        p_pis: form.pis.trim() || null,
        p_bank_name: form.bank_name.trim() || null,
        p_bank_account: form.bank_account.trim() || null,
        p_bank_branch: form.bank_branch.trim() || null,
        p_marital_status: form.marital_status || null,
        p_dependents: form.dependents.trim() || null,
        p_emergency_contact_name: form.emergency_contact_name.trim() || null,
        p_emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      });
      if (updateError) setError(updateError.code === "23505" ? "Já existe um funcionário com esta matrícula ou CPF." : friendlyError(updateError, "Não foi possível salvar as alterações. Verifique suas permissões."));
      else { setSuccess("Funcionário atualizado com sucesso."); window.setTimeout(() => router.push("/employees"), 500); }
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível salvar as alterações."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="module-shell"><div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando funcionário...</div></main>;
  if (error && !form.full_name) return <main className="module-shell"><section className="panel runtime-error-card"><FeedbackMessage onRetry={() => { setError(""); setRetryKey((current) => current + 1); }}>{error}</FeedbackMessage></section><Link className="secondary-button" href="/employees"><ArrowLeft size={16} /> Funcionários</Link></main>;
  const functionOptions = functionTemplates.some((template) => template.name === form.cargo_funcao) ? functionTemplates : form.cargo_funcao ? [...functionTemplates, { id: "current", name: form.cargo_funcao, contract_scenario: null }] : functionTemplates;

  return <main className="module-shell"><header className="module-header"><div><Link className="employee-back-link" href="/employees"><ArrowLeft size={14} /> Funcionários</Link><p className="eyebrow">CADASTRO DE PESSOAS</p><h1>Editar funcionário</h1><p className="module-subtitle">Atualize as informações cadastrais do colaborador.</p></div><div className="employee-header-tools"><EmployeeNavigation id={params.id} current="edit" /></div></header>{success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="panel edit-employee-card"><form className="material-form" onSubmit={save}><div className="form-section-title"><h2>Dados principais</h2><p>Informações de identificação e vínculo.</p></div><div className="form-grid three"><label>Matrícula<input value={form.registration} onChange={(event) => update("registration", event.target.value)} /></label><label>Nome completo<input value={form.full_name} onChange={(event) => update("full_name", event.target.value)} required /></label><label>CPF<input value={form.cpf} onChange={(event) => update("cpf", event.target.value)} required /></label></div><div className="form-grid three"><label>Função<select value={form.cargo_funcao} onChange={(event) => update("cargo_funcao", event.target.value)}><option value="">Selecione a função</option>{functionOptions.map((template) => <option key={template.id} value={template.name} disabled={template.id === "current" && currentFunctionInactive}>{functionLabel(template.name)}{template.id === "current" && currentFunctionInactive ? " · anexo inativo (atual)" : ""}</option>)}</select></label><label>Classificação<select value={form.function_classification} onChange={(event) => update("function_classification", event.target.value)}><option value="">Sem classificação</option>{classificationOptions.map((classification) => <option key={classification} value={classification}>{classification}</option>)}</select></label><label>Setor<input value={form.department} onChange={(event) => update("department", event.target.value)} /></label></div><div className="form-section-title"><h2>Localização e contato</h2><p>Unidade e dados complementares do colaborador.</p></div><div className="form-grid three"><label>Unidade<select value={form.unit} onChange={(event) => update("unit", event.target.value)}><option value="">Selecione a unidade</option><option value="Campo Grande">Campo Grande</option><option value="Dourados">Dourados</option><option value="Naviraí">Naviraí</option></select></label><label>Data de admissão<input type="date" value={form.admission_date} onChange={(event) => update("admission_date", event.target.value)} /></label>{form.status === "terminated" && <label>Data de desligamento<input type="date" value={form.termination_date} onChange={(event) => update("termination_date", event.target.value)} required /></label>}<label>Telefone<input value={form.phone} onChange={(event) => update("phone", event.target.value)} /></label></div><div className="form-grid two"><label>E-mail<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label><label>Status<select value={form.status} onChange={(event) => update("status", event.target.value as EmployeeForm["status"])}><option value="active">Ativo</option><option value="away">Afastado</option><option value="terminated">Desligado</option></select></label></div><label>Observações<textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} rows={4} /></label><EmployeeHrPrivateFields value={form} onChange={update} /><div className="modal-actions"><Link className="secondary-button" href="/employees">Cancelar</Link><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}<Save size={16} /></button></div></form></section></main>;
}
