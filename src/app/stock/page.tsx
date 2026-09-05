"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Boxes, LoaderCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type StockMaterial = { id: string; internal_code: string; name: string; type: "EPI" | "EPC" | "FERRAMENTAL"; unit: string; minimum_stock: number; location: string | null; status: "active" | "inactive" };
type StockBalance = { totalQuantity: number; availableQuantity: number; totalCost: number; availableCost: number };

function currency(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function StockPage() {
  const [materials, setMaterials] = useState<StockMaterial[]>([]);
  const [balances, setBalances] = useState<Record<string, StockBalance>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "balance">("name");
  const [ascending, setAscending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    const supabase = createClient();
    const [{ data, error: materialError }, { data: lots, error: lotError }] = await Promise.all([
      supabase.from("materials").select("id,internal_code,name,type,unit,minimum_stock,location,status").order("name"),
      supabase.from("material_lots").select("material_id,received_quantity,available_quantity,unit_cost"),
    ]);
    if (materialError || lotError) setError((materialError ?? lotError)?.message ?? "Não foi possível carregar o estoque.");
    else {
      setMaterials((data ?? []) as StockMaterial[]);
      setBalances((lots ?? []).reduce<Record<string, StockBalance>>((sum, lot) => {
        const totalQuantity = Number(lot.received_quantity);
        const availableQuantity = Number(lot.available_quantity);
        const unitCost = Number(lot.unit_cost ?? 0);
        sum[lot.material_id] = {
          totalQuantity: (sum[lot.material_id]?.totalQuantity ?? 0) + totalQuantity,
          availableQuantity: (sum[lot.material_id]?.availableQuantity ?? 0) + availableQuantity,
          totalCost: (sum[lot.material_id]?.totalCost ?? 0) + totalQuantity * unitCost,
          availableCost: (sum[lot.material_id]?.availableCost ?? 0) + availableQuantity * unitCost,
        };
        return sum;
      }, {}));
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => materials.filter((item) => {
    const current = balances[item.id]?.availableQuantity ?? 0;
    const situation = current === 0 ? "empty" : current <= item.minimum_stock ? "low" : "normal";
    return `${item.name} ${item.internal_code}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || situation === filter);
  }).sort((a, b) => {
    const value = sortBy === "name" ? a.name.localeCompare(b.name, "pt-BR") : (balances[a.id]?.availableQuantity ?? 0) - (balances[b.id]?.availableQuantity ?? 0);
    return ascending ? value : -value;
  }), [materials, balances, query, filter, sortBy, ascending]);

  function toggleSort() {
    if (sortBy === "name") setSortBy("balance");
    else setAscending((current) => !current);
  }
  const sortLabel = sortBy === "name" ? "Ordenar por saldo" : `Saldo: ${ascending ? "menor primeiro" : "maior primeiro"}`;

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">CONTROLE OPERACIONAL</p><h1>Estoque</h1><p className="module-subtitle">Acompanhe saldos consolidados por material e lote.</p></div><Link className="primary-button" href="/entries">Registrar entrada</Link></header>{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="module-toolbar"><div className="module-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar material ou código" /></div><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todas as situações</option><option value="normal">Normal</option><option value="low">Estoque baixo</option><option value="empty">Sem estoque</option></select></section><section className="module-summary"><div><strong>{materials.length}</strong><span>materiais</span></div><div><strong>{materials.filter((item) => (balances[item.id]?.availableQuantity ?? 0) > item.minimum_stock).length}</strong><span>estoque normal</span></div><div><strong>{materials.filter((item) => { const total = balances[item.id]?.availableQuantity ?? 0; return total > 0 && total <= item.minimum_stock; }).length}</strong><span>estoque baixo</span></div><div><strong>{materials.filter((item) => (balances[item.id]?.availableQuantity ?? 0) === 0).length}</strong><span>sem estoque</span></div></section><section className="panel module-table-card"><div className="panel-header"><div><h2>Posição atual do estoque</h2><p>{rows.length} material(is) listados · disponibilidade atualizada pelas entregas</p></div><button className="select-button" onClick={toggleSort}>{sortLabel} {ascending ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}</button></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando estoque...</div> : <div className="table-wrap"><table><thead><tr><th>MATERIAL</th><th>TIPO</th><th>TOTAL RECEBIDO</th><th>DISPONÍVEL</th><th>EM USO / ENTREGUE</th><th>CUSTO UNITÁRIO</th><th>VALOR DISPONÍVEL</th><th>VALOR TOTAL</th><th>ESTOQUE MÍNIMO</th><th>LOCALIZAÇÃO</th><th>SITUAÇÃO</th></tr></thead><tbody>{rows.map((item) => { const balance = balances[item.id] ?? { totalQuantity: 0, availableQuantity: 0, totalCost: 0, availableCost: 0 }; const current = balance.availableQuantity; const inUse = balance.totalQuantity - balance.availableQuantity; const unitCost = balance.totalQuantity > 0 ? balance.totalCost / balance.totalQuantity : 0; const [label, tone] = current === 0 ? ["Sem estoque", "danger"] : current <= item.minimum_stock ? ["Estoque baixo", "warning"] : ["Normal", "success"]; return <tr key={item.id}><td><div className="material-cell"><div className="material-type-icon epi"><Boxes size={17} /></div><div><strong>{item.name}</strong><small>{item.internal_code} · {item.unit}</small></div></div></td><td><span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span></td><td><strong>{balance.totalQuantity}</strong> {item.unit}</td><td><strong className="stock-number">{current}</strong> {item.unit}</td><td>{inUse} {item.unit}</td><td>{currency(unitCost)}</td><td><strong>{currency(balance.availableCost)}</strong></td><td><strong>{currency(balance.totalCost)}</strong></td><td>{item.minimum_stock} {item.unit}</td><td>{item.location || <span className="muted-cell">Não informado</span>}</td><td><span className={`status-pill ${tone}`}>{label}</span></td></tr>; })}</tbody></table>{!rows.length && <div className="empty-state"><Boxes size={27} /><strong>Nenhum material encontrado</strong><span>Cadastre materiais ou ajuste os filtros.</span></div>}</div>}</section></main>;
}
