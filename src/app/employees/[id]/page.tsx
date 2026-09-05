"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, Check, Download, LoaderCircle, PackageCheck, ShieldCheck, Upload, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { jsPDF } from "jspdf";
import { createClient } from "@/lib/supabase/client";
import { EmployeeNavigation } from "@/components/employee-navigation";
import { DeliverySignatureModal } from "@/components/delivery-signature-modal";

type Employee = { id: string; registration: string | null; full_name: string; cpf: string; job_title: string | null; department: string | null; unit: string | null };
type Item = { id: string; quantity: number; expected_replacement_at: string | null; material: { name: string; internal_code: string | null; unit: string } | null; lot: { lot_number: string } | null; delivery: { id: string; delivered_at: string; reason: string; term_file_path: string | null; term_uploaded_at: string | null; term_signature_method: string | null } | null };
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
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadingId, setUploadingId] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: employeeData, error: employeeError }, { data: deliveryData, error: deliveryError }, { data: courseData }] = await Promise.all([
        supabase.from("employees").select("id,registration,full_name,cpf,job_title,department,unit").eq("id", id).single(),
        supabase.from("delivery_items").select("id,quantity,expected_replacement_at,materials(name,internal_code,unit),material_lots(lot_number),deliveries!inner(id,delivered_at,reason,employee_id,term_file_path,term_uploaded_at,term_signature_method)").eq("deliveries.employee_id", id).order("created_at", { ascending: false }),
        supabase.from("employee_courses").select("id,name,provider,expires_at").eq("employee_id", id).order("expires_at", { ascending: true, nullsFirst: false }),
      ]);
      if (employeeError || deliveryError) setError(employeeError?.message ?? deliveryError?.message ?? "Não foi possível carregar a ficha.");
      setEmployee(employeeData as Employee);
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

  const deliverySheets = useMemo(() => {
    const grouped = new Map<string, { id: string; delivered_at: string; reason: string; term_file_path: string | null; term_uploaded_at: string | null; term_signature_method: string | null; items: number; materials: Item[] }>();
    items.forEach((item) => {
      if (!item.delivery) return;
      const current = grouped.get(item.delivery.id) ?? { ...item.delivery, items: 0, materials: [] };
      current.items += item.quantity;
      current.materials.push(item);
      grouped.set(item.delivery.id, current);
    });
    return [...grouped.values()].sort((first, second) => second.delivered_at.localeCompare(first.delivered_at));
  }, [items]);

  const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  async function uploadTerm(sheet: (typeof deliverySheets)[number], event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError("O arquivo do termo deve ter no máximo 10 MB."); return; }
    setUploadingId(sheet.id); setError("");
    const supabase = createClient();
    const { data: profileData } = await supabase.from("profiles").select("organization_id").single();
    if (!profileData?.organization_id) { setError("Não foi possível identificar a organização."); setUploadingId(""); return; }
    const path = `${profileData.organization_id}/${sheet.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setError(uploadError.message); setUploadingId(""); return; }
    const { data: auth } = await supabase.auth.getUser();
    const uploadedAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("deliveries").update({ term_file_path: path, term_uploaded_at: uploadedAt, term_uploaded_by: auth.user?.id ?? null }).eq("id", sheet.id);
    if (updateError) { await supabase.storage.from("delivery-terms").remove([path]); setError(updateError.message); } else {
      if (sheet.term_file_path) await supabase.storage.from("delivery-terms").remove([sheet.term_file_path]);
      setItems((current) => current.map((item) => item.delivery?.id === sheet.id ? { ...item, delivery: item.delivery ? { ...item.delivery, term_file_path: path, term_uploaded_at: uploadedAt } : item.delivery } : item));
    }
    setUploadingId("");
  }

  function downloadTerm(sheet: (typeof deliverySheets)[number]) {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 18; const width = 210; const lineWidth = width - margin * 2; let y = 20;
    doc.setTextColor(23, 35, 60); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("EPIS+", margin, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 112, 135); doc.text("TERMO DE ENTREGA E RESPONSABILIDADE DE MATERIAIS", margin, y + 7); y += 15; doc.setDrawColor(210, 216, 227); doc.line(margin, y, width - margin, y); y += 10;
    const metadata = [["Colaborador", employee?.full_name || "Não informado"], ["Matrícula", employee?.registration || "Não informada"], ["Data da entrega", date(sheet.delivered_at)], ["Motivo", reasonLabels[sheet.reason] || sheet.reason]]; const columnWidth = lineWidth / 4;
    metadata.forEach(([label, value], index) => { const x = margin + index * columnWidth; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 132, 151); doc.text(label, x, y); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(52, 64, 87); doc.text(doc.splitTextToSize(value, columnWidth - 3), x, y + 5); }); y += 20;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Materiais entregues", margin, y); y += 7; const columns = [margin, margin + 68, margin + 103, margin + 132, width - margin]; doc.setFillColor(245, 246, 250); doc.rect(margin, y - 5, lineWidth, 8, "F"); doc.setFontSize(8); doc.setTextColor(83, 96, 120); ["Material", "Código", "Qtd.", "Troca prevista"].forEach((label, index) => doc.text(label, columns[index] + 2, y)); y += 8;
    sheet.materials.forEach((item) => { const rowHeight = 9; const material = item.material?.name || "Material"; const code = item.material?.internal_code || "—"; const quantity = `${item.quantity} ${item.material?.unit || "un."}`; const replacement = item.expected_replacement_at ? date(item.expected_replacement_at) : "Conforme necessidade"; doc.setDrawColor(220, 225, 233); doc.rect(margin, y - 5, lineWidth, rowHeight); [columns[1], columns[2], columns[3]].forEach((x) => doc.line(x, y - 5, x, y + 4)); doc.setTextColor(52, 64, 87); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(doc.splitTextToSize(material, 64), margin + 2, y); doc.text(code, columns[1] + 2, y); doc.text(quantity, columns[2] + 2, y); doc.text(replacement, columns[3] + 2, y); y += rowHeight; });
    y += 12; const paragraph = "Declaro que recebi os materiais relacionados acima em condições adequadas de uso, comprometendo-me a utilizá-los corretamente, conservá-los e devolvê-los ao término do serviço, desligamento, troca de função ou quando solicitado. Em caso de perda, extravio, dano ou mau uso, o ocorrido será apurado conforme as políticas da empresa e a legislação aplicável, podendo gerar responsabilização após a devida análise."; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(79, 93, 115); const paragraphLines = doc.splitTextToSize(paragraph, lineWidth); doc.text(paragraphLines, margin, y, { lineHeightFactor: 1.5 }); y += paragraphLines.length * 4.2 + 8;
    const signatureY = Math.max(y + 28, 247); const signatureWidth = 72; doc.setDrawColor(70, 82, 103); doc.line(margin, signatureY, margin + signatureWidth, signatureY); doc.line(width - margin - signatureWidth, signatureY, width - margin, signatureY); doc.setFontSize(8); doc.setTextColor(90, 103, 123); doc.text("Assinatura do colaborador", margin + signatureWidth / 2, signatureY + 5, { align: "center" }); doc.text("Assinatura do responsável", width - margin - signatureWidth / 2, signatureY + 5, { align: "center" }); doc.setFont("helvetica", "bold"); doc.text(employee?.full_name || "", margin + signatureWidth / 2, signatureY + 10, { align: "center" }); doc.text("Responsável pela entrega", width - margin - signatureWidth / 2, signatureY + 10, { align: "center" });
    doc.save(`termo-entrega-${safeFileName(employee?.full_name || "colaborador")}.pdf`);
  }

  async function downloadSignedTerm(sheet: (typeof deliverySheets)[number]) {
    if (!sheet.term_file_path) return;
    setError("");
    const { data, error: signedUrlError } = await createClient().storage.from("delivery-terms").createSignedUrl(sheet.term_file_path, 300);
    if (signedUrlError || !data?.signedUrl) { setError(signedUrlError?.message ?? "Não foi possível abrir o termo assinado."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (loading) return <main className="module-shell"><div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando ficha...</div></main>;
  if (error || !employee) return <main className="module-shell"><div className="feedback error-feedback"><X size={17} /> {error || "Funcionário não encontrado."}</div><Link className="secondary-button" href="/employees"><ArrowLeft size={16} /> Funcionários</Link></main>;

  return <main className="module-shell employee-sheet">
    <header className="module-header no-print"><div><Link className="employee-back-link" href="/employees"><ArrowLeft size={14} /> Funcionários</Link><p className="eyebrow">CONTROLE INDIVIDUAL</p><h1>Ficha de materiais entregues</h1><p className="module-subtitle">Histórico de responsabilidade, reposições previstas e treinamentos do colaborador.</p></div><div className="employee-header-tools"><EmployeeNavigation id={id} current="sheet" /></div></header>
    <section className="panel sheet-card enhanced-sheet">
      <div className="sheet-brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>EPIS<span>+</span></strong><small>Ficha de entrega e responsabilidade de materiais</small></div><div className="sheet-document"><span>DOCUMENTO INDIVIDUAL</span><strong>Emitida em {new Date().toLocaleDateString("pt-BR")}</strong></div></div>
      <section className="sheet-employee-heading"><div className="sheet-person-icon"><UserRound size={23} /></div><div><p>COLABORADOR</p><h2>{employee.full_name}</h2><span>{employee.job_title || "Função não informada"} · {employee.department || "Setor não informado"}</span></div><div className="sheet-unit"><span>UNIDADE</span><strong>{employee.unit || "Não informada"}</strong></div></section>
      <div className="employee-summary sheet-details"><div><span>Matrícula</span><strong>{employee.registration || "—"}</strong></div><div><span>CPF</span><strong>{employee.cpf || "—"}</strong></div><div><span>Setor</span><strong>{employee.department || "—"}</strong></div><div><span>Função</span><strong>{employee.job_title || "—"}</strong></div></div>
      <section className="sheet-metrics"><div><PackageCheck size={18} /><span><strong>{items.length}</strong> materiais distintos</span></div><div><PackageCheck size={18} /><span><strong>{summary.totalQuantity}</strong> itens entregues</span></div><div className={summary.pending ? "attention" : ""}><CalendarClock size={18} /><span><strong>{summary.pending}</strong> troca(s) a acompanhar</span></div></section>
      <section className="sheet-section employee-delivery-sheets"><div className="sheet-section-heading"><div><p>FICHAS DE ENTREGA</p><h2>Termos vinculados ao colaborador</h2><span>{deliverySheets.length} ficha(s) registrada(s)</span></div></div>{deliverySheets.length ? <div className="table-wrap"><table><thead><tr><th>DATA</th><th>MOTIVO</th><th>ITENS</th><th>DOCUMENTO</th><th>AÇÕES</th></tr></thead><tbody>{deliverySheets.map((sheet) => <tr key={sheet.id}><td>{date(sheet.delivered_at)}</td><td>{reasonLabels[sheet.reason] || sheet.reason}</td><td>{sheet.items}</td><td><span className={`status-pill ${sheet.term_file_path ? "success" : "warning"}`}>{sheet.term_file_path ? <><Check size={11} /> {sheet.term_signature_method === "assisted" ? "Assinado" : "Anexado"}</> : "Pendente"}</span></td><td><div className="employee-sheet-actions"><button type="button" className="action-button" onClick={() => downloadTerm(sheet)}><Download size={14} /> PDF</button>{sheet.term_file_path && <button type="button" className="action-button" onClick={() => void downloadSignedTerm(sheet)}><Download size={14} /> Baixar termo</button>}<DeliverySignatureModal deliveryId={sheet.id} employeeName={employee.full_name} employeeCpf={employee.cpf} employeeRegistration={employee.registration} deliveredAt={sheet.delivered_at} reason={sheet.reason} items={sheet.materials.map((item) => ({ quantity: item.quantity, expected_replacement_at: item.expected_replacement_at, material: item.material }))} currentPath={sheet.term_file_path} onComplete={(path) => setItems((current) => current.map((item) => item.delivery?.id === sheet.id ? { ...item, delivery: item.delivery ? { ...item.delivery, term_file_path: path, term_signature_method: "assisted" } : item.delivery } : item))} /><label className="action-button upload-term-button"><Upload size={14} /> {uploadingId === sheet.id ? "Enviando..." : sheet.term_file_path ? "Trocar" : "Anexar termo"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadTerm(sheet, event)} disabled={uploadingId === sheet.id} /></label></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhuma ficha registrada</strong><span>As fichas aparecerão após cada entrega.</span></div>}</section>

      <section className="sheet-section"><div className="sheet-section-heading"><div><p>MATERIAIS EM RESPONSABILIDADE</p><h2>Entregas registradas</h2><span>{items.length} registro(s) vinculado(s) ao colaborador</span></div></div>{items.length ? <div className="table-wrap sheet-table-wrap"><table><thead><tr><th>MATERIAL</th><th>LOTE</th><th>QTD.</th><th>ENTREGA</th><th>PREVISÃO DE TROCA</th><th>STATUS</th><th>MOTIVO</th></tr></thead><tbody>{items.map((item) => { const status = replacementStatus(item.expected_replacement_at); return <tr key={item.id}><td><strong>{item.material?.name || "Material"}</strong><small>{item.material?.internal_code ? `${item.material.internal_code} · ${item.material.unit}` : item.material?.unit}</small></td><td>{item.lot?.lot_number || "—"}</td><td><strong>{item.quantity}</strong></td><td>{date(item.delivery?.delivered_at ?? null)}</td><td>{date(item.expected_replacement_at)}</td><td><span className={`status-pill ${status.tone}`}>{status.tone !== "success" && status.tone !== "neutral" && <AlertTriangle size={11} />}{status.label}</span></td><td>{reasonLabels[item.delivery?.reason ?? ""] || "—"}</td></tr>; })}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum material entregue</strong><span>Este colaborador ainda não possui entregas registradas.</span></div>}</section>
      {courses.length > 0 && <section className="sheet-courses"><div className="sheet-section-heading"><div><p>CAPACITAÇÕES</p><h2>Cursos e treinamentos</h2></div></div>{courses.map((course) => <div key={course.id}><strong>{course.name}</strong><span>{course.provider || "Instituição não informada"}{course.expires_at ? ` · validade ${date(course.expires_at)}` : ""}</span></div>)}</section>}
    </section>
  </main>;
}
