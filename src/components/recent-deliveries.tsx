"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { CalendarClock, Check, ClipboardList, Download, LoaderCircle, Upload, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { DeliverySignatureModal } from "@/components/delivery-signature-modal";
import { FeedbackMessage } from "@/components/feedback-message";

type DeliveryUnit = { unit_identifier: string; employee_id: string | null; delivered_at: string | null; valid_until: string | null };
type Delivery = { id: string; delivered_at: string; reason: string; notes: string | null; term_file_path: string | null; term_uploaded_at: string | null; term_signature_method: string | null; employee: { full_name: string; registration: string | null; cpf: string } | null; delivery_items: Array<{ quantity: number; expected_replacement_at: string | null; material: { name: string; unit: string; internal_code: string | null } | null; material_units?: DeliveryUnit[] }> };
const reasons: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const allowedTermTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const maxTermSize = 10 * 1024 * 1024;

export function RecentDeliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]); const [companyName, setCompanyName] = useState(""); const [uploadingId, setUploadingId] = useState(""); const [downloadingId, setDownloadingId] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retryKey, setRetryKey] = useState(0);
  const requestRef = useRef(0); const uploadingRef = useRef(""); const downloadingRef = useRef("");

  useEffect(() => { const timer = window.setTimeout(() => { void import("jspdf"); }, 1000); return () => window.clearTimeout(timer); }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const requestId = ++requestRef.current; setLoading(true); setError(""); setDeliveries([]);
      const supabase = createClient(); const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { if (active && requestId === requestRef.current) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); setLoading(false); } return; }
      const [{ data, error: loadError }, { data: profileData, error: profileError }] = await Promise.all([
        supabase.from("deliveries").select("id,delivered_at,reason,notes,term_file_path,term_uploaded_at,term_signature_method,employee:employees(full_name,registration,cpf),delivery_items(quantity,expected_replacement_at,material:materials(name,unit,internal_code),material_units(unit_identifier,employee_id,delivered_at,valid_until))").order("delivered_at", { ascending: false }).order("created_at", { ascending: false }).limit(10),
        supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle(),
      ]);
      if (!active || requestId !== requestRef.current) return;
      if (loadError || profileError) { setError(friendlyError(loadError ?? profileError, "Não foi possível carregar as entregas.")); setLoading(false); return; }
      setDeliveries((data ?? []) as unknown as Delivery[]);
      if (profileData?.organization_id) { const { data: organization, error: organizationError } = await supabase.from("organizations").select("name").eq("id", profileData.organization_id).maybeSingle(); if (!active || requestId !== requestRef.current) return; if (organizationError) setError(friendlyError(organizationError, "Não foi possível carregar os dados da organização.")); else setCompanyName(organization?.name ?? ""); }
      setLoading(false);
    }
    void load().catch((caught) => { if (active) { setError(friendlyError(caught, "Nao foi possivel carregar as entregas.")); setLoading(false); } });
    const refresh = () => { void load().catch((caught) => { if (active) { setError(friendlyError(caught, "Nao foi possivel atualizar as entregas.")); setLoading(false); } }); }; window.addEventListener("delivery-created", refresh); return () => { active = false; requestRef.current += 1; window.removeEventListener("delivery-created", refresh); };
  }, [retryKey]);

  async function uploadTerm(delivery: Delivery, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file || uploadingRef.current === delivery.id) return;
    if (!allowedTermTypes.includes(file.type)) { setError("Anexe um PDF, JPG, PNG ou WEBP."); return; }
    if (file.size > maxTermSize) { setError("O arquivo do termo deve ter no máximo 10 MB."); return; }
    uploadingRef.current = delivery.id; setUploadingId(delivery.id); setError(""); let uploadedPath: string | null = null; let supabase: ReturnType<typeof createClient> | null = null;
    try {
      supabase = createClient(); const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
      if (profileError || !profile?.organization_id) { setError(friendlyError(profileError, "Não foi possível identificar a organização.")); return; }
      const path = `${profile.organization_id}/${delivery.id}/${crypto.randomUUID()}-${safeFileName(file.name) || "termo"}`;
      const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { setError(friendlyError(uploadError, "Não foi possível anexar o termo.")); return; }
      uploadedPath = path; const uploadedAt = new Date().toISOString();
      const { data: updatedDelivery, error: updateError } = await supabase.from("deliveries").update({ term_file_path: path, term_uploaded_at: uploadedAt, term_uploaded_by: auth.user.id, term_signature_method: "physical_upload", term_signed_at: uploadedAt, term_signer_name: delivery.employee?.full_name || null, term_signer_cpf: delivery.employee?.cpf || null }).eq("id", delivery.id).select("id").maybeSingle();
      if (updateError || !updatedDelivery) { setError(friendlyError(updateError, "Não foi possível atualizar o termo.")); return; }
      uploadedPath = null;
      const previousAttachmentError = delivery.term_file_path ? (await supabase.storage.from("delivery-terms").remove([delivery.term_file_path])).error : null;
      setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, term_file_path: path, term_uploaded_at: uploadedAt, term_signature_method: "physical_upload" } : item));
      if (previousAttachmentError) setError("O termo foi atualizado, mas o anexo anterior não pôde ser removido.");
    } catch (caughtError) { setError(friendlyError(caughtError, "Não foi possível anexar o termo.")); }
    finally { if (uploadedPath && supabase) await supabase.storage.from("delivery-terms").remove([uploadedPath]); uploadingRef.current = ""; setUploadingId(""); }
  }

  async function downloadTerm(delivery: Delivery) {
    if (downloadingRef.current === delivery.id) return; downloadingRef.current = delivery.id; setDownloadingId(delivery.id); setError("");
    try {
      const { jsPDF } = await import("jspdf"); const doc = new jsPDF({ unit: "mm", format: "a4" }); const margin = 18; const width = 210; let y = 20; const lineWidth = width - margin * 2; const wrap = (text: string, size: number) => { doc.setFontSize(size); return doc.splitTextToSize(text, lineWidth); };
      doc.setTextColor(23, 35, 60); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(companyName || "Empresa", margin, y); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 112, 135); doc.text("TERMO DE ENTREGA E RESPONSABILIDADE DE MATERIAIS", margin, y + 7); y += 15; doc.setDrawColor(210, 216, 227); doc.line(margin, y, width - margin, y); y += 10;
      const metadata = [["Colaborador", delivery.employee?.full_name || "Não informado"], ["Matrícula", delivery.employee?.registration || "Não informada"], ["Data da entrega", date(delivery.delivered_at)], ["Motivo", reasons[delivery.reason] || delivery.reason]]; const columnWidth = lineWidth / 4; metadata.forEach(([label, value], index) => { const x = margin + index * columnWidth; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 132, 151); doc.text(label, x, y); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(52, 64, 87); doc.text(doc.splitTextToSize(value, columnWidth - 3), x, y + 5); }); y += 20; doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Materiais entregues", margin, y); y += 7;
      const columns = [margin, margin + 68, margin + 103, margin + 132, width - margin]; doc.setFillColor(245, 246, 250); doc.rect(margin, y - 5, lineWidth, 8, "F"); doc.setFontSize(8); doc.setTextColor(83, 96, 120); ["Material", "Código", "Qtd.", "Troca prevista"].forEach((label, index) => doc.text(label, columns[index] + 2, y)); y += 8;
      delivery.delivery_items.forEach((item) => { const rowHeight = 9; const material = item.material?.name || "Material"; const code = item.material?.internal_code || "—"; const quantity = `${item.quantity} ${item.material?.unit || "un."}`; const replacement = item.expected_replacement_at ? date(item.expected_replacement_at) : "Conforme necessidade"; doc.setDrawColor(220, 225, 233); doc.rect(margin, y - 5, lineWidth, rowHeight); [columns[1], columns[2], columns[3]].forEach((x) => doc.line(x, y - 5, x, y + 4)); doc.setTextColor(52, 64, 87); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(doc.splitTextToSize(material, 64), margin + 2, y); doc.text(code, columns[1] + 2, y); doc.text(quantity, columns[2] + 2, y); doc.text(replacement, columns[3] + 2, y); y += rowHeight; });
      y += 12; const paragraph = "Declaro que recebi os materiais relacionados acima em condições adequadas de uso, comprometendo-me a utilizá-los corretamente, conservá-los e devolvê-los ao término do serviço, desligamento, troca de função ou quando solicitado. Em caso de perda, extravio, dano ou mau uso, o ocorrido será apurado conforme as políticas da empresa e a legislação aplicável, podendo gerar responsabilização após a devida análise."; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(79, 93, 115); const paragraphLines = wrap(paragraph, 8.5); doc.text(paragraphLines, margin, y, { lineHeightFactor: 1.5 }); y += paragraphLines.length * 4.2 + 8; if (delivery.notes) { doc.setFont("helvetica", "bold"); doc.text("Observações:", margin, y); doc.setFont("helvetica", "normal"); doc.text(wrap(delivery.notes, 8.5), margin + 22, y); y += 8; }
      const signatureY = Math.max(y + 28, 247); const signatureWidth = 72; doc.setDrawColor(70, 82, 103); doc.line(margin, signatureY, margin + signatureWidth, signatureY); doc.line(width - margin - signatureWidth, signatureY, width - margin, signatureY); doc.setFontSize(8); doc.setTextColor(90, 103, 123); doc.text("Assinatura do colaborador", margin + signatureWidth / 2, signatureY + 5, { align: "center" }); doc.text("Assinatura do responsável", width - margin - signatureWidth / 2, signatureY + 5, { align: "center" }); doc.setFont("helvetica", "bold"); doc.text(delivery.employee?.full_name || "", margin + signatureWidth / 2, signatureY + 10, { align: "center" }); doc.text("Responsável pela entrega", width - margin - signatureWidth / 2, signatureY + 10, { align: "center" }); doc.save(`termo-entrega-${safeFileName(delivery.employee?.full_name || "colaborador") || "colaborador"}.pdf`);
    } catch (caughtError) { setError(friendlyError(caughtError, "Não foi possível gerar o termo.")); } finally { downloadingRef.current = ""; setDownloadingId(""); }
  }

  return <section className="panel recent-deliveries-card"><div className="panel-header no-print"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas entregas</h2><p>Entregas realizadas recentemente para os colaboradores.</p></div><ClipboardList size={21} aria-hidden="true" /></div>{loading ? <div className="module-loading no-print" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando histórico...</div> : error ? <FeedbackMessage onRetry={() => setRetryKey((current) => current + 1)}>{error}</FeedbackMessage> : deliveries.length ? <div className="recent-delivery-list no-print" role="list" aria-label="Últimas entregas">{deliveries.map((delivery) => <article className="recent-delivery-item" key={delivery.id} role="listitem"><div className="recent-delivery-icon"><UserRound size={17} aria-hidden="true" /></div><div className="recent-delivery-main"><strong>{delivery.employee?.full_name || "Funcionário não informado"}</strong><small>{delivery.employee?.registration ? `Matrícula ${delivery.employee.registration} · ` : ""}{date(delivery.delivered_at)} · {reasons[delivery.reason] || delivery.reason}</small><div className="recent-delivery-materials" aria-label="Materiais entregues">{delivery.delivery_items.map((item, index) => <span key={`${delivery.id}-${index}`}>{item.quantity}x {item.material?.name || "Material"}</span>)}</div><span className={`delivery-term-status ${delivery.term_file_path ? "complete" : "pending"}`}>{delivery.term_file_path ? <><Check size={12} aria-hidden="true" /> {delivery.term_signature_method === "assisted" ? "Assinado no aparelho" : "Documento anexado"}</> : "Termo pendente de confirmação"}</span></div><div className="recent-delivery-actions"><button type="button" className="action-button" onClick={() => void downloadTerm(delivery)} disabled={downloadingId === delivery.id}><Download size={14} aria-hidden="true" /> {downloadingId === delivery.id ? "Gerando..." : "Baixar termo para assinatura"}</button><DeliverySignatureModal deliveryId={delivery.id} employeeName={delivery.employee?.full_name || "Colaborador"} employeeCpf={delivery.employee?.cpf || ""} employeeRegistration={delivery.employee?.registration || null} deliveredAt={delivery.delivered_at} reason={delivery.reason} items={delivery.delivery_items} currentPath={delivery.term_file_path} onComplete={(path) => setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, term_file_path: path, term_signature_method: "assisted" } : item))} /><label className="action-button upload-term-button"><Upload size={14} aria-hidden="true" /> {uploadingId === delivery.id ? "Enviando..." : delivery.term_file_path ? "Trocar termo assinado" : "Anexar termo assinado"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadTerm(delivery, event)} disabled={uploadingId === delivery.id} /></label></div><CalendarClock size={17} className="recent-delivery-date" aria-hidden="true" /></article>)}</div> : <div className="empty-state no-print"><ClipboardList size={27} aria-hidden="true" /><strong>Nenhuma entrega registrada</strong><span>As entregas confirmadas aparecerão aqui.</span></div>}</section>;
}
