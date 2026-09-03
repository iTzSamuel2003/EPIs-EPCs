"use client";

import { useEffect, useState } from "react";
import { Boxes, Check, ClipboardList, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type TemplateItem = { id: string; material_name: string; quantity: number; item_type: "EPI" | "FERRAMENTAL" };
type Template = { id: string; name: string; source_document: string | null; function_template_items: TemplateItem[] };

export default function FunctionTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selected = templates.find((template) => template.id === selectedId) ?? templates[0];
  useEffect(() => { async function load() { const { data, error: loadError } = await createClient().from("function_templates").select("id, name, source_document, function_template_items(id, material_name, quantity, item_type)").order("name"); if (loadError) setError(loadError.message); else { const rows = (data ?? []) as unknown as Template[]; setTemplates(rows); setSelectedId(rows[0]?.id ?? ""); } setLoading(false); } void load(); }, []);
  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">PADRÕES DE DISTRIBUIÇÃO</p><h1>Listas por função</h1><p className="module-subtitle">Consulte os EPIs e ferramentais pré-definidos para cada cargo ou função.</p></div><div className="template-summary-icon"><ClipboardList size={22} /></div></header>{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando listas...</div> : !templates.length ? <section className="panel empty-state"><ShieldCheck size={27} /><strong>Nenhuma lista cadastrada</strong><span>As listas por função serão exibidas aqui.</span></section> : <section className="function-template-layout"><div className="panel template-selector"><div className="panel-header"><div><h2>Funções cadastradas</h2><p>{templates.length} lista(s) disponíveis</p></div></div><div className="template-options">{templates.map((template) => <button key={template.id} className={template.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(template.id)}><span className="template-option-icon"><Boxes size={17} /></span><span><strong>{template.name}</strong><small>{template.function_template_items.length} materiais</small></span></button>)}</div></div><section className="panel template-detail"><div className="panel-header"><div><p className="eyebrow">LISTA PRÉ-DEFINIDA</p><h2>{selected?.name}</h2><p>{selected?.function_template_items.length} itens · quantidades sugeridas para a função</p></div><span className="template-status"><Check size={15} /> Ativa</span></div><div className="table-wrap"><table><thead><tr><th>MATERIAL</th><th>TIPO</th><th>QUANTIDADE</th></tr></thead><tbody>{selected?.function_template_items.map((item) => <tr key={item.id}><td><strong>{item.material_name}</strong></td><td><span className={`type-badge ${item.item_type === "EPI" ? "epi" : "epc"}`}>{item.item_type === "EPI" ? "EPI" : "Ferramental"}</span></td><td><strong>{item.quantity}</strong> un.</td></tr>)}</tbody></table></div><p className="template-source">Fonte: {selected?.source_document ?? "Cadastro interno"}</p></section></section>}</main>;
}

