"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, Download, LoaderCircle, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type RequestRow = { id: string; request_type: string; description: string; status: string; review_notes: string | null; attachment_path: string | null; created_at: string; updated_at: string; delivered_at: string | null; employee: { full_name: string; registration: string | null } | null; delivery_item: { material: { name: string; unit: string } | null; lot: { lot_number: string } | null } | null };
type Confirmation = { item: RequestRow; status: string };
const requestLabels: Record<string, string> = { replacement: "Troca de material", return: "Devolução", new_material: "Novo material", course: "Curso", other: "Outra" };
const statusLabels: Record<string, string> = { pending: "Pendente", in_review: "Em análise", approved: "Aprovada", rejected: "Recusada", completed: "Entregue" };
const statusTone: Record<string, string> = { pending: "warning", in_review: "warning", approved: "success", completed: "success", rejected: "danger" };

function date(value: string) { return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }

export default function RequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [deliveredAtDraft, setDeliveredAtDraft] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true); setError("");
    const { data, error: loadError } = await createClient().from("employee_portal_requests").select("id,request_type,description,status,review_notes,attachment_path,created_at,updated_at,employee:employees(full_name,registration),delivery_item:delivery_items(material:materials(name,unit),lot:material_lots(lot_number))").order("created_at", { ascending: false });
    if (loadError) setError(loadError.message); else setRequests((data ?? []) as unknown as RequestRow[]);
    setLoading(false);
  }

  const filtered = useMemo(() => requests.filter((item) => {
    const text = `${item.employee?.full_name ?? ""} ${item.employee?.registration ?? ""} ${item.delivery_item?.material?.name ?? ""} ${item.description}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (typeFilter === "all" || item.request_type === typeFilter) && (statusFilter === "all" || item.status === statusFilter);
  }), [requests, query, typeFilter, statusFilter]);

  function beginUpdate(item: RequestRow, status: string) { setNoteDraft(item.review_notes ?? ""); setDeliveredAtDraft(item.delivered_at ?? new Date().toISOString().slice(0, 10)); setConfirming({ item, status }); }
  function closeConfirmation() { if (!savingId) setConfirming(null); }

  async function updateRequest(item: RequestRow, status: string, note: string) {
    setSavingId(item.id); setError(""); setSuccess("");
    const { error: updateError } = await createClient().from("employee_portal_requests").update({ status, review_notes: note.trim() || null, delivered_at: status === "completed" ? deliveredAtDraft || new Date().toISOString().slice(0, 10) : null }).eq("id", item.id);
    if (updateError) setError(updateError.message); else {
      setRequests((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, status, review_notes: note.trim() || null, delivered_at: status === "completed" ? deliveredAtDraft || new Date().toISOString().slice(0, 10) : null, updated_at: new Date().toISOString() } : currentItem));
      setSuccess("Solicitação atualizada."); setConfirming(null);
    }
    setSavingId("");
  }

  async function openAttachment(item: RequestRow) {
    if (!item.attachment_path) return;
    setOpeningId(item.id); setError("");
    const { data, error: signedUrlError } = await createClient().storage.from("employee-request-attachments").createSignedUrl(item.attachment_path, 300);
    if (signedUrlError || !data?.signedUrl) setError(signedUrlError?.message ?? "Não foi possível abrir o anexo."); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    setOpeningId("");
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">ATENDIMENTO OPERACIONAL</p><h1>Solicitações</h1><p className="module-subtitle">Acompanhe pedidos enviados pelos colaboradores no portal.</p></div></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}
    {error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar funcionário, matrícula ou material" /></div><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos os tipos</option>{Object.entries(requestLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></section>
    <section className="module-summary"><div><strong>{requests.length}</strong><span>solicitações</span></div><div><strong>{requests.filter((item) => item.status === "pending").length}</strong><span>pendentes</span></div><div><strong>{requests.filter((item) => item.status === "in_review").length}</strong><span>em análise</span></div><div><strong>{requests.filter((item) => item.status === "completed").length}</strong><span>concluídas</span></div></section>
    <section className="panel module-table-card"><div className="panel-header"><div><h2>Solicitações recebidas</h2><p>{filtered.length} registro(s) listado(s)</p></div><ClipboardList size={20} /></div>
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando solicitações...</div> : filtered.length ? <div className="table-wrap"><table><thead><tr><th>DATA</th><th>FUNCIONÁRIO</th><th>MATERIAL</th><th>TIPO / DESCRIÇÃO</th><th>ANEXO</th><th>STATUS</th><th>AÇÃO</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td>{date(item.created_at)}</td><td><strong>{item.employee?.full_name || "Não informado"}</strong><small>{item.employee?.registration ? `Matrícula ${item.employee.registration}` : "Sem matrícula"}</small></td><td>{item.delivery_item?.material ? <><strong>{item.delivery_item.material.name}</strong><small>{item.delivery_item.lot?.lot_number || "Lote não informado"}</small></> : <span className="muted-cell">Não se aplica</span>}</td><td><strong>{requestLabels[item.request_type] || item.request_type}</strong><small>{item.description}</small>{item.review_notes && <small>Interna: {item.review_notes}</small>}</td><td>{item.attachment_path ? <button className="action-button" type="button" onClick={() => void openAttachment(item)} disabled={openingId === item.id}><Download size={14} /> {openingId === item.id ? "Abrindo..." : "Ver anexo"}</button> : <span className="muted-cell">Sem anexo</span>}</td><td><span className={`status-pill ${statusTone[item.status] || "warning"}`}>{statusLabels[item.status] || item.status}</span></td><td><select className="request-status-select" value={item.status} disabled={savingId === item.id} onChange={(event) => beginUpdate(item, event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td></tr>)}</tbody></table></div> : <div className="empty-state"><ClipboardList size={27} /><strong>Nenhuma solicitação encontrada</strong><span>Os pedidos enviados pelo portal aparecerão aqui.</span></div>}
    </section>
    {confirming && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeConfirmation(); }}><section className="modal-card request-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="request-confirm-title"><div className="request-confirm-icon"><ClipboardList size={23} /></div><div className="modal-header"><div><p className="eyebrow">ATUALIZAÇÃO DE SOLICITAÇÃO</p><h2 id="request-confirm-title">Confirmar alteração</h2></div><button className="close-modal" type="button" onClick={closeConfirmation} aria-label="Fechar"><X size={18} /></button></div><p className="request-confirm-description">Você está alterando a solicitação de <strong>{confirming.item.employee?.full_name || "funcionário"}</strong> para <strong>{statusLabels[confirming.status] || confirming.status}</strong>.</p><label className="request-confirm-note">{confirming.status === "rejected" ? "Motivo da recusa" : "Observação interna"}{confirming.status === "rejected" && <em> obrigatório</em>}<textarea autoFocus value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={4} placeholder={confirming.status === "rejected" ? "Explique por que a solicitação foi recusada." : "Adicione uma observação para o histórico (opcional)."} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={closeConfirmation}>Cancelar</button><button type="button" className={`primary-button ${confirming.status === "rejected" ? "request-confirm-danger" : ""}`} disabled={savingId === confirming.item.id || (confirming.status === "rejected" && !noteDraft.trim())} onClick={() => void updateRequest(confirming.item, confirming.status, noteDraft)}>{savingId === confirming.item.id ? "Salvando..." : `Confirmar ${statusLabels[confirming.status]?.toLowerCase() || "alteração"}`}<Check size={16} /></button></div></section></div>}
  </main>;
}
