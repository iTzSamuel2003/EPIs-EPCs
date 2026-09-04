"use client";

import { FormEvent, useEffect, useState } from "react";
import { Boxes, Check, ClipboardList, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ItemType = "EPI" | "EPC" | "FERRAMENTAL";
type TemplateItem = { id?: string; material_name: string; quantity: number; item_type: ItemType };
type Template = { id: string; name: string; source_document: string | null; function_template_items: TemplateItem[] };
type MaterialOption = { id: string; name: string; type: ItemType; unit: string };
type DraftItem = { material_name: string; quantity: string; item_type: ItemType };

const emptyItem = (): DraftItem => ({ material_name: "", quantity: "1", item_type: "EPI" });

export default function FunctionTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sourceDocument, setSourceDocument] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];

  async function load(preferredId?: string) {
    setLoading(true);
    const supabase = createClient();
    const [{ data: templateData, error: templateError }, { data: materialData, error: materialError }] = await Promise.all([
      supabase.from("function_templates").select("id, name, source_document, function_template_items(id, material_name, quantity, item_type)").order("name"),
      supabase.from("materials").select("id, name, type, unit").eq("status", "active").order("name"),
    ]);
    if (templateError || materialError) setError((templateError ?? materialError)?.message ?? "Não foi possível carregar as listas.");
    else {
      const rows = (templateData ?? []) as unknown as Template[];
      setTemplates(rows);
      setMaterials((materialData ?? []) as MaterialOption[]);
      setSelectedId(preferredId && rows.some((template) => template.id === preferredId) ? preferredId : rows[0]?.id ?? "");
    }
    setLoading(false);
  }

  useEffect(() => { void Promise.resolve().then(() => load()); }, []);

  function openNew() {
    setEditingId(null); setName(""); setSourceDocument("Cadastro interno"); setItems([emptyItem()]); setError(""); setSuccess(""); setShowForm(true);
  }

  function openEdit() {
    if (!selected) return;
    setEditingId(selected.id); setName(selected.name); setSourceDocument(selected.source_document ?? "");
    setItems(selected.function_template_items.map((item) => ({ material_name: item.material_name, quantity: String(item.quantity), item_type: item.item_type })));
    setError(""); setSuccess(""); setShowForm(true);
  }

  function updateItem(index: number, field: keyof DraftItem, value: string) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function chooseMaterial(index: number, materialId: string) {
    const material = materials.find((item) => item.id === materialId);
    if (!material) return;
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, material_name: material.name, item_type: material.type } : item));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(""); setSuccess("");
    const validItems = items.map((item) => ({ material_name: item.material_name.trim(), quantity: Number(item.quantity), item_type: item.item_type }))
      .filter((item) => item.material_name && Number.isInteger(item.quantity) && item.quantity > 0);
    if (!name.trim()) { setError("Informe o nome da função."); return; }
    if (!validItems.length || validItems.length !== items.length) { setError("Informe o material e uma quantidade maior que zero em todos os itens."); return; }
    if (new Set(validItems.map((item) => item.material_name.toLocaleLowerCase("pt-BR"))).size !== validItems.length) { setError("Não repita o mesmo material na lista."); return; }

    setSaving(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data: profile } = auth.user ? await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single() : { data: null };
    if (!profile?.organization_id) { setError("Não foi possível identificar a organização do usuário."); setSaving(false); return; }

    let templateId = editingId;
    if (templateId) {
      const { error: updateError } = await supabase.from("function_templates").update({ name: name.trim(), source_document: sourceDocument.trim() || null }).eq("id", templateId);
      if (updateError) { setError(updateError.message); setSaving(false); return; }
      const { error: deleteError } = await supabase.from("function_template_items").delete().eq("template_id", templateId);
      if (deleteError) { setError(deleteError.message); setSaving(false); return; }
    } else {
      const { data, error: insertError } = await supabase.from("function_templates").insert({ organization_id: profile.organization_id, name: name.trim(), source_document: sourceDocument.trim() || null }).select("id").single();
      if (insertError || !data) { setError(insertError?.message ?? "Não foi possível criar a função."); setSaving(false); return; }
      templateId = data.id;
    }

    const knownNames = new Set(materials.map((item) => item.name.trim().toLocaleLowerCase("pt-BR")));
    const missingCatalogItems = validItems.filter((item) => !knownNames.has(item.material_name.toLocaleLowerCase("pt-BR"))).map((item) => ({
      organization_id: profile.organization_id, internal_code: null, name: item.material_name, type: item.item_type, unit: "un.",
      ca_number: item.item_type === "EPI" ? "PENDENTE" : null, minimum_stock: 0, status: "active",
      notes: "Cadastro criado a partir de Lista por função. Conferir CA, marca, modelo, custos e estoque mínimo.",
    }));
    if (missingCatalogItems.length) {
      const { error: materialError } = await supabase.from("materials").insert(missingCatalogItems);
      if (materialError) { setError(materialError.message); setSaving(false); return; }
    }

    const { error: itemError } = await supabase.from("function_template_items").insert(validItems.map((item) => ({ ...item, organization_id: profile.organization_id, template_id: templateId })));
    if (itemError) { setError(itemError.message); setSaving(false); return; }
    setSuccess(editingId ? "Lista por função atualizada." : "Nova função e sua lista foram cadastradas.");
    setShowForm(false); await load(templateId ?? undefined); setSaving(false);
  }

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">PADRÕES DE DISTRIBUIÇÃO</p><h1>Listas por função</h1><p className="module-subtitle">Defina e mantenha os materiais sugeridos para cada função.</p></div><button className="primary-button" onClick={openNew}><Plus size={17} /> Nova função</button></header>
    {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}
    {error && !showForm && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando listas...</div> : <section className="function-template-layout"><div className="panel template-selector"><div className="panel-header"><div><h2>Funções cadastradas</h2><p>{templates.length} lista(s) disponíveis</p></div></div><div className="template-options">{templates.map((template) => <button key={template.id} className={template.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(template.id)}><span className="template-option-icon"><Boxes size={17} /></span><span><strong>{template.name}</strong><small>{template.function_template_items.length} materiais</small></span></button>)}</div>{!templates.length && <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhuma função cadastrada</strong><span>Use “Nova função” para criar a primeira lista.</span></div>}</div>{selected && <section className="panel template-detail"><div className="panel-header"><div><p className="eyebrow">LISTA PRÉ-DEFINIDA</p><h2>{selected.name}</h2><p>{selected.function_template_items.length} itens · quantidades sugeridas</p></div><button className="action-button" onClick={openEdit}><Pencil size={14} /> Editar lista</button></div><div className="table-wrap"><table><thead><tr><th>MATERIAL</th><th>TIPO</th><th>QUANTIDADE</th></tr></thead><tbody>{selected.function_template_items.map((item) => <tr key={item.id ?? item.material_name}><td><strong>{item.material_name}</strong></td><td><span className={`type-badge ${item.item_type === "EPI" ? "epi" : "epc"}`}>{item.item_type === "FERRAMENTAL" ? "Ferramental" : item.item_type}</span></td><td><strong>{item.quantity}</strong> un.</td></tr>)}</tbody></table></div><p className="template-source">Fonte: {selected.source_document ?? "Cadastro interno"}</p></section>}</section>}
    {showForm && <div className="modal-backdrop"><section className="modal-card"><div className="modal-header"><div><p className="eyebrow">{editingId ? "ATUALIZAR LISTA" : "NOVA LISTA"}</p><h2>{editingId ? "Editar materiais da função" : "Cadastrar nova função"}</h2></div><button className="close-modal" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={save}><div className="form-grid two"><label>Função<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Eletricista de linha viva" required /></label><label>Fonte / referência<input value={sourceDocument} onChange={(event) => setSourceDocument(event.target.value)} placeholder="Cadastro interno" /></label></div><div className="delivery-items-header"><div><h3>Materiais pré-definidos</h3><p>Selecione do catálogo ou informe um novo material para cadastrá-lo.</p></div><button className="secondary-button" type="button" onClick={() => setItems((current) => [...current, emptyItem()])}><Plus size={15} /> Adicionar material</button></div><div className="delivery-items">{items.map((item, index) => <div className="delivery-item-row" key={index}><span className="item-index">{index + 1}</span><label>Material<select value="" onChange={(event) => chooseMaterial(index, event.target.value)}><option value="">Selecionar do catálogo</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name} ({material.type})</option>)}</select><input value={item.material_name} onChange={(event) => updateItem(index, "material_name", event.target.value)} placeholder="Ou digite um novo material" required /></label><label>Tipo<select value={item.item_type} onChange={(event) => updateItem(index, "item_type", event.target.value)}><option value="EPI">EPI</option><option value="EPC">EPC</option><option value="FERRAMENTAL">Ferramental</option></select></label><label>Quantidade<input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} required /></label>{items.length > 1 && <button type="button" className="remove-item" aria-label={`Remover material ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>}</div>)}</div>{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : editingId ? "Salvar lista" : "Cadastrar função"}<Check size={16} /></button></div></form></section></div>}
  </main>;
}
