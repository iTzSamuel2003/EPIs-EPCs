"use client";

import { ClipboardList, Download, LoaderCircle, RotateCcw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ReturnSignatureModal } from "@/components/return-signature-modal";

type ReturnRecord = {
  id: string;
  returned_at: string;
  reason: string;
  term_file_path: string | null;
  term_signature_method: string | null;
  term_signed_at: string | null;
  employee: { full_name: string; registration: string | null; cpf: string } | null;
  return_items: Array<{
    quantity: number;
    material: { name: string; unit: string } | null;
    delivery_item: { variant: { name: string; size: string | null } | null } | null;
  }>;
};

const reasons: Record<string, string> = { replacement: "Substituição", termination: "Desligamento", role_change: "Alteração de função", damaged: "Equipamento danificado", voluntary: "Devolução voluntária", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");

export function RecentReturns() {
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await createClient().from("returns").select("id,returned_at,reason,term_file_path,term_signature_method,term_signed_at,employee:employees(full_name,registration,cpf),return_items(quantity,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size)))").order("returned_at", { ascending: false }).order("created_at", { ascending: false }).limit(10);
      if (loadError) setError(loadError.message); else setReturns((data ?? []) as unknown as ReturnRecord[]);
      setLoading(false);
    }
    void load();
    const refresh = () => { setLoading(true); void load(); };
    window.addEventListener("return-created", refresh);
    return () => window.removeEventListener("return-created", refresh);
  }, []);

  async function downloadTerm(item: ReturnRecord) {
    const { jsPDF } = await import("jspdf"); const doc = new jsPDF({ unit: "mm", format: "a4" }); const margin = 18; let y = 20;
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("EPIS+", margin, y); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("TERMO DE DEVOLUÇÃO DE MATERIAIS", margin, y + 7); y += 17; doc.setFontSize(9); doc.text(`Colaborador: ${item.employee?.full_name || "Não informado"}`, margin, y); doc.text(`Matrícula: ${item.employee?.registration || "Não informada"}`, margin + 95, y); y += 6; doc.text(`Data: ${date(item.returned_at)} · Motivo: ${reasons[item.reason] || item.reason}`, margin, y); y += 12; doc.setFont("helvetica", "bold"); doc.text("Materiais devolvidos", margin, y); y += 8; doc.setFont("helvetica", "normal"); item.return_items.forEach((returnItem) => { const variant = returnItem.delivery_item?.variant; const variation = variant ? ` · Tamanho ${variant.size || variant.name}` : ""; doc.text(`${returnItem.quantity}x ${returnItem.material?.name || "Material"}${variation}`, margin, y); y += 6; }); y += 12; doc.text("Declaro que os materiais acima foram devolvidos e conferidos.", margin, y); y += 35; doc.line(margin, y, margin + 72, y); doc.line(120, y, 192, y); doc.setFontSize(8); doc.text("Assinatura do colaborador", margin + 36, y + 5, { align: "center" }); doc.text("Responsável pelo controle", 156, y + 5, { align: "center" }); doc.save(`termo-devolucao-${(item.employee?.full_name || "colaborador").replace(/\s+/g, "-")}.pdf`);
  }

  return <section className="panel recent-deliveries-card recent-returns-card"><div className="panel-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas devoluções</h2><p>Devoluções registradas recentemente pelos colaboradores.</p></div><RotateCcw size={21} /></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando histórico...</div> : error ? <div className="feedback error-feedback">{error}</div> : returns.length ? <div className="recent-delivery-list">{returns.map((item) => <article className="recent-delivery-item" key={item.id}><div className="recent-delivery-icon recent-return-icon"><UserRound size={17} /></div><div className="recent-delivery-main"><strong>{item.employee?.full_name || "Funcionário não informado"}</strong><small>{item.employee?.registration ? `Matrícula ${item.employee.registration} · ` : ""}{date(item.returned_at)} · {reasons[item.reason] || item.reason}</small><div className="recent-delivery-materials">{item.return_items.map((returnItem, index) => { const variant = returnItem.delivery_item?.variant; return <span key={`${item.id}-${index}`}>{returnItem.quantity}x {returnItem.material?.name || "Material"}{variant ? ` · ${variant.size || variant.name}` : ""}</span>; })}</div><span className={`delivery-term-status ${item.term_signed_at ? "complete" : "pending"}`}>{item.term_signed_at ? "Assinado digitalmente" : "Termo pendente de assinatura"}</span></div><div className="recent-delivery-actions"><button type="button" className="action-button" onClick={() => void downloadTerm(item)}><Download size={14} /> Baixar termo</button>{!item.term_signed_at && <ReturnSignatureModal returnId={item.id} employeeName={item.employee?.full_name || "Colaborador"} employeeCpf={item.employee?.cpf || ""} employeeRegistration={item.employee?.registration || null} returnedAt={item.returned_at} reason={item.reason} items={item.return_items.map((returnItem) => ({ quantity: returnItem.quantity, material: returnItem.material, variant: returnItem.delivery_item?.variant || null }))} currentPath={item.term_file_path} onComplete={(path) => setReturns((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, term_file_path: path, term_signature_method: "assisted", term_signed_at: new Date().toISOString() } : currentItem))} />}</div><ClipboardList size={17} className="recent-delivery-date" /></article>)}</div> : <div className="empty-state"><ClipboardList size={27} /><strong>Nenhuma devolução registrada</strong><span>As devoluções confirmadas aparecerão aqui.</span></div>}</section>;
}
