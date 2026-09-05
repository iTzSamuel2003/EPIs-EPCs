"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, FileText, GraduationCap, History, LoaderCircle, Pencil, Plus, Ruler, Search, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Employee = { id: string; registration: string | null; full_name: string; cpf: string; job_title: string | null; function_name: string | null; function_classification: string | null; department: string | null; unit: string | null; admission_date: string | null; phone: string | null; email: string | null; status: "active" | "away" | "terminated"; notes: string | null };
type EmployeeForm = { registration: string; full_name: string; cpf: string; cargo_funcao: string; function_classification: string; department: string; unit: string; admission_date: string; phone: string; email: string; status: "active" | "away" | "terminated"; notes: string };

const emptyForm: EmployeeForm = { registration: "", full_name: "", cpf: "", cargo_funcao: "", function_classification: "", department: "", unit: "", admission_date: "", phone: "", email: "", status: "active", notes: "" };
const statusLabels = { active: ["Ativo", "success"], away: ["Afastado", "warning"], terminated: ["Desligado", "danger"] } as const;
const functionLabel = (value: string) => value.replace(/\s+(VI|V|IV|III|II|I)$/i, "");

export default function EmployeesPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadEmployees() {
    setLoading(true);
    const supabase = createClient();
    const { data, error: loadError } = await supabase.from("employees").select("id,registration,full_name,cpf,job_title,function_name,function_classification,department,unit,admission_date,phone,email,status,notes").order("full_name");
    if (loadError) setError(loadError.message); else setEmployees((data ?? []) as Employee[]);
    setLoading(false);
  }

  useEffect(() => { void Promise.resolve().then(() => loadEmployees()); }, []);

  const filtered = employees.filter((employee) => `${employee.full_name} ${employee.registration ?? ""} ${employee.cpf} ${employee.department ?? ""} ${employee.function_name ?? ""} ${employee.function_classification ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || employee.status === statusFilter));
  function update(field: keyof EmployeeForm, value: string) { setForm((current) => ({ ...current, [field]: value })); }

  async function saveEmployee(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    const typedClassification = form.cargo_funcao.match(/\s+(VI|V|IV|III|II|I)$/i)?.[1]?.toUpperCase() ?? "";
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Sua sessão expirou. Entre novamente."); setSaving(false); return; }
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single();
    if (!profile?.organization_id) { setError("Não foi possível identificar a organização do usuário."); setSaving(false); return; }
    const { error: insertError } = await supabase.from("employees").insert({
      organization_id: profile.organization_id, registration: form.registration.trim() || null, full_name: form.full_name.trim(), cpf: form.cpf.trim(),
      job_title: null, function_name: form.cargo_funcao.trim() || null, function_classification: form.function_classification || typedClassification || null, department: form.department.trim() || null, unit: form.unit || null,
      admission_date: form.admission_date || null, phone: form.phone.trim() || null, email: form.email.trim() || null, status: form.status, notes: form.notes.trim() || null,
    });
    if (insertError) setError(insertError.code === "23505" ? "Já existe um funcionário com esta matrícula ou CPF." : insertError.message);
    else { setSuccess("Funcionário cadastrado com sucesso."); setForm(emptyForm); setShowForm(false); await loadEmployees(); }
    setSaving(false);
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CADASTRO DE PESSOAS</p><h1>Funcionários</h1><p className="module-subtitle">Mantenha os colaboradores organizados para registrar entregas e devoluções.</p></div><button className="primary-button" onClick={() => { setForm(emptyForm); setShowForm(true); setError(""); setSuccess(""); }}><Plus size={17} /> Novo funcionário</button></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && !showForm && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, matrícula, CPF ou setor" /></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos os status</option><option value="active">Ativos</option><option value="away">Afastados</option><option value="terminated">Desligados</option></select></section>
    <section className="module-summary"><div><strong>{employees.length}</strong><span>funcionários cadastrados</span></div><div><strong>{employees.filter((item) => item.status === "active").length}</strong><span>ativos</span></div><div><strong>{employees.filter((item) => item.status === "away").length}</strong><span>afastados</span></div><div><strong>{employees.filter((item) => item.status === "terminated").length}</strong><span>desligados</span></div></section>
    <section className="panel module-table-card employees-table-card"><div className="panel-header"><div><h2>Colaboradores</h2><p>{filtered.length} resultado(s) encontrados</p></div></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando funcionários...</div> : <div className="table-wrap"><table><thead><tr><th>FUNCIONÁRIO</th><th>MATRÍCULA</th><th>CARGO / FUNÇÃO</th><th>SETOR</th><th>UNIDADE</th><th>STATUS</th><th>AÇÕES</th></tr></thead><tbody>{filtered.map((employee) => { const [label, tone] = statusLabels[employee.status]; return <tr key={employee.id}><td><div className="material-cell"><div className="employee-avatar"><UserRound size={16} /></div><div><strong>{employee.full_name}</strong><small>CPF {employee.cpf}</small></div></div></td><td>{employee.registration || <span className="muted-cell">Pendente</span>}</td><td>{employee.job_title || employee.function_name ? <div><strong>{functionLabel(employee.job_title || employee.function_name || "")}</strong>{employee.function_classification && <small>Classe {employee.function_classification}</small>}</div> : <span className="muted-cell">Não informado</span>}</td><td>{employee.department || <span className="muted-cell">Não informado</span>}</td><td>{employee.unit || <span className="muted-cell">Não informada</span>}</td><td><span className={`status-pill ${tone}`}>{label}</span></td><td><div className="row-actions"><button className="action-button" title="Ficha" aria-label="Abrir ficha" onClick={() => router.push(`/employees/${employee.id}`)}><FileText size={16} /></button><button className="action-button" title="Histórico de materiais" aria-label="Abrir histórico de materiais" onClick={() => router.push(`/employees/${employee.id}/history`)}><History size={16} /></button><button className="action-button" title="Editar" aria-label="Editar funcionário" onClick={() => router.push(`/employees/${employee.id}/edit`)}><Pencil size={16} /></button><button className="action-button" title="Medidas" aria-label="Abrir medidas" onClick={() => router.push(`/employees/${employee.id}/profile`)}><Ruler size={16} /></button><button className="action-button" title="Cursos" aria-label="Abrir cursos" onClick={() => router.push(`/employees/${employee.id}/courses`)}><GraduationCap size={16} /></button></div></td></tr>; })}</tbody></table>{!filtered.length && <div className="empty-state"><UserRound size={27} /><strong>Nenhum funcionário encontrado</strong><span>Ajuste os filtros ou cadastre o primeiro colaborador.</span></div>}</div>}</section>
    {showForm && <div className="modal-backdrop"><section className="modal-card"><div className="modal-header"><div><p className="eyebrow">NOVO CADASTRO</p><h2>Cadastrar funcionário</h2></div><button className="close-modal" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveEmployee}><div className="form-section-title"><h2>Dados principais</h2><p>Preencha os mesmos dados disponíveis na edição do colaborador.</p></div><div className="form-grid three"><label>Matrícula<input value={form.registration} onChange={(event) => update("registration", event.target.value)} placeholder="Preencher posteriormente" /></label><label>Nome completo<input value={form.full_name} onChange={(event) => update("full_name", event.target.value)} placeholder="Nome do funcionário" required /></label><label>CPF<input value={form.cpf} onChange={(event) => update("cpf", event.target.value)} placeholder="000.000.000-00" required /></label></div><div className="form-grid two"><label>Cargo/Função<input value={form.cargo_funcao} onChange={(event) => update("cargo_funcao", event.target.value)} placeholder="Cargo ou função" /></label><label>Setor<input value={form.department} onChange={(event) => update("department", event.target.value)} placeholder="Setor" /></label></div><div className="form-section-title"><h2>Localização e contato</h2><p>Unidade e dados complementares do colaborador.</p></div><div className="form-grid three"><label>Unidade<select value={form.unit} onChange={(event) => update("unit", event.target.value)}><option value="">Selecione a unidade</option><option value="Campo Grande">Campo Grande</option><option value="Dourados">Dourados</option><option value="Naviraí">Naviraí</option></select></label><label>Data de admissão<input type="date" value={form.admission_date} onChange={(event) => update("admission_date", event.target.value)} /></label><label>Telefone<input value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="(00) 00000-0000" /></label></div><div className="form-grid two"><label>E-mail<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="funcionario@empresa.com" /></label><label>Status<select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="active">Ativo</option><option value="away">Afastado</option><option value="terminated">Desligado</option></select></label></div><label>Observações<textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Observações internas" rows={3} /></label>{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : "Cadastrar funcionário"}<Plus size={16} /></button></div></form></section></div>}
  </main>;
}
