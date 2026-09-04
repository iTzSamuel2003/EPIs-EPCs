"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmployeeNavigation } from "@/components/employee-navigation";
import { createClient } from "@/lib/supabase/client";

type Course = { id: string; name: string; provider: string | null; completed_at: string | null; expires_at: string | null; certificate_number: string | null };
const emptyCourse = { name: "", provider: "", completed_at: "", expires_at: "", certificate_number: "" };

export default function EmployeeCoursesPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [course, setCourse] = useState(emptyCourse);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => { void load(); }, [id]);
  async function load() {
    const supabase = createClient();
    const [{ data: employee }, { data, error: loadError }] = await Promise.all([
      supabase.from("employees").select("full_name").eq("id", id).single(),
      supabase.from("employee_courses").select("id,name,provider,completed_at,expires_at,certificate_number").eq("employee_id", id).order("expires_at", { ascending: true, nullsFirst: false }),
    ]);
    if (loadError) setError(loadError.message);
    setName(employee?.full_name ?? "");
    setCourses((data ?? []) as Course[]);
    setLoading(false);
  }
  async function addCourse(event: FormEvent) {
    event.preventDefault();
    if (!course.name.trim()) return;
    setSaving(true); setError(""); setSuccess("");
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", auth.user?.id ?? "").single();
    const { error: saveError } = await supabase.from("employee_courses").insert({ ...course, name: course.name.trim(), provider: course.provider.trim() || null, certificate_number: course.certificate_number.trim() || null, completed_at: course.completed_at || null, expires_at: course.expires_at || null, employee_id: id, organization_id: profile?.organization_id });
    if (saveError) setError(saveError.message);
    else { setCourse(emptyCourse); await load(); setSuccess("Curso adicionado à ficha."); }
    setSaving(false);
  }
  async function removeCourse(courseId: string) {
    const { error: removeError } = await createClient().from("employee_courses").delete().eq("id", courseId);
    if (removeError) setError(removeError.message);
    else setCourses((current) => current.filter((item) => item.id !== courseId));
  }
  if (loading) return <main className="module-shell"><div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando cursos...</div></main>;
  return <main className="module-shell"><header className="module-header"><div><Link className="employee-back-link" href="/employees"><ArrowLeft size={14} /> Funcionários</Link><p className="eyebrow">PERFIL DO COLABORADOR</p><h1>Cursos</h1><p className="module-subtitle">Cursos e treinamentos cadastrados para {name}.</p></div><div className="employee-header-tools"><EmployeeNavigation id={id} current="courses" /></div></header>{success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="panel edit-employee-card"><div className="form-section-title"><h2>Novo curso ou treinamento</h2><p>Registre capacitações e vencimentos para consulta na ficha.</p></div><form className="material-form" onSubmit={addCourse}><div className="form-grid three"><label>Nome do curso<input value={course.name} onChange={(event) => setCourse({ ...course, name: event.target.value })} placeholder="NR-10, NR-35..." required /></label><label>Instituição<input value={course.provider} onChange={(event) => setCourse({ ...course, provider: event.target.value })} /></label><label>Certificado<input value={course.certificate_number} onChange={(event) => setCourse({ ...course, certificate_number: event.target.value })} /></label></div><div className="form-grid two"><label>Conclusão<input type="date" value={course.completed_at} onChange={(event) => setCourse({ ...course, completed_at: event.target.value })} /></label><label>Validade<input type="date" value={course.expires_at} onChange={(event) => setCourse({ ...course, expires_at: event.target.value })} /></label></div><button className="secondary-button" disabled={saving}><Plus size={16} /> {saving ? "Salvando..." : "Adicionar curso"}</button></form></section><section className="panel edit-employee-card"><div className="form-section-title"><h2>Cursos cadastrados</h2><p>{courses.length} curso(s) vinculado(s) ao colaborador.</p></div>{courses.length ? <div className="table-wrap"><table><thead><tr><th>CURSO</th><th>INSTITUIÇÃO</th><th>CONCLUSÃO</th><th>VALIDADE</th><th>AÇÕES</th></tr></thead><tbody>{courses.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.certificate_number || "Sem certificado informado"}</small></td><td>{item.provider || "—"}</td><td>{item.completed_at ? new Date(item.completed_at + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td><td>{item.expires_at ? new Date(item.expires_at + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td><td><button className="action-button" type="button" onClick={() => void removeCourse(item.id)}><Trash2 size={14} /> Remover</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>Nenhum curso cadastrado</strong><span>Adicione os treinamentos obrigatórios ou complementares.</span></div>}</section></main>;
}

