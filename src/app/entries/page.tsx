"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, ClipboardList, FileImage, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { RecentStockEntries } from "@/components/recent-stock-entries";
import { createClient } from "@/lib/supabase/client";

type MaterialOption = { id: string; name: string; internal_code: string; unit: string; test_required: boolean };
type MaterialVariant = { id: string; material_id: string; name: string; size: string | null; active: boolean };
type EntryItem = { material_id: string; materialQuery: string; variant_id: string; lot_number: string; quantity: string; unit_cost: string; manufactured_at: string; expires_at: string; test_performed_at: string; test_expires_at: string };
const newItem = (): EntryItem => ({ material_id: "", materialQuery: "", variant_id: "", lot_number: "", quantity: "1", unit_cost: "0", manufactured_at: "", expires_at: "", test_performed_at: "", test_expires_at: "" });

export default function EntriesPage() {
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [variants, setVariants] = useState<MaterialVariant[]>([]);
  const [items, setItems] = useState<EntryItem[]>([newItem()]);
  const [materialSuggestionsOpen, setMaterialSuggestionsOpen] = useState<number | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [entriesRefreshKey, setEntriesRefreshKey] = useState(0);

  async function loadMaterials() {
    const supabase = createClient();
    const [{ data, error: loadError }, { data: variantData, error: variantError }] = await Promise.all([
      supabase.from("materials").select("id, name, internal_code, unit, test_required").eq("status", "active").order("name"),
      supabase.from("material_variants").select("id, material_id, name, size, active").eq("active", true).order("size"),
    ]);
    if (loadError || variantError) setError((loadError ?? variantError)?.message ?? "Não foi possível carregar os materiais.");
    else { setMaterials((data ?? []) as MaterialOption[]); setVariants((variantData ?? []) as MaterialVariant[]); }
    setLoading(false);
  }

  useEffect(() => { void Promise.resolve().then(() => loadMaterials()); }, []);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);

  function updateItem(index: number, field: keyof EntryItem, value: string) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function filteredMaterials(value: string) {
    const normalized = value.trim().toLowerCase();
    return materials.filter((material) => material.name.toLowerCase().includes(normalized));
  }

  function variantsFor(materialId: string) {
    return variants.filter((variant) => variant.material_id === materialId);
  }

  function selectMaterial(index: number, material: MaterialOption) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, material_id: material.id, materialQuery: material.name, variant_id: "", test_performed_at: "", test_expires_at: "" } : item));
    setMaterialSuggestionsOpen(null);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError("");
    if (file && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Anexe a nota em PDF, JPG, PNG ou WEBP."); setInvoiceFile(null); return; }
    if (file && file.size > 10 * 1024 * 1024) { setError("A nota fiscal deve ter no máximo 10 MB."); setInvoiceFile(null); return; }
    setInvoiceFile(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setSuccess("");
    const hasInvalidItem = items.some((item) => {
      const material = materials.find((candidate) => candidate.id === item.material_id);
      return !item.material_id || !item.lot_number.trim() || Number(item.quantity) <= 0
        || (variantsFor(item.material_id).length > 0 && !item.variant_id)
        || Boolean(material?.test_required && (!item.test_performed_at || !item.test_expires_at));
    });
    if (hasInvalidItem) { setError("Preencha material, tamanho, lote e quantidade. Para materiais ensaiáveis, informe também a data e a validade do ensaio."); return; }
    if (invoiceFile && !invoiceNumber.trim()) { setError("Informe o número da nota fiscal antes de anexar o arquivo."); return; }
    setSaving(true); const supabase = createClient(); let uploadedPath = "";
    if (invoiceFile) {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) { setError(authError?.message ?? "Sua sessão expirou. Entre novamente."); setSaving(false); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single();
      if (profileError) { setError(profileError.message); setSaving(false); return; }
      if (!profile?.organization_id) { setError("Não foi possível identificar a organização do usuário."); setSaving(false); return; }
      uploadedPath = `${profile.organization_id}/${crypto.randomUUID()}-${invoiceFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage.from("invoice-attachments").upload(uploadedPath, invoiceFile, { contentType: invoiceFile.type, upsert: false });
      if (uploadError) { setError(`Não foi possível anexar a nota fiscal: ${uploadError.message}`); setSaving(false); return; }
    }
    const { error: entryError } = await supabase.rpc("register_stock_entry_batch", { p_invoice_number: invoiceNumber || null, p_entry_date: entryDate || null, p_items: items.map((item) => ({ material_id: item.material_id, variant_id: item.variant_id || null, lot_number: item.lot_number.trim(), quantity: Number(item.quantity), unit_cost: Number(item.unit_cost) || 0, manufactured_at: item.manufactured_at || null, expires_at: item.expires_at || null, test_performed_at: item.test_performed_at || null, test_expires_at: item.test_expires_at || null })), p_invoice_file_path: uploadedPath || null, p_notes: notes || null });
    if (entryError) {
      if (uploadedPath) await supabase.storage.from("invoice-attachments").remove([uploadedPath]);
      setError(entryError.message);
    } else {
      setSuccess(items.length > 1 ? "Nota fiscal e itens registrados com sucesso." : "Entrada registrada e nota fiscal anexada com sucesso.");
      window.dispatchEvent(new Event("stock-entry-created")); setEntriesRefreshKey((value) => value + 1); setItems([newItem()]); setMaterialSuggestionsOpen(null); setInvoiceNumber(""); setEntryDate(new Date().toISOString().slice(0, 10)); setInvoiceFile(null); setNotes("");
    }
    setSaving(false);
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE ESTOQUE</p><h1>Entrada de materiais</h1><p className="module-subtitle">Registre vários produtos da mesma nota fiscal em uma única operação.</p></div><Link className="secondary-button" href="/stock"><ArrowLeft size={16} /> Ver estoque</Link></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
    <section className="panel entry-card"><div className="entry-intro"><div className="entry-icon"><ClipboardList size={22} /></div><div><h2>Nota fiscal e itens recebidos</h2><p>Informe a nota uma vez e adicione todos os produtos e lotes relacionados.</p></div></div>
      <form className="material-form" onSubmit={submit}>
        <div className="form-grid two"><label>Número da nota fiscal<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="NF-000123" required /></label><label>Data da entrada<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required /></label></div>
        <label className="file-upload">Foto ou PDF da nota fiscal<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={chooseFile} /><span><FileImage size={18} /> {invoiceFile ? invoiceFile.name : "Selecionar arquivo (máx. 10 MB)"}</span></label>
        <div className="delivery-items-header"><div><h3>Produtos da nota</h3><p>Uma linha para cada material, tamanho ou lote recebido.</p></div><button type="button" className="secondary-button" onClick={() => setItems((current) => [...current, newItem()])}><Plus size={15} /> Adicionar produto</button></div>
        <div className="delivery-items">{items.map((item, index) => { const selectedMaterial = materials.find((material) => material.id === item.material_id); const materialVariants = variantsFor(item.material_id); return <div className="delivery-item-row entry-item-row" key={index}><span className="item-index">{index + 1}</span>
          <label className="material-picker">Material<div className="material-picker-control"><input value={item.materialQuery} onChange={(event) => { updateItem(index, "materialQuery", event.target.value); updateItem(index, "material_id", ""); setMaterialSuggestionsOpen(index); }} onFocus={() => setMaterialSuggestionsOpen(index)} placeholder="Digite o nome do material" required disabled={loading} autoComplete="off" />{materialSuggestionsOpen === index && item.materialQuery && <div className="employee-suggestions">{filteredMaterials(item.materialQuery).map((material) => <button type="button" key={material.id} onMouseDown={() => selectMaterial(index, material)}><strong>{material.name}</strong></button>)}{!filteredMaterials(item.materialQuery).length && <span>Nenhum material encontrado.</span>}</div>}</div></label>
          {materialVariants.length > 0 && <label>Tamanho<select value={item.variant_id} onChange={(event) => updateItem(index, "variant_id", event.target.value)} required><option value="">Selecione o tamanho</option>{materialVariants.map((variant) => <option value={variant.id} key={variant.id}>{variant.size || variant.name}</option>)}</select></label>}
          <label>Lote<input value={item.lot_number} onChange={(event) => updateItem(index, "lot_number", event.target.value)} placeholder="LOTE-2026-001" required /></label><label>Quantidade<input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required /></label><label>Custo unitário (R$)<input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(event) => updateItem(index, "unit_cost", event.target.value)} required /></label>
          {selectedMaterial?.test_required ? <><label>Data do ensaio<input type="date" value={item.test_performed_at} onChange={(event) => updateItem(index, "test_performed_at", event.target.value)} required /></label><label>Validade do ensaio<input type="date" value={item.test_expires_at} onChange={(event) => updateItem(index, "test_expires_at", event.target.value)} required /></label></> : <><label>Fabricação<input type="date" value={item.manufactured_at} onChange={(event) => updateItem(index, "manufactured_at", event.target.value)} /></label><label>Validade<input type="date" value={item.expires_at} onChange={(event) => updateItem(index, "expires_at", event.target.value)} /></label></>}{items.length > 1 && <button type="button" className="remove-item" aria-label={`Remover produto ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>}
        </div>; })}</div>
        <label>Observações da nota<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Fornecedor, conferência ou outras observações" rows={3} /></label>
        <div className="modal-actions"><button type="reset" className="secondary-button" onClick={() => { setItems([newItem()]); setMaterialSuggestionsOpen(null); setInvoiceNumber(""); setInvoiceFile(null); setNotes(""); setError(""); }}>Limpar</button><button className="primary-button" disabled={saving || loading || !materials.length}>{saving ? "Registrando..." : "Registrar entrada"}<Plus size={16} /></button></div>
      </form>
    </section>
    <RecentStockEntries refreshKey={entriesRefreshKey} />
  </main>;
}

