"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, Download, LoaderCircle, PackageCheck, Printer, ShieldCheck, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EmployeeNavigation } from "@/components/employee-navigation";

type Employee = { id: string; registration: string | null; full_name: string; cpf: string; job_title: string | null; department: string | null; unit: string | null };
type Item = { id: string; quantity: number; expected_replacement_at: string | null; material: { name: string; internal_code: string | null; unit: string } | null; lot: { lot_number: string } | null; delivery: { delivered_at: string; reason: string } | null };
type Profile = { shirt_size: string | null; pants_size: string | null; shoe_size: string | null; helmet_size: string | null; glove_size: string | null };
type Course = { id: string; name: string; provider: string | null; expires_at: string | null };

const reasonLabels: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
function date(value: string | null) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "—"; }
function replacementStatus(value: string | null) {
  if (!value) return { label: "Sem previsão", tone: "neutral" };
  const days = Math.ceil((new Date(`${value}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days < 0) return { label: "Troca vencida", tone: "danger" };
  if (days <= 30) return { label: "Troca próxima", tone: "warning" };
  return { label: "Em dia", tone: "success" };
}

export default function EmployeeMaterialsPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: employeeData, error: employeeError }, { data: deliveryData, error: deliveryError }, { data: profileData }, { data: courseData }] = await Promise.all([
        supabase.from("employees").select("id,registration,full_name,cpf,job_title,department,unit").eq("id", id).single(),
        supabase.from("delivery_items").select("id,quantity,expected_replacement_at,materials(name,internal_code,unit),material_lots(lot_number),deliveries!inner(delivered_at,reason,employee_id)").eq("deliveries.employee_id", id).order("created_at", { ascending: false }),
        supabase.from("employee_profiles").select("shirt_size,pants_size,shoe_size,helmet_size,glove_size").eq("employee_id", id).maybeSingle(),
        supabase.from("employee_courses").select("id,name,provider,expires_at").eq("employee_id", id).order("expires_at", { ascending: true, nullsFirst: false }),
      ]);
      if (employeeError || deliveryError) setError(employeeError?.message ?? deliveryError?.message ?? "Não foi possível carregar a ficha.");
      setEmployee(employeeData as Employee);
      setProfile(profileData as Profile | null);
      setCourses((courseData ?? []) as Course[]);
      setItems(((deliveryData ?? []) as unknown[]).map((row) => {
        const value = row as Record<string, unknown>;
        return { id: String(value.id), quantity: Number(value.quantity), expected_replacement_at: value.expected_replacement_at as string | null, material: value.materials as Item["material"], lot: value.material_lots as Item["lot"], delivery: value.deliveries as Item["delivery"] };
      }));
      setLoading(false);
    }
    void load();
  }, [id]);

  const summary = useMemo(() => {
    const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);
    const pending = items.filter((item) => replacementStatus(item.expected_replacement_at).tone !== "success" && item.expected_replacement_at).length;
    return { totalQuantity, pending };
  }, [items]);

  if (loading) return <main className="module-shell"><div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando ficha...</div></main>;
  if (error || !employee) return <main className="module-shell"><div className="feedback error-feedback"><X size={17} /> {error || "Funcionário não encontrado."}</div><Link className="secondary-button" href="/employees"><ArrowLeft size={16} /> Funcionários</Link></main>;

  return <main className="module-shell employee-sheet">
    <header className="module-header no-print"><div><p className="eyebrow">CONTROLE INDIVIDUAL</p><h1>Ficha de materiais entregues</h1><p className="module-subtitle">Histórico de responsabilidade, reposições previstas e treinamentos do colaborador.</p></div><div className="header-actions"><EmployeeNavigation id={id} current="sheet" /><button className="secondary-button" onClick={() => window.print()}><Printer size={16} /> Imprimir</button><button className="primary-button" onClick={() => window.print()}><Download size={16} /> Salvar em PDF</button></div></header>
    <section className="panel sheet-card enhanced-sheet">
      <div className="sheet-brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>EPIS<span>+</span></strong><small>Ficha de entrega e responsabilidade de materiais</small></div><div className="sheet-document"><span>DOCUMENTO INDIVIDUAL</span><strong>Emitida em {new Date().toLocaleDateString("pt-BR")}</strong></div></div>
      <section className="sheet-employee-heading"><div className="sheet-person-icon"><UserRound size={23} /></div><div><p>COLABORADOR</p><h2>{employee.full_name}</h2><span>{employee.job_title || "Função não informada"} · {employee.department || "Setor não informado"}</span></div><div className="sheet-unit"><span>UNIDADE</span><strong>{employee.unit || "Não informada"}</strong></div></section>
      <div className="employee-summary sheet-details"><div><span>Matrícula</span><strong>{employee.registration || "—"}</strong></div><div><span>CPF</span><strong>{employee.cpf || "—"}</strong></div><div><span>Setor</span><strong>{employee.department || "—"}</strong></div><div><span>Função</span><strong>{employee.job_title || "—"}</strong></div></div>
      <section className="sheet-metrics"><div><PackageCheck size={18} /><span><strong>{items.length}</strong> materiais distintos</span></div><div><PackageCheck size={18} /><span><strong>{summary.totalQuantity}</strong> itens entregues</span></div><div className={summary.pending ? "attention" : ""}><CalendarClock size={18} /><span><strong>{summary.pending}</strong> troca(s) a acompanhar</span></div></section>
      {profile && <section className="sheet-section measurements-section"><div className="sheet-section-heading"><div><p>MEDIDAS INDIVIDUAIS</p><h2>Referência para equipamentos e uniformes</h2></div></div><div className="sheet-measurements"><div><span>Uniforme</span><strong>{profile.shirt_size || "Não informado"}</strong></div><div><span>Calça</span><strong>{profile.pants_size || "Não informado"}</strong></div><div><span>Botina</span><strong>{profile.shoe_size || "Não informado"}</strong></div><div><span>Capacete</span><strong>{profile.helmet_size || "Não informado"}</strong></div><div><span>Luvas</span><strong>{profile.glove_size || "Não informado"}</strong></div></div></section>}
      <section className="sheet-section"><div className="sheet-section-heading"><div><p>MATERIAIS EM RESPONSABILIDADE</p><h2>Entregas registradas</h2><span>{items.length} registro(s) vinculado(s) ao colaborador</span></div></div>{items.length ? <div className="table-wrap sheet-table-wrap"><table><thead><tr><th>MATERIAL</th><th>LOTE</th><th>QTD.</th><th>ENTREGA</th><th>PREVISÃO DE TROCA</th><th>STATUS</th><th>MOTIVO</th></tr></thead><tbody>{items.map((item) => { const status = replacementStatus(item.expected_replacement_at); return <tr key={item.id}><td><strong>{item.material?.name || "Material"}</strong><small>{item.material?.internal_code ? `${item.material.internal_code} · ${item.material.unit}` : item.material?.unit}</small></td><td>{item.lot?.lot_number || "—"}</td><td><strong>{item.quantity}</strong></td><td>{date(item.delivery?.delivered_at ?? null)}</td><td>{date(item.expected_replacement_at)}</td><td><span className={`status-pill ${status.tone}`}>{status.tone !== "success" && status.tone !== "neutral" && <AlertTriangle size={11} />}{status.label}</span></td><td>{reasonLabels[item.delivery?.reason ?? ""] || "—"}</td></tr>; })}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum material entregue</strong><span>Este colaborador ainda não possui entregas registradas.</span></div>}</section>
      {courses.length > 0 && <section className="sheet-courses"><div className="sheet-section-heading"><div><p>CAPACITAÇÕES</p><h2>Cursos e treinamentos</h2></div></div>{courses.map((course) => <div key={course.id}><strong>{course.name}</strong><span>{course.provider || "Instituição não informada"}{course.expires_at ? ` · validade ${date(course.expires_at)}` : ""}</span></div>)}</section>}
      <section className="sheet-declaration"><ShieldCheck size={19} /><p>Declaro que recebi os materiais relacionados nesta ficha, em condições adequadas de uso, e que fui orientado sobre sua utilização, guarda e devolução.</p></section>
      <div className="sheet-signatures"><div><strong>Assinatura do colaborador</strong><span>{employee.full_name}</span></div><div><strong>Responsável pela entrega / controle</strong><span>EPIS+ Gestão de equipamentos</span></div></div>
    </section>
  </main>;
}
