"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Boxes, Check, LoaderCircle, Pencil, Plus, Search, ShieldCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { MaterialType } from "@/types/domain";

type MaterialRow = {
  id: string; internal_code: string | null; name: string; type: MaterialType; unit: string;
  description: string | null; brand: string | null; manufacturer: string | null; model: string | null;
  ca_number: string | null; ca_expires_at: string | null; useful_life_months: number | null; replacement_interval_days: number | null;
  minimum_stock: number; location: string | null; notes: string | null; status: "active" | "inactive";
};
type MaterialForm = {
  internal_code: string; name: string; type: MaterialType; unit: string; description: string;
  brand: string; manufacturer: string; model: string; ca_number: string; ca_expires_at: string;
  useful_life_months: string; replacement_interval_days: string; minimum_stock: string; location: string; notes: string; status: "active" | "inactive";
};

const emptyForm: MaterialForm = {
  internal_code: "", name: "", type: "EPI", unit: "un.", description: "", brand: "", manufacturer: "",
  model: "", ca_number: "", ca_expires_at: "", useful_life_months: "", replacement_interval_days: "", minimum_stock: "0",
  location: "", notes: "", status: "active",
};

function statusFor(material: MaterialRow, stock: number) {
  if (material.status === "inactive") return ["Inativo", "inactive"];
  if (stock === 0) return ["Sem estoque", "danger"];
  if (stock <= material.minimum_stock) return ["Estoque baixo", "warning"];
  return ["Normal", "success"];
}

function formFromMaterial(material: MaterialRow): MaterialForm {
  return {
    internal_code: material.internal_code ?? "", name: material.name, type: material.type, unit: material.unit,
    description: material.description ?? "", brand: material.brand ?? "", manufacturer: material.manufacturer ?? "",
    model: material.model ?? "", ca_number: material.ca_number ?? "", ca_expires_at: material.ca_expires_at ?? "",
    useful_life_months: material.useful_life_months?.toString() ?? "", replacement_interval_days: material.replacement_interval_days?.toString() ?? "", minimum_stock: material.minimum_stock.toString(),
    location: material.location ?? "", notes: material.notes ?? "", status: material.status,
  };
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [stockByMaterial, setStockByMaterial] = useState<Record<string, number>>({});
  const [form, setForm] = useState<MaterialForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [ascending, setAscending] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadMaterials() {
    setLoading(true);
    const supabase = createClient();
    const [{ data, error: materialsError }, { data: lots, error: lotsError }] = await Promise.all([
      supabase.from("materials").select("id,internal_code,name,type,unit,description,brand,manufacturer,model,ca_number,ca_expires_at,useful_life_months,replacement_interval_days,minimum_stock,location,notes,status").order("name"),
      supabase.from("material_lots").select("material_id,available_quantity"),
    ]);
    if (materialsError || lotsError) setError((materialsError ?? lotsError)?.message ?? "Não foi possível carregar materiais.");
    else {
      setMaterials((data ?? []) as MaterialRow[]);
      setStockByMaterial((lots ?? []).reduce<Record<string, number>>((total, lot) => {
        total[lot.material_id] = (total[lot.material_id] ?? 0) + Number(lot.available_quantity);
        return total;
      }, {}));
    }
    setLoading(false);
  }

  useEffect(() => { void loadMaterials(); }, []);

  const filtered = useMemo(() => materials
    .filter((material) => {
      const stock = stockByMaterial[material.id] ?? 0;
      return `${material.name} ${material.internal_code} ${material.ca_number ?? ""}`.toLowerCase().includes(query.toLowerCase())
        && (typeFilter === "all" || material.type === typeFilter)
        && (statusFilter === "all" || material.status === statusFilter)
        && (!lowStockOnly || stock <= material.minimum_stock);
    })
    .sort((a, b) => ascending ? a.name.localeCompare(b.name, "pt-BR") : b.name.localeCompare(a.name, "pt-BR")), [materials, stockByMaterial, query, typeFilter, statusFilter, lowStockOnly, ascending]);

  function updateField(field: keyof MaterialForm, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  function openNew() { setForm(emptyForm); setEditingId(null); setError(""); setSuccess(""); setShowForm(true); }
  function openEdit(material: MaterialRow) { setForm(formFromMaterial(material)); setEditingId(material.id); setError(""); setSuccess(""); setShowForm(true); }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault();
    setError(""); setSuccess("");
    if (form.type === "EPI" && !form.ca_number.trim()) { setError("O número do CA é obrigatório para materiais do tipo EPI."); return; }
    setSaving(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setError("Sua sessão expirou. Entre novamente."); setSaving(false); return; }
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single();
    if (!profile?.organization_id) { setError("Não foi possível identificar a organização do usuário."); setSaving(false); return; }
    const payload = {
      internal_code: form.internal_code.trim() || null, name: form.name.trim(), type: form.type, unit: form.unit.trim() || "un.",
      description: form.description.trim() || null, brand: form.brand.trim() || null, manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null, ca_number: form.type === "EPI" ? form.ca_number.trim() : null,
      ca_expires_at: form.type === "EPI" ? form.ca_expires_at || null : null,
      useful_life_months: form.useful_life_months ? Number(form.useful_life_months) : null,
      replacement_interval_days: form.replacement_interval_days ? Number(form.replacement_interval_days) : null,
      minimum_stock: Number(form.minimum_stock) || 0, location: form.location.trim() || null,
      notes: form.notes.trim() || null, status: form.status,
    };
    const { error: saveError } = editingId
      ? await supabase.from("materials").update(payload).eq("id", editingId)
      : await supabase.from("materials").insert({ ...payload, organization_id: profile.organization_id });
    if (saveError) setError(saveError.code === "23505" ? "Já existe um material com este código interno." : saveError.message);
    else { setSuccess(editingId ? "Material atualizado com sucesso." : "Material cadastrado com sucesso."); setShowForm(false); await loadMaterials(); }
    setSaving(false);
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CADASTRO E CONTROLE</p><h1>Materiais</h1><p className="module-subtitle">Gerencie EPIs, EPCs e ferramentais, certificados e níveis mínimos de estoque.</p></div><button className="primary-button" onClick={openNew}><Plus size={17} /> Novo material</button></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}
    {error && !showForm && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, código ou CA" /></div><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos os tipos</option><option value="EPI">EPI</option><option value="EPC">EPC</option><option value="FERRAMENTAL">Ferramental</option></select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos os status</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select><label className="check-filter"><input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} /> Estoque baixo</label></section>
    <section className="module-summary"><div><strong>{materials.length}</strong><span>materiais cadastrados</span></div><div><strong>{materials.filter((item) => item.type === "EPI").length}</strong><span>EPIs</span></div><div><strong>{materials.filter((item) => item.type === "EPC").length}</strong><span>EPCs</span></div><div><strong>{materials.filter((item) => item.type === "FERRAMENTAL").length}</strong><span>ferramentais</span></div></section>
    <section className="panel module-table-card"><div className="panel-header"><div><h2>Catálogo de materiais</h2><p>{filtered.length} resultado(s) encontrados</p></div><button className="select-button" onClick={() => setAscending((current) => !current)}>{ascending ? "Nome: A–Z" : "Nome: Z–A"} {ascending ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}</button></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando materiais...</div> : <div className="table-wrap"><table><thead><tr><th>MATERIAL</th><th>TIPO</th><th>CA</th><th>ESTOQUE</th><th>LOCALIZAÇÃO</th><th>SITUAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>{filtered.map((material) => { const stock = stockByMaterial[material.id] ?? 0; const [status, tone] = statusFor(material, stock); return <tr key={material.id}><td><div className="material-cell"><div className={`material-type-icon ${material.type === "EPI" ? "epi" : "epc"}`}><Boxes size={17} /></div><div><strong>{material.name}</strong><small>{material.internal_code} · {material.unit}</small></div></div></td><td><span className={`type-badge ${material.type.toLowerCase()}`}>{material.type}</span></td><td>{material.ca_number || <span className="muted-cell">Não se aplica</span>}</td><td><strong>{stock}</strong> <span className="muted-cell">/ mín. {material.minimum_stock}</span></td><td>{material.location || <span className="muted-cell">Não informado</span>}</td><td><span className={`status-pill ${tone}`}>{status}</span></td><td><button className="action-button" onClick={() => openEdit(material)}><Pencil size={14} /> Editar</button></td></tr>; })}</tbody></table>{!filtered.length && <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum material encontrado</strong><span>Ajuste os filtros ou cadastre o primeiro material.</span></div>}</div>}</section>
    {showForm && <div className="modal-backdrop"><section className="modal-card"><div className="modal-header"><div><p className="eyebrow">{editingId ? "ATUALIZAR CADASTRO" : "NOVO CADASTRO"}</p><h2>{editingId ? "Editar material" : "Cadastrar material"}</h2></div><button className="close-modal" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveMaterial}><div className="form-grid two"><label>Código interno<input value={form.internal_code} onChange={(event) => updateField("internal_code", event.target.value)} placeholder="EPI-00001" required /></label><label>Nome do material<input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Ex.: Capacete Classe B" required /></label></div><div className="form-grid three"><label>Tipo<select value={form.type} onChange={(event) => updateField("type", event.target.value)}><option value="EPI">EPI</option><option value="EPC">EPC</option><option value="FERRAMENTAL">Ferramental</option></select></label><label>Unidade<input value={form.unit} onChange={(event) => updateField("unit", event.target.value)} required /></label><label>Estoque mínimo<input type="number" min="0" value={form.minimum_stock} onChange={(event) => updateField("minimum_stock", event.target.value)} required /></label></div><div className="form-grid three"><label>Número do CA {form.type === "EPI" && <em>obrigatório</em>}<input value={form.ca_number} onChange={(event) => updateField("ca_number", event.target.value)} disabled={form.type !== "EPI"} required={form.type === "EPI"} /></label><label>Validade do CA<input type="date" value={form.ca_expires_at} onChange={(event) => updateField("ca_expires_at", event.target.value)} disabled={form.type !== "EPI"} /></label><label>Vida útil (meses)<input type="number" min="0" value={form.useful_life_months} onChange={(event) => updateField("useful_life_months", event.target.value)} /></label><label>Troca prevista<select value={form.replacement_interval_days} onChange={(event) => updateField("replacement_interval_days", event.target.value)}><option value="">Não definida</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></label></div><div className="form-grid three"><label>Marca<input value={form.brand} onChange={(event) => updateField("brand", event.target.value)} /></label><label>Fabricante<input value={form.manufacturer} onChange={(event) => updateField("manufacturer", event.target.value)} /></label><label>Modelo<input value={form.model} onChange={(event) => updateField("model", event.target.value)} /></label></div><label>Localização no estoque<input value={form.location} onChange={(event) => updateField("location", event.target.value)} placeholder="Ex.: Almoxarifado A" /></label><label>Descrição<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} rows={2} /></label><label>Observações<textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} rows={2} /></label>{editingId && <label>Status<select value={form.status} onChange={(event) => updateField("status", event.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>}{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar material"}<Check size={16} /></button></div></form></section></div>}
  </main>;
}
