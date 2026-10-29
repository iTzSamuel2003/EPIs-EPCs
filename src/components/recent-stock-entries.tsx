"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, Calendar, Check, Edit3, FileText, LoaderCircle, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type CaCertificate = {
  ca_number: string;
  status: string | null;
  valid_until: string | null;
  process_number: string | null;
  manufacturer_document: string | null;
  manufacturer_name: string | null;
  equipment_name: string | null;
  equipment_description: string | null;
  brand: string | null;
  reference: string | null;
  standard: string | null;
  color: string | null;
  synced_at: string | null;
};
type EntryItem = { lot_id: string; lot_number: string; material_name: string; material_code: string; unit: string; quantity: string; available: number; unit_cost: string; manufactured_at: string; expires_at: string; ca_number: string; ca_expires_at: string; ca_certificate: CaCertificate | null; ca_lookup_failed: boolean };
type Entry = { id: string; base_id: string; base_name: string; invoice_number: string | null; without_invoice: boolean; issued_at: string | null; notes: string | null; created_by: string | null; created_at: string | null; created_by_name: string; items: EntryItem[] };
type Props = { refreshKey?: number };

function date(value: string | null) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "—"; }
function dateTime(value: string | null) {
  if (!value) return "Horário não registrado";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? "Horário não registrado"
    : timestamp.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function caSituation(certificate: CaCertificate) {
  const status = (certificate.status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  if (status.includes("cancel") || status.includes("suspens")) {
    return { label: certificate.status || "Cancelado ou suspenso", tone: "danger" };
  }
  if (certificate.valid_until && certificate.valid_until < localDateValue()) {
    return { label: "Vencido", tone: "danger" };
  }
  if (status.includes("venc")) return { label: certificate.status || "Vencido", tone: "danger" };
  if (certificate.valid_until || status.includes("valid") || status.includes("ativ")) {
    return { label: "Válido", tone: "success" };
  }
  return { label: certificate.status || "Situação não informada", tone: "warning" };
}
function dateOnly(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "Não informada";
}

export function RecentStockEntries({ refreshKey = 0 }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [confirming, setConfirming] = useState<Entry | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EntryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const saveLockRef = useRef(false);
  const deleteLockRef = useRef(false);

  async function load() {
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current;
    if (!isCurrent()) return;
    setLoading(true);
    setError("");
    setEntries([]);
    try {
    const supabase = createClient();
    const [{ data: invoiceData, error: invoiceError }, { data: baseData, error: baseError }] = await Promise.all([
      supabase.from("stock_invoices").select("id,base_id,invoice_number,without_invoice,issued_at,notes,created_by,created_at").order("created_at", { ascending: false }).limit(10),
      supabase.from("organization_bases").select("id,name"),
    ]);
    if (!isCurrent()) return;
    if (invoiceError || baseError) { setError(friendlyError(invoiceError ?? baseError, "Não foi possível carregar as entradas.")); return; }
    const baseNames = new Map(((baseData ?? []) as Array<{ id: string; name: string }>).map((base) => [base.id, base.name]));
    const invoices = (invoiceData ?? []) as Array<{ id: string; base_id: string; invoice_number: string | null; without_invoice: boolean; issued_at: string | null; notes: string | null; created_by: string | null; created_at: string | null }>;
    const ids = invoices.map((invoice) => invoice.id);
    const { data: lotData, error: lotError } = ids.length ? await supabase.from("material_lots").select("id,invoice_id,lot_number,received_quantity,available_quantity,unit_cost,manufactured_at,expires_at,ca_number,ca_expires_at,materials(name,internal_code,unit)").in("invoice_id", ids).order("created_at") : { data: [], error: null };
    if (!isCurrent()) return;
    if (lotError) { setError(friendlyError(lotError, "Não foi possível carregar os lotes.")); return; }
    const lots = (lotData ?? []) as unknown as Array<{ id: string; invoice_id: string; lot_number: string; received_quantity: number; available_quantity: number; unit_cost: number; manufactured_at: string | null; expires_at: string | null; ca_number: string | null; ca_expires_at: string | null; materials: { name: string; internal_code: string; unit: string } | null }>;
    const caNumbers = [...new Set(lots.map((lot) => lot.ca_number?.trim()).filter((number): number is string => Boolean(number)))];
    const { data: certificateData, error: certificateError } = caNumbers.length
      ? await supabase.from("ca_certificates").select("ca_number,status,valid_until,process_number,manufacturer_document,manufacturer_name,equipment_name,equipment_description,brand,reference,standard,color,synced_at").in("ca_number", caNumbers)
      : { data: [], error: null };
    if (!isCurrent()) return;
    const certificates = new Map(
      ((certificateData ?? []) as CaCertificate[]).map((certificate) => [certificate.ca_number, certificate]),
    );
    const creatorIds = [...new Set(invoices.map((invoice) => invoice.created_by).filter((id): id is string => Boolean(id)))];
    const { data: profileData } = creatorIds.length
      ? await supabase.from("profiles").select("id,full_name").in("id", creatorIds)
      : { data: [] };
    if (!isCurrent()) return;
    const creatorNames = new Map(
      ((profileData ?? []) as Array<{ id: string; full_name: string }>).map((profile) => [profile.id, profile.full_name]),
    );
    setEntries(invoices.map((invoice) => ({
      id: invoice.id,
      base_id: invoice.base_id,
      base_name: baseNames.get(invoice.base_id) || "Base não identificada",
      invoice_number: invoice.invoice_number,
      without_invoice: invoice.without_invoice,
      issued_at: invoice.issued_at,
      notes: invoice.notes,
      created_by: invoice.created_by,
      created_at: invoice.created_at,
      created_by_name: (invoice.created_by && creatorNames.get(invoice.created_by)) || "Usuário não identificado",
      items: lots.filter((lot) => lot.invoice_id === invoice.id).map((lot) => ({
        lot_id: lot.id,
        lot_number: lot.lot_number,
        material_name: lot.materials?.name ?? "Material",
        material_code: lot.materials?.internal_code || "Código não informado",
        unit: lot.materials?.unit ?? "un.",
        quantity: String(lot.received_quantity),
        available: lot.available_quantity,
        unit_cost: String(lot.unit_cost ?? 0),
        manufactured_at: lot.manufactured_at ?? "",
        expires_at: lot.expires_at ?? "",
        ca_number: lot.ca_number ?? "",
        ca_expires_at: lot.ca_expires_at ?? "",
        ca_certificate: lot.ca_number ? certificates.get(lot.ca_number.trim()) ?? null : null,
        ca_lookup_failed: Boolean(certificateError),
      })),
    })));
    } catch (caughtError) {
      if (!isCurrent()) return;
      setError(friendlyError(caughtError, "Não foi possível carregar as entradas."));
    } finally {
      if (!isCurrent()) return;
      setLoading(false);
    }
  }
  useEffect(() => { mountedRef.current = true; void load(); return () => { mountedRef.current = false; requestRef.current += 1; }; }, [refreshKey, retryKey]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);
  function openEdit(entry: Entry) { setEditing(entry); setInvoiceNumber(entry.invoice_number ?? ""); setEntryDate(entry.issued_at ?? ""); setNotes(entry.notes ?? ""); setItems(entry.items.map((item) => ({ ...item }))); setError(""); setSuccess(""); }
  function updateItem(index: number, field: keyof EntryItem, value: string) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || saveLockRef.current) return;
    saveLockRef.current = true;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { error: saveError } = await createClient().rpc("update_stock_entry_invoice", { p_invoice_id: editing.id, p_invoice_number: invoiceNumber, p_entry_date: entryDate || null, p_notes: notes || null, p_items: items.map((item) => ({ lot_id: item.lot_id, lot_number: item.lot_number, quantity: Number(item.quantity), unit_cost: Number(item.unit_cost) || 0, manufactured_at: item.manufactured_at || null, expires_at: item.expires_at || null })) });
      if (saveError) setError(friendlyError(saveError, "Não foi possível corrigir a entrada."));
      else { setSuccess("Entrada corrigida e estoque atualizado."); setEditing(null); await load(); }
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível corrigir a entrada."));
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }
  async function deleteEntry(entry: Entry) {
    if (deleteLockRef.current) return;
    deleteLockRef.current = true;
    setDeleting(true);
    setConfirming(null);
    setError("");
    setSuccess("");
    try {
      const supabase = createClient();
      const { data: filePath, error: deleteError } = await supabase.rpc("delete_stock_entry_invoice", { p_invoice_id: entry.id });
      if (deleteError) { setError(friendlyError(deleteError, "Não foi possível excluir a entrada.")); return; }
      const { error: attachmentError } = filePath ? await supabase.storage.from("invoice-attachments").remove([filePath as string]) : { error: null };
      setSuccess(attachmentError ? "Entrada excluída e estoque atualizado, mas o anexo não pôde ser removido." : "Entrada excluída e estoque atualizado.");
      if (attachmentError) setError("A entrada foi excluída, mas o anexo não pôde ser removido.");
      await load();
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível excluir a entrada."));
    } finally {
      deleteLockRef.current = false;
      setDeleting(false);
    }
  }
  return (
    <section className="panel module-table-card recent-entries-card">
      <div className="panel-header">
        <div>
          <h2>Últimas entradas</h2>
          <p>Notas e materiais recebidos recentemente.</p>
        </div>
        <FileText size={20} />
      </div>

      {loading ? (
        <div className="module-loading" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} /> Carregando lançamentos...
        </div>
      ) : entries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MATERIAL</th>
                <th>DATA</th>
                <th>NOTA</th>
                <th>QUANTIDADE</th>
                <th>REGISTRADA POR</th>
                <th>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="recent-entry-materials-cell">
                    <div className="recent-entry-materials">
                      {entry.items.length ? entry.items.map((item) => (
                        <div className="recent-entry-material" key={item.lot_id}>
                          <strong>{item.material_name}</strong>
                          <small>Lote {item.lot_number}</small>
                        </div>
                      )) : <span className="muted-cell">Sem materiais registrados</span>}
                    </div>
                  </td>
                  <td>{date(entry.issued_at)}</td>
                  <td>
                    <strong>{entry.without_invoice ? "Sem nota fiscal" : entry.invoice_number}</strong>
                    <small>{entry.base_name} · {entry.notes || "Sem observações"}</small>
                  </td>
                  <td>{entry.items.reduce((sum, item) => sum + Number(item.quantity), 0)}</td>
                  <td className="recent-entry-creator">
                    <strong>{entry.created_by_name}</strong>
                    <small>{dateTime(entry.created_at)}</small>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="action-button" type="button" onClick={() => openEdit(entry)}>
                        <Edit3 size={14} /> Editar
                      </button>
                      <button className="action-button danger-action" type="button" disabled={deleting} onClick={() => setConfirming(entry)}>
                        <Trash2 size={14} /> Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Calendar size={27} />
          <strong>Nenhuma entrada registrada</strong>
          <span>As notas lançadas aparecerão aqui.</span>
        </div>
      )}

      {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}
      {error && !editing && <FeedbackMessage onRetry={() => setRetryKey((current) => current + 1)}>{error}</FeedbackMessage>}

      {confirming && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirming(null); }}>
          <section className="modal-card delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-entry-title">
            <div className="delete-confirm-icon"><AlertTriangle size={24} /></div>
            <h2 id="delete-entry-title">Excluir nota fiscal?</h2>
            <p>Você está prestes a excluir a nota <strong>{confirming.without_invoice ? "sem nota fiscal" : confirming.invoice_number}</strong>, seus lotes e movimentações de entrada.</p>
            <p className="delete-confirm-stock-warning">Os materiais lançados por essa nota serão retirados do estoque.</p>
            <p className="delete-confirm-warning">Essa ação não poderá ser desfeita.</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirming(null)}>Cancelar</button>
              <button type="button" className="danger-button" disabled={deleting} onClick={() => void deleteEntry(confirming)}>
                <Trash2 size={16} /> {deleting ? "Excluindo..." : "Excluir nota"}
              </button>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card stock-entry-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-stock-entry-title">
            <div className="modal-header">
              <div>
                <p className="eyebrow">CORREÇÃO DE ESTOQUE</p>
                <h2 id="edit-stock-entry-title">Editar entrada</h2>
              </div>
              <button className="close-modal" type="button" onClick={() => setEditing(null)} aria-label="Fechar"><X size={19} /></button>
            </div>
            <form className="material-form" onSubmit={save}>
              <div className="form-grid two">
                <label>Número da nota (opcional)<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
                <label>Data da entrada<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
              </div>
              <div className="stock-entry-edit-items">
                {items.map((item, index) => (
                  <div className="stock-entry-edit-item" key={item.lot_id}>
                    <div className="stock-entry-edit-material">
                      <strong>{item.material_name}</strong>
                      <small>{item.material_code} · Disponível: {item.available} {item.unit}</small>
                    </div>
                    <label>Lote<input value={item.lot_number} onChange={(event) => updateItem(index, "lot_number", event.target.value)} required /></label>
                    <label>Quantidade<input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required /></label>
                    <label>Custo unitário<input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(event) => updateItem(index, "unit_cost", event.target.value)} required /></label>
                    <label>Fabricação<input type="date" value={item.manufactured_at} onChange={(event) => updateItem(index, "manufactured_at", event.target.value)} /></label>
                    <label>Validade<input type="date" value={item.expires_at} onChange={(event) => updateItem(index, "expires_at", event.target.value)} /></label>
                    <div className="material-ca-lookup found stock-entry-edit-ca-details">
                      <div className="material-ca-lookup-heading">
                        <strong>{item.ca_number ? `Certificado de Aprovação · CA ${item.ca_number}` : "Certificado de Aprovação"}</strong>
                        {item.ca_certificate ? (
                          <span className={`material-ca-status ${caSituation(item.ca_certificate).tone}`}>
                            {caSituation(item.ca_certificate).label}
                          </span>
                        ) : (
                          <span className="material-ca-status warning">
                            {item.ca_number ? item.ca_lookup_failed ? "Consulta indisponível" : "Não localizado" : "Não informado"}
                          </span>
                        )}
                      </div>
                      {item.ca_certificate ? (
                        <>
                          <dl className="material-ca-lookup-grid">
                            <div><dt>Equipamento</dt><dd>{item.ca_certificate.equipment_name || "Não informado"}</dd></div>
                            <div><dt>Fabricante / CNPJ</dt><dd>{item.ca_certificate.manufacturer_name || "Não informado"}{item.ca_certificate.manufacturer_document ? ` · ${item.ca_certificate.manufacturer_document}` : ""}</dd></div>
                            <div><dt>Marca</dt><dd>{item.ca_certificate.brand || "Não informada"}</dd></div>
                            <div><dt>Referência</dt><dd>{item.ca_certificate.reference || "Não informada"}</dd></div>
                            <div><dt>Norma</dt><dd>{item.ca_certificate.standard || "Não informada"}</dd></div>
                            <div><dt>Processo</dt><dd>{item.ca_certificate.process_number || "Não informado"}</dd></div>
                            <div><dt>Validade oficial do CA</dt><dd>{dateOnly(item.ca_certificate.valid_until)}</dd></div>
                            <div><dt>Validade registrada no lote</dt><dd>{dateOnly(item.ca_expires_at || null)}</dd></div>
                            {item.ca_certificate.color && <div><dt>Cor</dt><dd>{item.ca_certificate.color}</dd></div>}
                            <div className="material-ca-description"><dt>Descrição</dt><dd>{item.ca_certificate.equipment_description || "Não informada."}</dd></div>
                          </dl>
                          <small>{item.ca_certificate.synced_at ? `Dados da base sincronizada em ${new Date(item.ca_certificate.synced_at).toLocaleString("pt-BR")}.` : "Dados da base sincronizada."}</small>
                        </>
                      ) : (
                        <p>{item.ca_number ? item.ca_lookup_failed ? "Não foi possível carregar os dados oficiais agora. O número e a validade salvos no lote continuam visíveis." : "Este número não foi encontrado na base sincronizada." : "Nenhum número de CA foi registrado neste lote."} Validade registrada no lote: {dateOnly(item.ca_expires_at || null)}.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>
              {error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button>
                <button className="primary-button" disabled={saving}>{saving ? "Corrigindo..." : "Salvar correção"}<Check size={16} /></button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
