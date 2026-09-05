"use client";

import { ChangeEvent, PointerEvent, useRef, useState } from "react";
import { Check, Eraser, PenLine, X } from "lucide-react";
import { jsPDF } from "jspdf";
import { createClient } from "@/lib/supabase/client";

type SignatureItem = { quantity: number; expected_replacement_at: string | null; material: { name: string; unit: string; internal_code: string | null } | null };
type DeliverySignatureModalProps = { deliveryId: string; employeeName: string; employeeCpf: string; employeeRegistration: string | null; deliveredAt: string; reason: string; items: SignatureItem[]; currentPath: string | null; onComplete: (path: string) => void };

const reasons: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
const date = (value: string | null) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "—";
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const digits = (value: string) => value.replace(/\D/g, "");

export function DeliverySignatureModal({ deliveryId, employeeName, employeeCpf, employeeRegistration, deliveredAt, reason, items, currentPath, onComplete }: DeliverySignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);
  const [cpf, setCpf] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function point(event: PointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 }; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }; }
  function startDrawing(event: PointerEvent<HTMLCanvasElement>) { const canvas = canvasRef.current; if (!canvas) return; canvas.setPointerCapture(event.pointerId); const context = canvas.getContext("2d"); if (!context) return; const { x, y } = point(event); context.beginPath(); context.moveTo(x, y); setDrawing(true); setHasSignature(true); }
  function draw(event: PointerEvent<HTMLCanvasElement>) { if (!drawing) return; const context = canvasRef.current?.getContext("2d"); if (!context) return; const { x, y } = point(event); context.lineWidth = 2.5; context.lineCap = "round"; context.strokeStyle = "#243452"; context.lineTo(x, y); context.stroke(); }
  function clearSignature() { const canvas = canvasRef.current; if (!canvas) return; canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); setHasSignature(false); }
  function close() { if (saving) return; setOpen(false); setError(""); clearSignature(); setCpf(""); setAccepted(false); }

  async function submit() {
    if (digits(cpf) !== digits(employeeCpf)) { setError("O CPF informado não corresponde ao cadastro do colaborador."); return; }
    if (!hasSignature) { setError("Faça a assinatura no campo indicado."); return; }
    if (!accepted) { setError("Confirme que o colaborador leu e concorda com o termo."); return; }
    setSaving(true); setError("");
    const supabase = createClient();
    const { data: profile } = await supabase.from("profiles").select("organization_id").single();
    if (!profile?.organization_id) { setError("Não foi possível identificar a organização."); setSaving(false); return; }
    const canvas = canvasRef.current;
    if (!canvas) { setError("Não foi possível capturar a assinatura."); setSaving(false); return; }
    const doc = new jsPDF({ unit: "mm", format: "a4" }); const margin = 18; const width = 210; const lineWidth = width - margin * 2; let y = 20;
    doc.setTextColor(23, 35, 60); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("EPIS+", margin, y); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 112, 135); doc.text("TERMO DE ENTREGA E RESPONSABILIDADE DE MATERIAIS", margin, y + 7); y += 15; doc.setDrawColor(210, 216, 227); doc.line(margin, y, width - margin, y); y += 10;
    const metadata = [["Colaborador", employeeName], ["Matrícula", employeeRegistration || "Não informada"], ["Data da entrega", date(deliveredAt)], ["Motivo", reasons[reason] || reason]]; const columnWidth = lineWidth / 4; metadata.forEach(([label, value], index) => { const x = margin + index * columnWidth; doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 132, 151); doc.text(label, x, y); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(52, 64, 87); doc.text(doc.splitTextToSize(value, columnWidth - 3), x, y + 5); }); y += 20;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Materiais entregues", margin, y); y += 7; const columns = [margin, margin + 68, margin + 103, margin + 132, width - margin]; doc.setFillColor(245, 246, 250); doc.rect(margin, y - 5, lineWidth, 8, "F"); doc.setFontSize(8); doc.setTextColor(83, 96, 120); ["Material", "Código", "Qtd.", "Troca prevista"].forEach((label, index) => doc.text(label, columns[index] + 2, y)); y += 8;
    items.forEach((item) => { const rowHeight = 9; const material = item.material?.name || "Material"; const code = item.material?.internal_code || "—"; const quantity = `${item.quantity} ${item.material?.unit || "un."}`; const replacement = item.expected_replacement_at ? date(item.expected_replacement_at) : "Conforme necessidade"; doc.setDrawColor(220, 225, 233); doc.rect(margin, y - 5, lineWidth, rowHeight); [columns[1], columns[2], columns[3]].forEach((x) => doc.line(x, y - 5, x, y + 4)); doc.setTextColor(52, 64, 87); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(doc.splitTextToSize(material, 64), margin + 2, y); doc.text(code, columns[1] + 2, y); doc.text(quantity, columns[2] + 2, y); doc.text(replacement, columns[3] + 2, y); y += rowHeight; });
    y += 12; const paragraph = "Declaro que recebi os materiais relacionados acima em condições adequadas de uso, comprometendo-me a utilizá-los corretamente, conservá-los e devolvê-los ao término do serviço, desligamento, troca de função ou quando solicitado. Em caso de perda, extravio, dano ou mau uso, o ocorrido será apurado conforme as políticas da empresa e a legislação aplicável, podendo gerar responsabilização após a devida análise."; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(79, 93, 115); const paragraphLines = doc.splitTextToSize(paragraph, lineWidth); doc.text(paragraphLines, margin, y, { lineHeightFactor: 1.5 }); y += paragraphLines.length * 4.2 + 8;
    const signatureY = Math.max(y + 28, 247); const signatureWidth = 72; doc.setDrawColor(70, 82, 103); doc.line(margin, signatureY, margin + signatureWidth, signatureY); doc.line(width - margin - signatureWidth, signatureY, width - margin, signatureY); doc.addImage(canvas.toDataURL("image/png"), "PNG", margin + 4, signatureY - 22, signatureWidth - 8, 18); doc.setFontSize(8); doc.setTextColor(90, 103, 123); doc.text("Assinatura eletrônica assistida", margin + signatureWidth / 2, signatureY + 5, { align: "center" }); doc.text("Responsável pela entrega", width - margin - signatureWidth / 2, signatureY + 5, { align: "center" }); doc.setFont("helvetica", "bold"); doc.text(employeeName, margin + signatureWidth / 2, signatureY + 10, { align: "center" }); doc.text("Controle de equipamentos", width - margin - signatureWidth / 2, signatureY + 10, { align: "center" });
    const blob = doc.output("blob"); const path = `${profile.organization_id}/${deliveryId}/signed-${crypto.randomUUID()}-${safeFileName(employeeName)}.pdf`; const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, blob, { contentType: "application/pdf", upsert: false });
    if (uploadError) { setError(uploadError.message); setSaving(false); return; }
    const { data: auth } = await supabase.auth.getUser(); const { error: updateError } = await supabase.from("deliveries").update({ term_file_path: path, term_uploaded_at: new Date().toISOString(), term_uploaded_by: auth.user?.id ?? null, term_signature_method: "assisted", term_signed_at: new Date().toISOString(), term_signer_name: employeeName, term_signer_cpf: digits(cpf) }).eq("id", deliveryId);
    if (updateError) { await supabase.storage.from("delivery-terms").remove([path]); setError(updateError.message); setSaving(false); return; }
    if (currentPath) await supabase.storage.from("delivery-terms").remove([currentPath]);
    onComplete(path); close(); setSaving(false);
  }

  return <><button type="button" className="action-button assisted-signature-button" onClick={() => setOpen(true)}><PenLine size={14} /> Assinar no aparelho</button>{open && <div className="signature-modal-backdrop"><section className="signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-title"><button type="button" className="signature-modal-close" onClick={close} aria-label="Fechar"><X size={18} /></button><div className="signature-modal-icon"><PenLine size={22} /></div><h2 id="signature-title">Assinatura assistida</h2><p>O colaborador deve conferir os materiais, informar o CPF e assinar no campo abaixo.</p><label>CPF do colaborador<input value={cpf} onChange={(event) => setCpf(event.target.value)} inputMode="numeric" placeholder="000.000.000-00" /></label><div className="signature-pad-label"><span>Assinatura</span><button type="button" onClick={clearSignature}><Eraser size={13} /> Limpar</button></div><canvas ref={canvasRef} width={640} height={180} className="signature-pad" onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={() => setDrawing(false)} onPointerCancel={() => setDrawing(false)} /><label className="signature-acceptance"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> Confirmo que o colaborador leu e concorda com o termo de entrega e responsabilidade.</label>{error && <div className="feedback error-feedback"><X size={15} /> {error}</div>}<div className="signature-modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="button" className="primary-button" onClick={() => void submit()} disabled={saving}>{saving ? "Gerando documento..." : "Confirmar assinatura"}<Check size={16} /></button></div></section></div>}</>;
}
