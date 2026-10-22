"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Check, ClipboardList, Download, LoaderCircle, RotateCcw, Upload, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TermCopyLinkButton } from "@/components/term-copy-link-button";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";
import { createReturnTermDocument, ReturnTermOrganization } from "@/lib/return-term-document";

type ReturnItem = { quantity: number; equipment_condition: string; destination: string; incident_type: string; incident_description: string | null; deduction_requested: boolean; material: { name: string; unit: string } | null; delivery_item: { variant: { name: string; size: string | null } | null; delivery: { delivered_at: string } | null; lot: { lot_number: string | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; test_expires_at: string | null } | null; units: Array<{ unit_identifier: string | null; valid_until: string | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null }> | null } | null };
type ReturnRecord = { id: string; returned_at: string; reason: string; notes: string | null; term_file_path: string | null; term_signature_method: string | null; term_signed_at: string | null; term_signer_name?: string | null; term_signer_cpf?: string | null; employee: { full_name: string; registration: string | null; cpf: string; job_title?: string | null; function_name?: string | null; department?: string | null; admission_date?: string | null; termination_date?: string | null; status?: string | null } | null; return_accountability: { responsible_name: string | null; employee_signature_name: string | null; signed_at: string | null } | null; return_items: ReturnItem[] };

const reasons: Record<string, string> = { replacement: "Substituição", termination: "Desligamento", role_change: "Alteração de função", damaged: "Equipamento danificado", voluntary: "Devolução voluntária", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const allowedTermTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const maxTermSize = 10 * 1024 * 1024;

function toTermItem(item: ReturnItem) {
  const source = item.delivery_item?.lot;
  const variant = item.delivery_item?.variant;
  const units = item.delivery_item?.units ?? [];
  const unitValues = (key: "ca_number" | "ca_expires_at" | "test_number" | "test_report_number" | "test_performed_at" | "valid_until") => [...new Set(units.map((unit) => unit[key]).filter(Boolean))].join(", ") || null;
  return {
    material: item.material?.name || "Material", unit: item.material?.unit || "un.", quantity: item.quantity,
    size: variant?.size || variant?.name, delivered_at: item.delivery_item?.delivery?.delivered_at,
    lot_number: source?.lot_number, ca_number: source?.ca_number || unitValues("ca_number"), ca_expires_at: source?.ca_expires_at || unitValues("ca_expires_at"),
    test_number: source?.test_number || unitValues("test_number"), test_report_number: source?.test_report_number || unitValues("test_report_number"),
    test_performed_at: source?.test_performed_at || unitValues("test_performed_at"), test_expires_at: source?.test_expires_at || unitValues("valid_until"),
    condition: item.equipment_condition, destination: item.destination, incident_type: item.incident_type,
    incident_description: item.incident_description,
  };
}

export function RecentReturns({ organization }: { organization: ReturnTermOrganization }) {
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [uploadingId, setUploadingId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const requestRef = useRef(0);
  const uploadingRef = useRef("");
  const downloadingRef = useRef("");

  useEffect(() => {
    let active = true;
    let initialLoadPending = true;
    async function load(silent = false) {
      const requestId = ++requestRef.current;
      if (!silent) { setLoading(true); setError(""); }
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        if (!silent && active && requestId === requestRef.current) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); setLoading(false); }
        return;
      }
      const { data, error: loadError } = await supabase.from("returns").select("id,returned_at,reason,notes,term_file_path,term_signature_method,term_signed_at,term_signer_name,term_signer_cpf,employee:employees(full_name,registration,cpf,job_title,function_name,department,admission_date,termination_date,status),return_accountability(responsible_name,employee_signature_name,signed_at),return_items(quantity,equipment_condition,destination,incident_type,incident_description,deduction_requested,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size),delivery:deliveries(delivered_at),lot:material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),units:material_units(unit_identifier,valid_until,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at)))").order("returned_at", { ascending: false }).order("created_at", { ascending: false }).limit(10);
      if (!active || requestId !== requestRef.current) return;
      if (loadError) {
        if (!silent) setError(friendlyError(loadError, "Não foi possível carregar as devoluções."));
      } else {
        setReturns((data ?? []) as unknown as ReturnRecord[]);
        setError("");
      }
      if (!silent) setLoading(false);
    }
    const runLoad = (silent = false) => {
      const loadSilently = silent && !initialLoadPending;
      const requestId = requestRef.current + 1;
      void load(loadSilently).catch((caught) => {
        if (!loadSilently && active && requestId === requestRef.current) {
          setError(friendlyError(caught, "Não foi possível carregar as devoluções."));
          setLoading(false);
        }
      }).finally(() => { if (!loadSilently) initialLoadPending = false; });
    };
    const refreshAfterReturn = () => runLoad(true);
    runLoad();
    window.addEventListener("return-created", refreshAfterReturn);
    return () => { active = false; requestRef.current += 1; window.removeEventListener("return-created", refreshAfterReturn); };
  }, [retryKey]);

  async function downloadTerm(item: ReturnRecord) {
    if (downloadingRef.current === item.id) return;
    downloadingRef.current = item.id; setDownloadingId(item.id); setError("");
    try {
      if (item.term_signed_at && item.term_file_path) {
        const supabase = createClient();
        const { data: signedFile, error: signedUrlError } = await supabase.storage.from("delivery-terms").createSignedUrl(item.term_file_path, 60);
        if (signedUrlError || !signedFile?.signedUrl) throw signedUrlError ?? new Error("Não foi possível localizar o termo assinado.");
        const response = await fetch(signedFile.signedUrl);
        if (!response.ok) throw new Error("Não foi possível baixar o termo assinado.");
        const blob = await response.blob();
        const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "pdf";
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `termo-devolucao-assinado-${safeFileName(item.employee?.full_name || "colaborador") || "colaborador"}.${extension}`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        return;
      }
      const doc = await createReturnTermDocument({
        organization,
        employee: { name: item.employee?.full_name || "Não informado", registration: item.employee?.registration, cpf: item.employee?.cpf, job_title: item.employee?.job_title || item.employee?.function_name, department: item.employee?.department, admission_date: item.employee?.admission_date, termination_date: item.employee?.status === "terminated" ? item.employee.termination_date : null },
        responsible_name: item.return_accountability?.responsible_name,
        return_id: item.id, returned_at: item.returned_at, reason: item.reason, notes: item.notes,
        items: item.return_items.map(toTermItem),
        signed_at: item.term_signed_at, signed_name: item.term_signer_name || item.return_accountability?.employee_signature_name,
        signed_cpf: item.term_signer_cpf,
      });
      doc.save(`termo-devolucao-${safeFileName(item.employee?.full_name || "colaborador") || "colaborador"}.pdf`);
    } catch (caughtError) { setError(friendlyError(caughtError, "Não foi possível gerar o termo.")); }
    finally { downloadingRef.current = ""; setDownloadingId(""); }
  }

  async function uploadTerm(item: ReturnRecord, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || uploadingRef.current === item.id) return;
    if (!allowedTermTypes.includes(file.type)) { setError("Anexe um PDF, JPG, PNG ou WEBP."); return; }
    if (file.size > maxTermSize) { setError("O arquivo do termo deve ter no máximo 10 MB."); return; }
    uploadingRef.current = item.id; setUploadingId(item.id); setError("");
    let uploadedPath: string | null = null; let supabase: ReturnType<typeof createClient> | null = null;
    try {
      supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
      if (profileError || !profile?.organization_id) { setError(friendlyError(profileError, "Não foi possível identificar a organização.")); return; }
      const path = `${profile.organization_id}/${item.id}/${crypto.randomUUID()}-${safeFileName(file.name) || "termo"}`;
      const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) { setError(friendlyError(uploadError, "Não foi possível anexar o termo.")); return; }
      uploadedPath = path; const uploadedAt = new Date().toISOString();
      const { data: updatedReturn, error: updateError } = await supabase.from("returns").update({ term_file_path: path, term_uploaded_at: uploadedAt, term_uploaded_by: auth.user.id, term_signature_method: "physical_upload", term_signed_at: uploadedAt, term_signer_name: item.employee?.full_name || null, term_signer_cpf: item.employee?.cpf || null }).eq("id", item.id).select("id").maybeSingle();
      if (updateError || !updatedReturn) { setError(friendlyError(updateError, "Não foi possível atualizar o termo.")); return; }
      uploadedPath = null;
      const previousAttachmentError = item.term_file_path ? (await supabase.storage.from("delivery-terms").remove([item.term_file_path])).error : null;
      setReturns((current) => current.map((currentItem): ReturnRecord => currentItem.id === item.id ? { ...currentItem, term_file_path: path, term_uploaded_at: uploadedAt, term_signature_method: "physical_upload", term_signed_at: uploadedAt } as ReturnRecord : currentItem));
      if (previousAttachmentError) setError("O termo foi atualizado, mas o anexo anterior não pôde ser removido.");
    } catch (caughtError) { setError(friendlyError(caughtError, "Não foi possível anexar o termo.")); }
    finally { if (uploadedPath && supabase) await supabase.storage.from("delivery-terms").remove([uploadedPath]); uploadingRef.current = ""; setUploadingId(""); }
  }

  return (
    <section className="panel recent-deliveries-card recent-returns-card">
      <div className="panel-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas devoluções</h2><p>Devoluções registradas recentemente pelos colaboradores.</p></div><button type="button" className="icon-button" onClick={() => window.dispatchEvent(new Event("return-created"))} aria-label="Atualizar devoluções" title="Atualizar devoluções"><RotateCcw size={21} aria-hidden="true" /></button></div>
      {loading ? <div className="module-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando histórico...</div>
        : error ? <FeedbackMessage onRetry={() => setRetryKey((current) => current + 1)}>{error}</FeedbackMessage>
          : returns.length ? <div className="recent-delivery-list" role="list" aria-label="Últimas devoluções">
            {returns.map((item) => {
              const pdfItems = item.return_items.map(toTermItem);
              const hasMissingItem = pdfItems.some((returnItem) => returnItem.destination === "not_returned");
              return <article className="recent-delivery-item recent-return-item" key={item.id} role="listitem">
                <div className="recent-delivery-icon recent-return-icon"><UserRound size={17} aria-hidden="true" /></div>
                <div className="recent-delivery-main">
                  <strong>{item.employee?.full_name || "Funcionário não informado"}</strong>
                  <small>{item.employee?.registration ? `Matrícula ${item.employee.registration} · ` : ""}{date(item.returned_at)} · {reasons[item.reason] || item.reason}</small>
                  <div className="recent-delivery-materials" aria-label="Materiais devolvidos">{item.return_items.map((returnItem, index) => { const variant = returnItem.delivery_item?.variant; return <span key={`${item.id}-${index}`}>{returnItem.quantity}x {returnItem.material?.name || "Material"}{variant ? ` · ${variant.size || variant.name}` : ""}{returnItem.incident_type !== "normal" ? ` · ${returnItem.incident_type}` : ""}</span>; })}</div>
                  <span className={`delivery-term-status ${item.term_signed_at ? "complete" : "pending"}`}>{item.term_signed_at ? <><Check size={12} aria-hidden="true" /> {item.term_signature_method === "physical_upload" ? "Assinado fisicamente" : "Assinado digitalmente"}</> : "Termo pendente de assinatura"}</span>
                  {hasMissingItem && !item.term_signed_at && <small className="return-line-legal-note">Baixa do material extraviado/furtado aguardando assinatura do termo.</small>}
                </div>
                <div className="recent-delivery-actions">
                  {!item.term_signed_at && <TermCopyLinkButton recordType="return" recordId={item.id} allowRenew />}
                  <button type="button" className="action-button" onClick={() => void downloadTerm(item)} disabled={downloadingId === item.id}><Download size={14} aria-hidden="true" /> {downloadingId === item.id ? "Preparando..." : item.term_signed_at ? "Baixar termo assinado" : "Baixar termo para assinatura"}</button>
                  {!item.term_signed_at && <label className="action-button upload-term-button"><Upload size={14} aria-hidden="true" /> {uploadingId === item.id ? "Enviando..." : "Anexar termo assinado"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadTerm(item, event)} disabled={uploadingId === item.id} /></label>}
                </div>
                <ClipboardList size={17} className="recent-delivery-date" aria-hidden="true" />
              </article>;
            })}
          </div>
          : <div className="empty-state"><ClipboardList size={27} aria-hidden="true" /><strong>Nenhuma devolução registrada</strong><span>As devoluções confirmadas aparecerão aqui.</span></div>}
    </section>
  );
}
