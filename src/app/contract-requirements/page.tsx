"use client";

import { ClipboardCheck, FileText, LoaderCircle, PackageCheck, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Scenario = { id: string; code: string; name: string; source_annex: string; team_size: number | null; composition: string | null };
type Requirement = { id: string; scenario_id: string; source_annex: string; quantity: number; unit: string; usage_scope: "individual" | "coletivo"; notes: string | null; materials: { id: string; name: string; type: "EPI" | "EPC" | "FERRAMENTAL"; contract_item_code: string | null; contract_category: string; contract_specification: string | null; ca_required: boolean; ca_number: string | null; ca_expires_at: string | null; test_required: boolean } | null };
type Lot = { material_id: string; available_quantity: number };

const categoryLabel: Record<string, string> = { EPI: "EPI", EPC: "EPC", FERRAMENTAL: "Ferramental", EQUIPAMENTO: "Equipamento", ACESSORIO: "Acessório", TI: "Tecnologia" };

export default function ContractRequirementsPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [scenarioId, setScenarioId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data: scenarioData, error: scenarioError }, { data: requirementData, error: requirementError }, { data: lotData, error: lotError }] = await Promise.all([
        supabase.from("contract_scenarios").select("id, code, name, source_annex, team_size, composition").order("name"),
        supabase.from("contract_requirements").select("id, scenario_id, source_annex, quantity, unit, usage_scope, notes, materials(id, name, type, contract_item_code, contract_category, contract_specification, ca_required, ca_number, ca_expires_at, test_required)"),
        supabase.from("material_lots").select("material_id, available_quantity"),
      ]);
      if (scenarioError || requirementError || lotError) setError((scenarioError ?? requirementError ?? lotError)?.message ?? "Não foi possível carregar os requisitos contratuais.");
      const rows = (scenarioData ?? []) as Scenario[];
      const lots = (lotData ?? []) as Lot[];
      setScenarios(rows);
      setRequirements((requirementData ?? []) as unknown as Requirement[]);
      setStock(lots.reduce<Record<string, number>>((total, lot) => ({ ...total, [lot.material_id]: (total[lot.material_id] ?? 0) + lot.available_quantity }), {}));
      setScenarioId(rows[0]?.id ?? "");
      setLoading(false);
    }
    void load();
  }, []);

  const visible = useMemo(() => requirements.filter((item) => item.scenario_id === scenarioId), [requirements, scenarioId]);
  const selected = scenarios.find((item) => item.id === scenarioId);
  const deficitCount = visible.filter((item) => (stock[item.materials?.id ?? ""] ?? 0) < item.quantity).length;
  const complianceCount = visible.filter((item) => item.materials?.ca_required && (!item.materials.ca_number || item.materials.ca_number === "PENDENTE") || item.materials?.test_required).length;
  const totalRequired = visible.reduce((total, item) => total + Number(item.quantity), 0);

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CONTROLE CONTRATUAL</p><h1>Requisitos por equipe</h1><p className="module-subtitle">Confira os materiais mínimos dos anexos contratuais e compare com o estoque disponível.</p></div><div className="header-actions"><a className="secondary-button" href="/function-templates"><FileText size={16} /> Listas por função</a></div></header>
    {error && <div className="feedback error-feedback"><ShieldAlert size={17} /> {error}</div>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando requisitos...</div> : <>
      <section className="module-toolbar"><label className="contract-scenario-select">Cenário contratual<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name} · {scenario.source_annex}</option>)}</select></label>{selected && <div className="contract-composition"><strong>{selected.team_size ?? "—"} integrantes</strong><span>{selected.composition}</span></div>}</section>
      <section className="module-summary"><div><ClipboardCheck size={18} /><strong>{visible.length}</strong><span>itens exigidos</span></div><div><PackageCheck size={18} /><strong>{totalRequired}</strong><span>quantidade mínima</span></div><div><ShieldAlert size={18} /><strong>{deficitCount}</strong><span>com saldo insuficiente</span></div><div><FileText size={18} /><strong>{complianceCount}</strong><span>pendências de CA/ensaio</span></div></section>
      <section className="panel module-table-card"><div className="panel-header"><div><h2>Materiais mínimos do cenário</h2><p>Os itens coletivos atendem à equipe; os individuais devem ser conferidos por colaborador.</p></div></div>{visible.length ? <div className="table-wrap"><table><thead><tr><th>ITEM CONTRATUAL</th><th>CATEGORIA</th><th>USO</th><th>MÍNIMO</th><th>DISPONÍVEL</th><th>CONFORMIDADE</th></tr></thead><tbody>{visible.map((item) => { const available = stock[item.materials?.id ?? ""] ?? 0; const enough = available >= item.quantity; const caPending = Boolean(item.materials?.ca_required && (!item.materials.ca_number || item.materials.ca_number === "PENDENTE")); const hasTechnicalControl = Boolean(item.materials?.test_required); const status = !enough ? "Repor estoque" : caPending ? "CA pendente" : hasTechnicalControl ? "Ensaio requerido" : "Conforme"; const statusClass = !enough || caPending ? "danger" : hasTechnicalControl ? "warning" : "success"; return <tr key={item.id}><td><div className="material-cell"><div className="material-type-icon epi"><ClipboardCheck size={15} /></div><div><strong>{item.materials?.name ?? "Material não encontrado"}</strong><small>{item.materials?.contract_item_code ?? "Sem código"}</small></div></div></td><td><span className="type-badge epi">{categoryLabel[item.materials?.contract_category ?? ""] ?? item.materials?.type ?? "—"}</span></td><td>{item.usage_scope === "individual" ? "Individual" : "Coletivo"}</td><td><strong>{item.quantity} {item.unit}</strong></td><td><strong className={enough ? "history-positive" : "history-negative"}>{available} {item.unit}</strong></td><td><span className={`status-pill ${statusClass}`}>{status}</span></td></tr>})}</tbody></table></div> : <div className="empty-state"><ClipboardCheck size={27} /><strong>Nenhum requisito cadastrado</strong><span>Selecione outro cenário ou importe os itens do anexo contratual.</span></div>}</section>
    </>}
  </main>;
}
