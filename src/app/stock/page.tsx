"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Boxes, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { FeedbackMessage } from "@/components/feedback-message";
import { friendlyError } from "@/lib/ui-feedback";
import { createClient } from "@/lib/supabase/client";

type StockMaterial = { id: string; internal_code: string; name: string; type: "EPI" | "EPC" | "FERRAMENTAL"; unit: string; minimum_stock: number; location: string | null; status: "active" | "inactive"; ca_required: boolean; test_required: boolean; report_required: boolean };
type StockBalance = { totalQuantity: number; availableQuantity: number; totalCost: number; availableCost: number };
type VariantBalance = { id: string; label: string; totalQuantity: number; availableQuantity: number };
type StockLot = { id: string; material_id: string; variant_id: string | null; lot_number: string; received_quantity: number; available_quantity: number; entry_date: string; unit_cost: number | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_performed_at: string | null; test_expires_at: string | null; test_report_number: string | null };
type CaCertificate = { ca_number: string; valid_until: string | null; status: string | null };

function currency(value: number) { return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function localDateValue() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function stockSituation(availableQuantity: number, minimumStock: number) {
  if (availableQuantity <= 0) return "empty";
  if (minimumStock > 0 && availableQuantity < minimumStock) return "low";
  return "normal";
}
function caSituation(lot: StockLot, certificate?: CaCertificate) {
  const status = normalize(certificate?.status ?? "");
  const expiry = certificate?.valid_until || lot.ca_expires_at;
  if (!lot.ca_number?.trim()) return { label: "Sem CA informado", tone: "muted" };
  if (["cancel", "suspens", "revog", "inativ", "inval", "vencid", "expir"].some((word) => status.includes(word)) || (expiry && expiry < localDateValue())) return { label: "Vencido ou irregular", tone: "danger" };
  if (expiry) return { label: `Válido até ${new Date(`${expiry}T00:00:00`).toLocaleDateString("pt-BR")}`, tone: "success" };
  return { label: "Validade não confirmada", tone: "warning" };
}

export default function StockPage() {
  const [materials, setMaterials] = useState<StockMaterial[]>([]);
  const [balances, setBalances] = useState<Record<string, StockBalance>>({});
  const [variantBalances, setVariantBalances] = useState<Record<string, VariantBalance[]>>({});
  const [lotsByMaterial, setLotsByMaterial] = useState<Record<string, StockLot[]>>({});
  const [caCertificates, setCaCertificates] = useState<Record<string, CaCertificate>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "balance">("name");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    if (mountedRef.current) { setLoading(true); setError(""); }
    setMaterials([]);
    setBalances({});
    setVariantBalances({});
    setLotsByMaterial({});
    setCaCertificates({});
    try {
      const supabase = createClient();
      const [{ data, error: materialError }, { data: lots, error: lotError }, { data: variants, error: variantError }] = await Promise.all([
        supabase.from("materials").select("id,internal_code,name,type,unit,minimum_stock,location,status,ca_required,test_required,report_required").eq("status", "active").order("name"),
        supabase.from("material_lots").select("id,material_id,variant_id,lot_number,received_quantity,available_quantity,entry_date,ca_number,ca_expires_at,test_number,test_performed_at,test_expires_at,test_report_number,unit_cost"),
        supabase.from("material_variants").select("id,material_id,name,size,active").eq("active", true).order("size"),
      ]);
      if (!mountedRef.current || version !== loadVersion.current) return;
      if (materialError || lotError || variantError) { setError(friendlyError(materialError ?? lotError ?? variantError, "Não foi possível carregar o estoque.")); return; }

      const lotRows = (lots ?? []) as StockLot[];
      const caNumbers = [...new Set(lotRows.map((lot) => lot.ca_number?.trim()).filter((number): number is string => Boolean(number)))];
      if (caNumbers.length) {
        const { data: certificates } = await supabase.from("ca_certificates").select("ca_number,valid_until,status").in("ca_number", caNumbers);
        if (!mountedRef.current || version !== loadVersion.current) return;
        setCaCertificates((certificates ?? []).reduce<Record<string, CaCertificate>>((result, certificate) => { result[certificate.ca_number] = certificate as CaCertificate; return result; }, {}));
      }
      setLotsByMaterial(lotRows.reduce<Record<string, StockLot[]>>((result, lot) => { result[lot.material_id] = [...(result[lot.material_id] ?? []), lot]; return result; }, {}));
      setMaterials((data ?? []) as StockMaterial[]);
      setBalances(lotRows.reduce<Record<string, StockBalance>>((result, lot) => {
        const totalQuantity = Number(lot.received_quantity);
        const availableQuantity = Number(lot.available_quantity);
        const unitCost = Number(lot.unit_cost ?? 0);
        result[lot.material_id] = {
          totalQuantity: (result[lot.material_id]?.totalQuantity ?? 0) + totalQuantity,
          availableQuantity: (result[lot.material_id]?.availableQuantity ?? 0) + availableQuantity,
          totalCost: (result[lot.material_id]?.totalCost ?? 0) + totalQuantity * unitCost,
          availableCost: (result[lot.material_id]?.availableCost ?? 0) + availableQuantity * unitCost,
        };
        return result;
      }, {}));
      const variantMap = (variants ?? []).reduce<Record<string, VariantBalance>>((result, variant) => { result[variant.id] = { id: variant.id, label: variant.size || variant.name, totalQuantity: 0, availableQuantity: 0 }; return result; }, {});
      lotRows.forEach((lot) => { if (lot.variant_id && variantMap[lot.variant_id]) { variantMap[lot.variant_id].totalQuantity += Number(lot.received_quantity); variantMap[lot.variant_id].availableQuantity += Number(lot.available_quantity); } });
      setVariantBalances((variants ?? []).reduce<Record<string, VariantBalance[]>>((result, variant) => { result[variant.material_id] = [...(result[variant.material_id] ?? []), variantMap[variant.id]]; return result; }, {}));
    } catch (caught) {
      if (mountedRef.current && version === loadVersion.current) setError(friendlyError(caught, "Não foi possível carregar o estoque."));
    } finally {
      if (mountedRef.current && version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const refresh = () => void load();
    const events = ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"];
    events.forEach((eventName) => window.addEventListener(eventName, refresh));
    void load();
    return () => { mountedRef.current = false; loadVersion.current += 1; events.forEach((eventName) => window.removeEventListener(eventName, refresh)); };
  }, []);

  function retryLoad() { void load(); }
  useEffect(() => { const requestedFilter = new URLSearchParams(window.location.search).get("filter"); if (["normal", "low", "empty"].includes(requestedFilter ?? "")) setFilter(requestedFilter!); }, []);
  const rows = useMemo(() => materials.filter((item) => {
    const current = balances[item.id]?.availableQuantity ?? 0;
    const situation = stockSituation(current, Number(item.minimum_stock));
    return normalize(`${item.name} ${item.internal_code}`).includes(normalize(query)) && (filter === "all" || situation === filter);
  }).sort((a, b) => {
    const value = sortBy === "name" ? a.name.localeCompare(b.name, "pt-BR") : (balances[a.id]?.availableQuantity ?? 0) - (balances[b.id]?.availableQuantity ?? 0);
    return ascending ? value : -value;
  }), [materials, balances, query, filter, sortBy, ascending]);
  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const paginatedRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [query, filter, sortBy, ascending]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  function toggleSort() { if (sortBy === "name") setSortBy("balance"); else setAscending((current) => !current); }
  const sortLabel = sortBy === "name" ? "Ordenar por saldo" : `Saldo: ${ascending ? "menor primeiro" : "maior primeiro"}`;
  const normalCount = materials.filter((item) => stockSituation(balances[item.id]?.availableQuantity ?? 0, Number(item.minimum_stock)) === "normal").length;
  const lowCount = materials.filter((item) => stockSituation(balances[item.id]?.availableQuantity ?? 0, Number(item.minimum_stock)) === "low").length;
  const emptyCount = materials.filter((item) => stockSituation(balances[item.id]?.availableQuantity ?? 0, Number(item.minimum_stock)) === "empty").length;

  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">CONTROLE OPERACIONAL</p><h1>Estoque</h1><p className="module-subtitle">Acompanhe saldos consolidados por material, lote e variação.</p></div><Link className="primary-button" href="/entries">Registrar entrada</Link></header>
    {error && <FeedbackMessage onRetry={retryLoad}>{error}</FeedbackMessage>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar material ou código" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar material ou código" /></div><select aria-label="Filtrar estoque por situação" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todas as situações</option><option value="normal">Normal</option><option value="low">Estoque baixo</option><option value="empty">Sem estoque</option></select></section>
    {!loading && <section className="module-summary"><div><strong>{materials.length}</strong><span>materiais</span></div><div><strong>{normalCount}</strong><span>estoque normal</span></div><div><strong>{lowCount}</strong><span>estoque baixo</span></div><div><strong>{emptyCount}</strong><span>sem estoque</span></div></section>}
    <section className="panel module-table-card"><div className="panel-header"><div><h2>Posição atual do estoque</h2><p>{rows.length} material(is) listados · disponibilidade atualizada pelas entregas</p></div><button className="select-button" aria-label={sortLabel} onClick={toggleSort}>{sortLabel} {ascending ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}</button></div>
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando estoque...</div> : <div className="table-wrap"><table className="stock-table" aria-label="Posição atual do estoque"><thead><tr><th scope="col">MATERIAL / CÓDIGO</th><th scope="col">TIPO</th><th scope="col">SITUAÇÃO</th><th scope="col">TOTAL RECEBIDO</th><th scope="col">DISPONÍVEL</th><th scope="col">EM USO / ENTREGUE</th><th scope="col">CUSTO UNITÁRIO</th><th scope="col">VALOR DISPONÍVEL</th><th scope="col">VALOR TOTAL</th><th scope="col">ESTOQUE MÍNIMO</th><th scope="col">LOCALIZAÇÃO</th></tr></thead><tbody>
        {paginatedRows.map((item) => {
          const balance = balances[item.id] ?? { totalQuantity: 0, availableQuantity: 0, totalCost: 0, availableCost: 0 };
          const current = balance.availableQuantity;
          const inUse = balance.totalQuantity - balance.availableQuantity;
          const unitCost = balance.totalQuantity > 0 ? balance.totalCost / balance.totalQuantity : 0;
          const situation = stockSituation(current, Number(item.minimum_stock));
          const [label, tone] = situation === "empty" ? ["Sem estoque", "danger"] : situation === "low" ? ["Estoque baixo", "warning"] : ["Normal", "success"];
          const variations = variantBalances[item.id] ?? [];
          const lots = (lotsByMaterial[item.id] ?? []).slice().sort((a, b) => b.entry_date.localeCompare(a.entry_date));
          return <tr key={item.id}>
            <td><div className="material-cell"><div className={`material-type-icon ${item.type === "EPI" ? "epi" : item.type === "EPC" ? "epc" : "ferramental"}`}><Boxes size={17} /></div><div><strong title={item.name}>{item.name}</strong><small>{item.internal_code || "Código não informado"} · {item.unit}</small>
              {variations.length > 0 && <details className="stock-variations"><summary>Ver variações ({variations.length})</summary><div>{variations.map((variation) => <span key={variation.id}><strong title={variation.label}>{variation.label}</strong><small>{variation.availableQuantity} disponível(is) · {variation.totalQuantity} recebido(s)</small></span>)}</div></details>}
              {lots.length > 0 && <details className="stock-variations stock-lot-details"><summary>Ver lotes, CA e ensaios ({lots.length})</summary><div>{lots.map((lot) => {
                const ca = caSituation(lot, caCertificates[lot.ca_number ?? ""]);
                const variation = variations.find((entry) => entry.id === lot.variant_id);
                return <span key={lot.id}><strong title={lot.lot_number}>{lot.lot_number}{variation ? ` · ${variation.label}` : ""}</strong><small>{lot.available_quantity} disponível(is) · entrada em {new Date(`${lot.entry_date}T00:00:00`).toLocaleDateString("pt-BR")}</small>{lot.ca_number && <small>CA {lot.ca_number} · <span className={`status-pill ${ca.tone}`}>{ca.label}</span></small>}{item.ca_required && !lot.ca_number && <small><span className="status-pill warning">CA pendente</span></small>}{item.test_required && <small>{lot.test_performed_at ? <>{lot.test_number ? `Ensaio ${lot.test_number} · ` : "Ensaio "}{new Date(`${lot.test_performed_at}T00:00:00`).toLocaleDateString("pt-BR")} · validade {lot.test_expires_at ? new Date(`${lot.test_expires_at}T00:00:00`).toLocaleDateString("pt-BR") : "não informada"}{lot.test_report_number ? ` · Laudo ${lot.test_report_number}` : item.report_required ? " · laudo pendente" : ""}</> : <span className="status-pill warning">Ensaio pendente</span>}</small>}</span>;
              })}</div></details>}
            </div></div></td>
            <td><span className={`type-badge ${item.type.toLowerCase()}`}>{item.type}</span></td><td><span className={`status-pill ${tone}`}>{label}</span></td><td><strong>{balance.totalQuantity}</strong> {item.unit}</td><td><strong className="stock-number">{current}</strong> {item.unit}</td><td>{inUse} {item.unit}</td><td>{currency(unitCost)}</td><td><strong>{currency(balance.availableCost)}</strong></td><td><strong>{currency(balance.totalCost)}</strong></td><td>{item.minimum_stock} {item.unit}</td><td><span title={item.location || "Localização não informada"} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{item.location || <span className="muted-cell">Não informado</span>}</span></td>
          </tr>;
        })}
      </tbody></table>
      {rows.length > pageSize && <nav className="pagination-controls" aria-label="Paginação"><button className="secondary-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Anterior</button><span aria-live="polite">Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} de {rows.length} · Página {page} de {pageCount}</span><button className="secondary-button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Próxima</button></nav>}
      {!rows.length && <div className="empty-state"><Boxes size={27} /><strong>Nenhum material encontrado</strong><span>Cadastre materiais ou ajuste os filtros.</span></div>}</div>}
    </section>
  </main>;
}
