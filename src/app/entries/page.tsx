"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, ClipboardList, FileImage, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type MaterialOption = { id: string; name: string; internal_code: string; unit: string };
type EntryItem = { material_id: string; lot_number: string; quantity: string; unit_cost: string; manufactured_at: string; expires_at: string };
const newItem = (): EntryItem => ({ material_id: "", lot_number: "", quantity: "1", unit_cost: "0", manufactured_at: "", expires_at: "" });

export default function EntriesPage() {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [items, setItems] = useState<EntryItem[]>([newItem()]);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");

  async function loadMaterials() { const { data, error: loadError } = await createClient().from("materials").select("id, name, internal_code, unit").eq("status", "active").order("name"); if (loadError) setError(loadError.message); else setMaterials((data ?? []) as MaterialOption[]); setLoading(false); }
  useEffect(() => { void Promise.resolve().then(() => loadMaterials()); }, []);
  function updateItem(index: number, field: keyof EntryItem, value: string) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); }
  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0] ?? null; setError(""); if (file && file.size > 10 * 1024 * 1024) { setError("A nota fiscal deve ter no máximo 10 MB."); setInvoiceFile(null); return; } setInvoiceFile(file); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    if (items.some((item) => !item.material_id || !item.lot_number.trim() || Number(item.quantity) <= 0)) { setError("Preencha material, lote e quantidade de todos os itens."); return; }
    if (invoiceFile && !invoiceNumber.trim()) { setError("Informe o número da nota fiscal antes de anexar o arquivo."); return; }
    setSaving(true); const supabase = createClient(); let uploadedPath = "";
    if (invoiceFile) {
      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single() : { data: null };
      if (!profile?.organization_id) { setError("Não foi possível identificar a organização do usuário."); setSaving(false); return; }
      uploadedPath = `${profile.organization_id}/${crypto.randomUUID()}-${invoiceFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage.from("invoice-attachments").upload(uploadedPath, invoiceFile, { contentType: invoiceFile.type, upsert: false });
      if (uploadError) { setError(`Não foi possível anexar a nota fiscal: ${uploadError.message}`); setSaving(false); return; }
    }
    const { data: invoiceId, error: entryError } = await supabase.rpc("register_stock_entry_batch", { p_invoice_number: invoiceNumber || null, p_entry_date: entryDate || null, p_items: items.map((item) => ({ material_id: item.material_id, lot_number: item.lot_number.trim(), quantity: Number(item.quantity), manufactured_at: item.manufactured_at || null, expires_at: item.expires_at || null })), p_invoice_file_path: uploadedPath || null, p_notes: notes || null });
    if (!entryError && invoiceId) { for (const item of items) await supabase.from("material_lots").update({ unit_cost: Number(item.unit_cost) || 0 }).eq("invoice_id", invoiceId).eq("material_id", item.material_id).eq("lot_number", item.lot_number.trim()); }
    if (entryError) { if (uploadedPath) await supabase.storage.from("invoice-attachments").remove([uploadedPath]); setError(entryError.message); } else { setSuccess(items.length > 1 ? "Nota fiscal e itens registrados com sucesso." : "Entrada registrada e nota fiscal anexada com sucesso."); setItems([newItem()]); setInvoiceNumber(""); setEntryDate(new Date().toISOString().slice(0, 10)); setInvoiceFile(null); setNotes(""); }
    setSaving(false);
  }
  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE ESTOQUE</p><h1>Entrada de materiais</h1><p className="module-subtitle">Registre vários produtos da mesma nota fiscal em uma única operação.</p></div><Link className="secondary-button" href="/stock"><ArrowLeft size={16} /> Ver estoque</Link></header>{success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="panel entry-card"><div className="entry-intro"><div className="entry-icon"><ClipboardList size={22} /></div><div><h2>Nota fiscal e itens recebidos</h2><p>Informe a nota uma vez e adicione todos os produtos e lotes relacionados.</p></div></div><form className="material-form" onSubmit={submit}><div className="form-grid two"><label>Número da nota fiscal<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="NF-000123" /></label><label>Data da entrada<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required /></label></div><label className="file-upload">Foto ou PDF da nota fiscal<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={chooseFile} /><span><FileImage size={18} /> {invoiceFile ? invoiceFile.name : "Selecionar arquivo (máx. 10 MB)"}</span></label><div className="delivery-items-header"><div><h3>Produtos da nota</h3><p>Uma linha para cada material ou lote recebido.</p></div><button type="button" className="secondary-button" onClick={() => setItems((current) => [...current, newItem()])}><Plus size={15} /> Adicionar produto</button></div><div className="delivery-items">{items.map((item, index) => <div className="delivery-item-row entry-item-row" key={index}><span className="item-index">{index + 1}</span><label>Material<select value={item.material_id} onChange={(event) => updateItem(index, "material_id", event.target.value)} required disabled={loading}><option value="">Selecione</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.internal_code} · {material.name} ({material.unit})</option>)}</select></label><label>Lote<input value={item.lot_number} onChange={(event) => updateItem(index, "lot_number", event.target.value)} placeholder="LOTE-2026-001" required /></label><label>Quantidade<input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required /></label><label>Custo unitário (R$)<input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(event) => updateItem(index, "unit_cost", event.target.value)} required /></label><label>Fabricação<input type="date" value={item.manufactured_at} onChange={(event) => updateItem(index, "manufactured_at", event.target.value)} /></label><label>Validade<input type="date" value={item.expires_at} onChange={(event) => updateItem(index, "expires_at", event.target.value)} /></label>{items.length > 1 && <button type="button" className="remove-item" aria-label={`Remover produto ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>}</div>)}</div><label>Observações da nota<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Fornecedor, conferência ou outras observações" rows={3} /></label><div className="modal-actions"><button type="reset" className="secondary-button" onClick={() => { setItems([newItem()]); setInvoiceNumber(""); setInvoiceFile(null); setNotes(""); setError(""); }}>Limpar</button><button className="primary-button" disabled={saving || loading || !materials.length}>{saving ? "Registrando..." : "Registrar entrada"}<Plus size={16} /></button></div></form></section></main>;
}
