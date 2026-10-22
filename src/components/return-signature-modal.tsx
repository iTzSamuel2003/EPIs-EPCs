"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import { Check, Eraser, PenLine, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { TermWhatsAppLinkButton } from "@/components/term-whatsapp-link-button";
import { useModalFocus } from "@/components/use-modal-focus";
import { createReturnTermDocument, ReturnTermItem, ReturnTermOrganization } from "@/lib/return-term-document";

type ReturnEmployee = { name: string; cpf: string; registration: string | null; job_title?: string | null; department?: string | null; admission_date?: string | null; termination_date?: string | null };
type ReturnSignatureItem = ReturnTermItem | {
  quantity: number;
  material: { name: string; unit: string } | null;
  variant: { name: string; size: string | null } | null;
  delivered_at?: string | null;
  lot_number?: string | null;
  ca_number?: string | null;
  ca_expires_at?: string | null;
  test_number?: string | null;
  test_report_number?: string | null;
  test_performed_at?: string | null;
  test_expires_at?: string | null;
  condition?: string | null;
  destination?: string | null;
  incident_type?: string | null;
  incident_description?: string | null;
  deduction_amount?: number | null;
};
type ReturnSignatureModalProps = {
  returnId: string;
  employee?: ReturnEmployee;
  employeeName?: string;
  employeeCpf?: string;
  employeeRegistration?: string | null;
  organization?: ReturnTermOrganization;
  responsibleName?: string | null;
  returnedAt: string;
  reason: string;
  notes?: string | null;
  items: ReturnSignatureItem[];
  currentPath: string | null;
  onComplete: (path: string) => void;
};

const digits = (value: string) => value.replace(/\D/g, "");
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function normalizeItem(item: ReturnSignatureItem): ReturnTermItem {
  const value = item as ReturnSignatureItem & { material: string | { name: string; unit: string } | null; unit?: string; size?: string | null; variant?: { name: string; size: string | null } | null };
  const material = typeof value.material === "string" ? value.material : value.material?.name || "Material";
  const unit = typeof value.material === "object" && value.material ? value.material.unit : value.unit;
  return { ...value, material, unit: unit || "un.", size: value.size || value.variant?.size || value.variant?.name || null };
}
const hasOccurrence = (items: ReturnTermItem[]) => items.some((item) => item.incident_type && item.incident_type !== "normal");

export function ReturnSignatureModal({ returnId, employee, employeeName, employeeCpf, employeeRegistration, organization, responsibleName, returnedAt, reason, notes, items, currentPath, onComplete }: ReturnSignatureModalProps) {
  const signer = employee ?? { name: employeeName || "Colaborador", cpf: employeeCpf || "", registration: employeeRegistration || null };
  const termItems = items.map(normalizeItem);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [cpf, setCpf] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useModalFocus(open, modalRef, "input");

  useEffect(() => {
    if (!open) return;
    const input = document.querySelector<HTMLInputElement>(".signature-modal input");
    input?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || saving) return;
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      setHasSignature(false);
      setOpen(false);
      setCpf("");
      setAccepted(false);
      setError("");
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, saving]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.setPointerCapture(event.pointerId);
    const position = point(event);
    context.beginPath();
    context.moveTo(position.x, position.y);
    setDrawing(true);
    setHasSignature(true);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const position = point(event);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#243452";
    context.lineTo(position.x, position.y);
    context.stroke();
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  function close() {
    clear();
    setOpen(false);
    setCpf("");
    setAccepted(false);
    setError("");
  }

  async function submit() {
    if (digits(cpf) !== digits(signer.cpf)) { setError("O CPF informado não corresponde ao cadastro do colaborador."); return; }
    if (!hasSignature || !canvasRef.current) { setError("Faça a assinatura no campo indicado."); return; }
    if (!accepted) { setError("Confirme que o colaborador leu e concorda com o termo."); return; }
    setSaving(true);
    setError("");
    let uploadedPath = "";
    const supabase = createClient();
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      const { data: profile, error: profileError } = auth.user
        ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle()
        : { data: null, error: authError };
      if (profileError || authError || !auth.user || !profile?.organization_id) throw profileError ?? authError ?? new Error("Não foi possível identificar a organização.");
      let documentOrganization = organization;
      if (!documentOrganization) {
        const { data: organizationData, error: organizationError } = await supabase.from("organizations").select("name,logo_url,cnpj,address,phone").eq("id", profile.organization_id).maybeSingle();
        if (organizationError) throw organizationError;
        documentOrganization = organizationData as ReturnTermOrganization | null ?? { name: "EPIS+" };
      }

      const signedAt = new Date().toISOString();
      const doc = await createReturnTermDocument({
        organization: documentOrganization,
        employee: signer,
        responsible_name: responsibleName || null,
        return_id: returnId,
        returned_at: returnedAt,
        reason,
        notes: notes || null,
        items: termItems,
        signature_data_url: canvasRef.current.toDataURL("image/png"),
        signed_at: signedAt,
        signed_name: signer.name,
        signed_cpf: digits(cpf),
      });
      const path = `${profile.organization_id}/${returnId}/signed-${crypto.randomUUID()}-${safeFileName(signer.name)}.pdf`;
      uploadedPath = path;
      const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, doc.output("blob"), { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const { data: updatedReturn, error: updateError } = await supabase.from("returns").update({
        term_file_path: path,
        term_uploaded_at: signedAt,
        term_uploaded_by: auth.user.id,
        term_signature_method: "assisted",
        term_signed_at: signedAt,
        term_signer_name: signer.name,
        term_signer_cpf: digits(cpf),
      }).eq("id", returnId).is("term_signed_at", null).select("id").maybeSingle();
      if (updateError || !updatedReturn) throw updateError ?? new Error("A ficha já foi assinada ou não está mais pendente.");
      uploadedPath = "";
      if (currentPath) await supabase.storage.from("delivery-terms").remove([currentPath]);
      onComplete(path);
      window.dispatchEvent(new Event("return-created"));
      close();
    } catch (caught) {
      if (uploadedPath) await supabase.storage.from("delivery-terms").remove([uploadedPath]);
      setError(friendlyError(caught, "Não foi possível salvar a assinatura."));
    } finally {
      setSaving(false);
    }
  }

  const occurrenceTerm = hasOccurrence(termItems);
  return <>
    <div className="delivery-attachment-actions">
      <button type="button" className="action-button assisted-signature-button" onClick={() => setOpen(true)}><PenLine size={14} /> Assinar digitalmente</button>
      <TermWhatsAppLinkButton recordType="return" recordId={returnId} employeeName={signer.name} />
    </div>
    {open && <div className="signature-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={modalRef} className="signature-modal" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="return-signature-title">
        <button type="button" className="signature-modal-close" onClick={close} aria-label="Fechar"><X size={18} /></button>
        <div className="signature-modal-icon"><PenLine size={22} /></div>
        <h2 id="return-signature-title">Assinatura da devolução</h2>
        <p>O colaborador deve conferir os materiais, a condição de cada item e, quando houver, os dados da ocorrência.</p>
        <label>CPF do colaborador<input value={cpf} onChange={(event) => setCpf(event.target.value)} inputMode="numeric" placeholder="000.000.000-00" /></label>
        <div className="signature-pad-label"><span>Assinatura</span><button type="button" onClick={clear}><Eraser size={13} /> Limpar</button></div>
        <canvas ref={canvasRef} width={640} height={180} className="signature-pad" aria-label="Campo para desenhar a assinatura" tabIndex={0} onPointerDown={start} onPointerMove={draw} onPointerUp={() => setDrawing(false)} onPointerCancel={() => setDrawing(false)} />
        <label className="signature-acceptance"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />{occurrenceTerm ? "Confirmo que li os dados da ocorrência e estou ciente de que a assinatura não aplica desconto automático." : "Confirmo que conferi os materiais e as informações desta ficha de devolução."}</label>
        {error && <div className="feedback error-feedback" role="alert"><X size={15} /> {error}</div>}
        <div className="signature-modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="button" className="primary-button" onClick={() => void submit()} disabled={saving}>{saving ? "Gerando documento..." : "Confirmar assinatura"}<Check size={16} /></button></div>
      </section>
    </div>}
  </>;
}
