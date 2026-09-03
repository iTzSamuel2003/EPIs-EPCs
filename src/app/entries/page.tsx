"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, ClipboardList, FileImage, Plus, X } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type MaterialOption = { id: string; name: string; internal_code: string; unit: string };
type EntryForm = { material_id: string; lot_number: string; quantity: string; entry_date: string; manufactured_at: string; expires_at: string; invoice_number: string; notes: string };
const initialForm: EntryForm = { material_id: "", lot_number: "", quantity: "1", entry_date: new Date().toISOString().slice(0, 10), manufactured_at: "", expires_at: "", invoice_number: "", notes: "" };

export default function EntriesPage() {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [form, setForm] = useState<EntryForm>(initialForm);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  async function loadMaterials() { const { data, error: loadError } = await createClient().from("materials").select("id, name, internal_code, unit").eq("status", "active").order("name"); if (loadError) setError(loadError.message); else setMaterials((data ?? []) as MaterialOption[]); setLoading(false); }
  useEffect(() => { void Promise.resolve().then(() => loadMaterials()); }, []);
  function update(field: keyof EntryForm, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0] ?? null; setError(""); if (file && file.size > 10 * 1024 * 1024) { setError("A nota fiscal deve ter no mÃ¡ximo 10 MB."); setInvoiceFile(null); return; } setInvoiceFile(file); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    const supabase = createClient(); let uploadedPath = "";
    if (invoiceFile) {
      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single() : { data: null };
      if (!profile?.organization_id) { setError("NÃ£o foi possÃ­vel identificar a organizaÃ§Ã£o do usuÃ¡rio."); setSaving(false); return; }
      uploadedPath = `${profile.organization_id}/${crypto.randomUUID()}-${invoiceFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage.from("invoice-attachments").upload(uploadedPath, invoiceFile, { contentType: invoiceFile.type, upsert: false });
      if (uploadError) { setError(`NÃ£o foi possÃ­vel anexar a nota fiscal: ${uploadError.message}`); setSaving(false); return; }
    }
    const { error: entryError } = await supabase.rpc("register_stock_entry", { p_material_id: form.material_id, p_lot_number: form.lot_number, p_quantity: Number(form.quantity), p_entry_date: form.entry_date || null, p_manufactured_at: form.manufactured_at || null, p_expires_at: form.expires_at || null, p_invoice_number: form.invoice_number || null, p_notes: form.notes || null, p_invoice_file_path: uploadedPath || null });
    if (entryError) { if (uploadedPath) await supabase.storage.from("invoice-attachments").remove([uploadedPath]); setError(entryError.message); } else { setSuccess("Entrada registrada e nota fiscal anexada com sucesso."); setForm({ ...initialForm, entry_date: new Date().toISOString().slice(0, 10) }); setInvoiceFile(null); }
    setSaving(false);
  }
  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">MOVIMENTAÃ‡ÃƒO DE ESTOQUE</p><h1>Entrada de materiais</h1><p className="module-subtitle">Registre lotes recebidos e mantenha o histÃ³rico de entradas.</p></div><Link className="secondary-button" href="/stock"><ArrowLeft size={16} /> Ver estoque</Link></header>{success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="panel entry-card"><div className="entry-intro"><div className="entry-icon"><ClipboardList size={22} /></div><div><h2>Dados da entrada</h2><p>O sistema criarÃ¡ o lote e a movimentaÃ§Ã£o de entrada em uma Ãºnica operaÃ§Ã£o.</p></div></div><form className="material-form" onSubmit={submit}><div className="form-grid two"><label>Material<select value={form.material_id} onChange={(event) => update("material_id", event.target.value)} required disabled={loading}><option value="">Selecione um material</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.internal_code} Â· {material.name} ({material.unit})</option>)}</select></label><label>NÃºmero do lote<input value={form.lot_number} onChange={(event) => update("lot_number", event.target.value)} placeholder="Ex.: LOTE-2026-001" required /></label></div><div className="form-grid three"><label>Quantidade recebida<input type="number" min="1" value={form.quantity} onChange={(event) => update("quantity", event.target.value)} required /></label><label>Data da entrada<input type="date" value={form.entry_date} onChange={(event) => update("entry_date", event.target.value)} required /></label><label>Nota fiscal<input value={form.invoice_number} onChange={(event) => update("invoice_number", event.target.value)} placeholder="NF-000123" /></label></div><div className="form-grid two"><label>Data de fabricaÃ§Ã£o<input type="date" value={form.manufactured_at} onChange={(event) => update("manufactured_at", event.target.value)} /></label><label>Data de validade do lote<input type="date" value={form.expires_at} onChange={(event) => update("expires_at", event.target.value)} /></label></div><label className="file-upload">Foto ou PDF da nota fiscal<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={chooseFile} /><span><FileImage size={18} /> {invoiceFile ? invoiceFile.name : "Selecionar arquivo (mÃ¡x. 10 MB)"}</span></label><label>ObservaÃ§Ãµes<textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Fornecedor, conferÃªncia ou outras observaÃ§Ãµes" rows={3} /></label><div className="modal-actions"><button type="reset" className="secondary-button" onClick={() => { setForm(initialForm); setInvoiceFile(null); setError(""); }}>Limpar</button><button className="primary-button" disabled={saving || loading || !materials.length}>{saving ? "Registrando..." : "Registrar entrada"}<Plus size={16} /></button></div></form></section></main>;
}

