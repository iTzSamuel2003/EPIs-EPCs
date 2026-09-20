"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Check, ClipboardList, Download, LoaderCircle, RotateCcw, Upload, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ReturnSignatureModal } from "@/components/return-signature-modal";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type ReturnItem = { quantity: number; material: { name: string; unit: string } | null; delivery_item: { variant: { name: string; size: string | null } | null } | null };
type ReturnRecord = { id: string; returned_at: string; reason: string; term_file_path: string | null; term_signature_method: string | null; term_signed_at: string | null; employee: { full_name: string; registration: string | null; cpf: string } | null; return_items: ReturnItem[] };

const reasons: Record<string, string> = { replacement: "Substituição", termination: "Desligamento", role_change: "Alteração de função", damaged: "Equipamento danificado", voluntary: "Devolução voluntária", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const allowedTermTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const maxTermSize = 10 * 1024 * 1024;

export function RecentReturns() {
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
    async function load() {
      const requestId = ++requestRef.current;
      setLoading(true); setError(""); setReturns([]);
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        if (active && requestId === requestRef.current) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); setLoading(false); }
        return;
      }
      const { data, error: loadError } = await supabase.from("returns").select("id,returned_at,reason,term_file_path,term_signature_method,term_signed_at,employee:employees(full_name,registration,cpf),return_items(quantity,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size)))").order("returned_at", { ascending: false }).order("created_at", { ascending: false }).limit(10);
      if (!active || requestId !== requestRef.current) return;
      if (loadError) setError(friendlyError(loadError, "Não foi possível carregar as devoluções.")); else setReturns((data ?? []) as unknown as ReturnRecord[]);
      setLoading(false);
    }
    void load().catch((caught) => {
      if (active && requestRef.current > 0) {
        setError(friendlyError(caught, "Nao foi possivel carregar as devolucoes."));
        setLoading(false);
      }
    });
    const refresh = () => { void load().catch((caught) => { if (active) { setError(friendlyError(caught, "Nao foi possivel atualizar as devolucoes.")); setLoading(false); } }); };
    window.addEventListener("return-created", refresh);
    return () => { active = false; window.removeEventListener("return-created", refresh); };
  }, [retryKey]);

  async function downloadTerm(item: ReturnRecord) {
    if (downloadingRef.current === item.id) return;
    downloadingRef.current = item.id; setDownloadingId(item.id); setError("");
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" }); const margin = 18; let y = 20;
      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("EPIS+", margin, y); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("TERMO DE DEVOLUÇÃO DE MATERIAIS", margin, y + 7); y += 17;
      doc.setFontSize(9); doc.text(`Colaborador: ${item.employee?.full_name || "Não informado"}`, margin, y); doc.text(`Matrícula: ${item.employee?.registration || "Não informada"}`, margin + 95, y); y += 6; doc.text(`Data: ${date(item.returned_at)} · Motivo: ${reasons[item.reason] || item.reason}`, margin, y); y += 12;
      doc.setFont("helvetica", "bold"); doc.text("Materiais devolvidos", margin, y); y += 8; doc.setFont("helvetica", "normal");
      item.return_items.forEach((returnItem) => { const variant = returnItem.delivery_item?.variant; const variation = variant ? ` · Tamanho ${variant.size || variant.name}` : ""; doc.text(`${returnItem.quantity}x ${returnItem.material?.name || "Material"}${variation}`, margin, y); y += 6; });
      y += 12; doc.text("Declaro que os materiais acima foram devolvidos e conferidos.", margin, y); y += 35; doc.line(margin, y, margin + 72, y); doc.line(120, y, 192, y); doc.setFontSize(8); doc.text("Assinatura do colaborador", margin + 36, y + 5, { align: "center" }); doc.text("Responsável pelo controle", 156, y + 5, { align: "center" });
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

  return <section className="panel recent-deliveries-card recent-returns-card"><div className="panel-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas devoluções</h2><p>Devoluções registradas recentemente pelos colaboradores.</p></div><RotateCcw size={21} aria-hidden="true" /></div>{loading ? <div className="module-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando histórico...</div> : error ? <FeedbackMessage onRetry={() => setRetryKey((current) => current + 1)}>{error}</FeedbackMessage> : returns.length ? <div className="recent-delivery-list" role="list" aria-label="Últimas devoluções">{returns.map((item) => <article className="recent-delivery-item" key={item.id} role="listitem"><div className="recent-delivery-icon recent-return-icon"><UserRound size={17} aria-hidden="true" /></div><div className="recent-delivery-main"><strong>{item.employee?.full_name || "Funcionário não informado"}</strong><small>{item.employee?.registration ? `Matrícula ${item.employee.registration} · ` : ""}{date(item.returned_at)} · {reasons[item.reason] || item.reason}</small><div className="recent-delivery-materials" aria-label="Materiais devolvidos">{item.return_items.map((returnItem, index) => { const variant = returnItem.delivery_item?.variant; return <span key={`${item.id}-${index}`}>{returnItem.quantity}x {returnItem.material?.name || "Material"}{variant ? ` · ${variant.size || variant.name}` : ""}</span>; })}</div><span className={`delivery-term-status ${item.term_signed_at ? "complete" : "pending"}`}>{item.term_signed_at ? <><Check size={12} aria-hidden="true" /> {item.term_signature_method === "physical_upload" ? "Assinado fisicamente" : "Assinado digitalmente"}</> : "Termo pendente de assinatura"}</span></div><div className="recent-delivery-actions"><button type="button" className="action-button" onClick={() => void downloadTerm(item)} disabled={downloadingId === item.id}><Download size={14} aria-hidden="true" /> {downloadingId === item.id ? "Gerando..." : "Baixar termo para assinatura"}</button>{!item.term_signed_at && <ReturnSignatureModal returnId={item.id} employeeName={item.employee?.full_name || "Colaborador"} employeeCpf={item.employee?.cpf || ""} employeeRegistration={item.employee?.registration || null} returnedAt={item.returned_at} reason={item.reason} items={item.return_items.map((returnItem) => ({ quantity: returnItem.quantity, material: returnItem.material, variant: returnItem.delivery_item?.variant || null }))} currentPath={item.term_file_path} onComplete={(path) => setReturns((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, term_file_path: path, term_signature_method: "assisted", term_signed_at: new Date().toISOString() } : currentItem))} />}{!item.term_signed_at && <label className="action-button upload-term-button"><Upload size={14} aria-hidden="true" /> {uploadingId === item.id ? "Enviando..." : "Anexar termo assinado"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadTerm(item, event)} disabled={uploadingId === item.id} /></label>}</div><ClipboardList size={17} className="recent-delivery-date" aria-hidden="true" /></article>)}</div> : <div className="empty-state"><ClipboardList size={27} aria-hidden="true" /><strong>Nenhuma devolução registrada</strong><span>As devoluções confirmadas aparecerão aqui.</span></div>}</section>;
}
