"use client";

import { FormEvent, useEffect, useState } from "react";
import { Calendar, Check, Edit3, FileText, LoaderCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type EntryItem = { lot_id: string; lot_number: string; material_name: string; material_code: string; unit: string; quantity: string; available: number; unit_cost: string; manufactured_at: string; expires_at: string };
type Entry = { id: string; invoice_number: string; issued_at: string | null; notes: string | null; items: EntryItem[] };
type Props = { refreshKey?: number };

function date(value: string | null) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "—"; }

export function RecentStockEntries({ refreshKey = 0 }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EntryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    const supabase = createClient();
    const { data: invoiceData, error: invoiceError } = await supabase.from("stock_invoices").select("id,invoice_number,issued_at,notes").order("created_at", { ascending: false }).limit(10);
    if (invoiceError) { setError(invoiceError.message); setLoading(false); return; }
    const invoices = (invoiceData ?? []) as Array<{ id: string; invoice_number: string; issued_at: string | null; notes: string | null }>;
    const ids = invoices.map((invoice) => invoice.id);
    const { data: lotData, error: lotError } = ids.length ? await supabase.from("material_lots").select("id,invoice_id,lot_number,received_quantity,available_quantity,unit_cost,manufactured_at,expires_at,materials(name,internal_code,unit)").in("invoice_id", ids).order("created_at") : { data: [], error: null };
    if (lotError) { setError(lotError.message); setLoading(false); return; }
    const lots = (lotData ?? []) as unknown as Array<{ id: string; invoice_id: string; lot_number: string; received_quantity: number; available_quantity: number; unit_cost: number; manufactured_at: string | null; expires_at: string | null; materials: { name: string; internal_code: string; unit: string } | null }>;
    setEntries(invoices.map((invoice) => ({ id: invoice.id, invoice_number: invoice.invoice_number, issued_at: invoice.issued_at, notes: invoice.notes, items: lots.filter((lot) => lot.invoice_id === invoice.id).map((lot) => ({ lot_id: lot.id, lot_number: lot.lot_number, material_name: lot.materials?.name ?? "Material", material_code: lot.materials?.internal_code ?? "", unit: lot.materials?.unit ?? "un.", quantity: String(lot.received_quantity), available: lot.available_quantity, unit_cost: String(lot.unit_cost ?? 0), manufactured_at: lot.manufactured_at ?? "", expires_at: lot.expires_at ?? "" })) })));
    setLoading(false);
  }
  useEffect(() => { void load(); }, [refreshKey]);
  function openEdit(entry: Entry) { setEditing(entry); setInvoiceNumber(entry.invoice_number); setEntryDate(entry.issued_at ?? ""); setNotes(entry.notes ?? ""); setItems(entry.items.map((item) => ({ ...item }))); setError(""); setSuccess(""); }
  function updateItem(index: number, field: keyof EntryItem, value: string) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); }
  async function save(event: FormEvent) { event.preventDefault(); if (!editing) return; setSaving(true); setError(""); setSuccess(""); const { error: saveError } = await createClient().rpc("update_stock_entry_invoice", { p_invoice_id: editing.id, p_invoice_number: invoiceNumber, p_entry_date: entryDate || null, p_notes: notes || null, p_items: items.map((item) => ({ lot_id: item.lot_id, lot_number: item.lot_number, quantity: Number(item.quantity), unit_cost: Number(item.unit_cost) || 0, manufactured_at: item.manufactured_at || null, expires_at: item.expires_at || null })) }); if (saveError) setError(saveError.message); else { setSuccess("Entrada corrigida e estoque atualizado."); setEditing(null); await load(); } setSaving(false); }
  return <section className="panel module-table-card recent-entries-card"><div className="panel-header"><div><h2>Últimas entradas</h2><p>Notas e materiais recebidos recentemente.</p></div><FileText size={20} /></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando lançamentos...</div> : entries.length ? <div className="table-wrap"><table><thead><tr><th>NOTA</th><th>DATA</th><th>MATERIAIS</th><th>QUANTIDADE</th><th>AÇÃO</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><strong>{entry.invoice_number}</strong><small>{entry.notes || "Sem observações"}</small></td><td>{date(entry.issued_at)}</td><td>{entry.items.map((item) => <small className="recent-entry-material" key={item.lot_id}>{item.material_name} · {item.lot_number}</small>)}</td><td>{entry.items.reduce((sum, item) => sum + Number(item.quantity), 0)}</td><td><button className="action-button" type="button" onClick={() => openEdit(entry)}><Edit3 size={14} /> Editar</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><Calendar size={27} /><strong>Nenhuma entrada registrada</strong><span>As notas lançadas aparecerão aqui.</span></div>}{success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{editing && <div className="modal-backdrop"><section className="modal-card stock-entry-edit-modal"><div className="modal-header"><div><p className="eyebrow">CORREÇÃO DE ESTOQUE</p><h2>Editar entrada</h2></div><button className="close-modal" type="button" onClick={() => setEditing(null)}><X size={19} /></button></div><form className="material-form" onSubmit={save}><div className="form-grid two"><label>Número da nota<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} required /></label><label>Data da entrada<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label></div><div className="stock-entry-edit-items">{items.map((item, index) => <div className="stock-entry-edit-item" key={item.lot_id}><div><strong>{item.material_name}</strong><small>{item.material_code} · Disponível: {item.available} {item.unit}</small></div><label>Lote<input value={item.lot_number} onChange={(event) => updateItem(index, "lot_number", event.target.value)} required /></label><label>Quantidade<input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required /></label><label>Custo unitário<input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(event) => updateItem(index, "unit_cost", event.target.value)} required /></label><label>Fabricação<input type="date" value={item.manufactured_at} onChange={(event) => updateItem(index, "manufactured_at", event.target.value)} /></label><label>Validade<input type="date" value={item.expires_at} onChange={(event) => updateItem(index, "expires_at", event.target.value)} /></label></div>)}</div><label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></label>{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Corrigindo..." : "Salvar correção"}<Check size={16} /></button></div></form></section></div>}</section>;
}
