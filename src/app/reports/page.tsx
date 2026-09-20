"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Download, LoaderCircle, Search, ShieldCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Material = { id: string; internal_code: string; name: string; type: "EPI" | "EPC" | "FERRAMENTAL"; minimum_stock: number; unit: string; location: string | null; status: string };
type Lot = { id: string; material_id: string; lot_number: string; available_quantity: number; expires_at: string | null; material: { name: string; internal_code: string; unit: string } | null };
type Movement = { id: string; movement_type: string; quantity: number; created_at: string; material: { name: string; internal_code: string; unit: string } | null };

function localDateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
function daysUntil(value: string | null) { return value ? Math.ceil((new Date(value + "T00:00:00").getTime() - new Date(`${localDateKey(new Date())}T00:00:00`).getTime()) / 86400000) : null; }

const reportTypes = [["stock", "Relatório de estoque"], ["low", "Estoque abaixo do mínimo"], ["validity", "Lotes próximos do vencimento"], ["movements", "Movimentações do estoque"]] as const;

export default function ReportsPage() {
  const [report, setReport] = useState("stock");
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [alertDays, setAlertDays] = useState(30);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const loadVersion = useRef(0);

  useEffect(() => {
    const version = ++loadVersion.current;
    async function load() {
      setLoading(true);
      setError("");
      try {
      const supabase = createClient();
      const [{ data: materialData, error: materialError }, { data: lotData, error: lotError }, { data: movementData, error: movementError }, { data: organizationData, error: organizationError }] = await Promise.all([
        supabase.from("materials").select("id, internal_code, name, type, minimum_stock, unit, location, status").eq("status", "active").order("name"),
        supabase.from("material_lots").select("id, material_id, lot_number, available_quantity, expires_at, material:materials!inner(name, internal_code, unit)").eq("materials.status", "active").order("expires_at", { ascending: true, nullsFirst: false }),
        supabase.from("stock_movements").select("id, movement_type, quantity, created_at, material:materials!inner(name, internal_code, unit)").eq("materials.status", "active").order("created_at", { ascending: false }).limit(500),
        supabase.from("organizations").select("validity_alert_days").single(),
      ]);
      const loadError = materialError ?? lotError ?? movementError ?? organizationError;
      if (version !== loadVersion.current) return;
      if (loadError) setError(friendlyError(loadError, "Não foi possível carregar os relatórios."));
      else {
        setMaterials((materialData ?? []) as Material[]);
        setLots((lotData ?? []) as unknown as Lot[]);
        setMovements((movementData ?? []) as unknown as Movement[]);
        setTotals((lotData ?? []).reduce<Record<string, number>>((acc, lot) => { acc[lot.material_id] = (acc[lot.material_id] ?? 0) + lot.available_quantity; return acc; }, {}));
        setAlertDays(Math.max(0, Number(organizationData?.validity_alert_days ?? 30)));
      }
      } catch (caught) {
        if (version === loadVersion.current) setError(friendlyError(caught, "Não foi possível carregar os relatórios."));
      } finally {
        if (version === loadVersion.current) setLoading(false);
      }
    }
    void load();
    return () => { loadVersion.current += 1; };
  }, [reloadKey]);

  useEffect(() => {
    const refresh = () => setReloadKey((current) => current + 1);
    const events = ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"];
    events.forEach((eventName) => window.addEventListener(eventName, refresh));
    return () => events.forEach((eventName) => window.removeEventListener(eventName, refresh));
  }, []);

  const filteredMaterials = useMemo(() => materials.filter((item) => {
    const matches = (item.name + " " + item.internal_code).toLowerCase().includes(query.toLowerCase());
    return matches && (report !== "low" || Number(item.minimum_stock) > 0 && (totals[item.id] ?? 0) < Number(item.minimum_stock));
  }), [materials, query, report, totals]);
  const filteredLots = useMemo(() => lots.filter((lot) => {
    const days = daysUntil(lot.expires_at);
    return (lot.material?.name + " " + lot.material?.internal_code + " " + lot.lot_number).toLowerCase().includes(query.toLowerCase()) && days !== null && days <= alertDays;
  }), [lots, query, alertDays]);
  const filteredMovements = useMemo(() => movements.filter((item) => {
    const movementDate = localDateKey(new Date(item.created_at));
    const textMatch = (item.material?.name + " " + item.material?.internal_code).toLowerCase().includes(query.trim().toLowerCase());
    return textMatch && (!fromDate || movementDate >= fromDate) && (!toDate || movementDate <= toDate);
  }), [movements, query, fromDate, toDate]);

  const pageSize = 50;
  const reportRows = report === "validity" ? filteredLots : report === "movements" ? filteredMovements : filteredMaterials;
  const pageCount = Math.max(1, Math.ceil(reportRows.length / pageSize));
  const visibleMaterials = filteredMaterials.slice((page - 1) * pageSize, page * pageSize);
  const visibleLots = filteredLots.slice((page - 1) * pageSize, page * pageSize);
  const visibleMovements = filteredMovements.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [report, query, fromDate, toDate, alertDays]);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);

  if (error && !loading) return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">GESTÃO E CONFORMIDADE</p><h1>Relatórios</h1><p className="module-subtitle">Consulte indicadores operacionais e exporte os dados para CSV.</p></div></header><section className="panel runtime-error-card" aria-live="polite"><FeedbackMessage onRetry={() => setReloadKey((current) => current + 1)}>{error}</FeedbackMessage></section></main>;

  function exportCsv() {
    let rows: string[][];
    if (report === "movements") rows = [["Data", "Material", "Tipo", "Quantidade"], ...filteredMovements.map((item) => [new Date(item.created_at).toLocaleString("pt-BR"), item.material?.name ?? "", item.movement_type, String(item.quantity)])];
    else if (report === "validity") rows = [["Material", "Lote", "Saldo", "Validade"], ...filteredLots.map((item) => [item.material?.name ?? "", item.lot_number, String(item.available_quantity), item.expires_at ?? ""] )];
    else rows = [["Código", "Material", "Tipo", "Estoque atual", "Estoque mínimo"], ...filteredMaterials.map((item) => [item.internal_code, item.name, item.type, String(totals[item.id] ?? 0), String(item.minimum_stock)])];
    const csv = rows.map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "relatorio-epis.csv"; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const title = reportTypes.find(([value]) => value === report)?.[1] ?? "Relatórios";
  const pagination = reportRows.length > 0 && <div className="pagination" aria-label="Paginação do relatório"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Anterior</button><span>Mostrando {(page - 1) * pageSize + 1} – {Math.min(page * pageSize, reportRows.length)} de {reportRows.length} · Página {page} de {pageCount}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Próxima</button></div>;

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">GESTÃO E CONFORMIDADE</p><h1>Relatórios</h1><p className="module-subtitle">Consulte indicadores operacionais e exporte os dados para CSV.</p></div><button className="primary-button" type="button" onClick={exportCsv} disabled={loading || !reportRows.length} aria-label="Exportar relatório atual em CSV"><Download size={16} aria-hidden="true" /> Exportar CSV</button></header>{error && <div className="feedback error-feedback" role="alert"><X size={17} aria-hidden="true" /> {error}</div>}<section className="module-toolbar" aria-label="Filtros do relatório"><div className="module-search"><Search size={17} aria-hidden="true" /><input id="reports-search" aria-label="Buscar no relatório" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no relatório" /></div><label htmlFor="reports-type">Tipo de relatório<select id="reports-type" aria-label="Tipo de relatório" value={report} onChange={(event) => setReport(event.target.value)}>{reportTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor="reports-from">De<input id="reports-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label htmlFor="reports-to">Até<input id="reports-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></section>{!loading && <section className="module-summary" aria-label="Resumo do relatório"><div><strong>{materials.length}</strong><span>materiais</span></div><div><strong>{Object.values(totals).reduce((sum, value) => sum + value, 0)}</strong><span>itens em estoque</span></div><div><strong>{lots.filter((lot) => { const days = daysUntil(lot.expires_at); return days !== null && days <= alertDays; }).length}</strong><span>lotes até {alertDays} dias</span></div><div><strong>{movements.length}</strong><span>movimentações</span></div></section>}<section className="panel module-table-card"><div className="panel-header"><div><h2>{title}</h2><p>Dados atualizados diretamente do Supabase</p></div></div>{loading ? <div className="module-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando relatório...</div> : report === "validity" ? <div className="table-wrap"><table aria-label="Lotes próximos do vencimento"><thead><tr><th scope="col">MATERIAL</th><th scope="col">LOTE</th><th scope="col">SALDO</th><th scope="col">VALIDADE</th></tr></thead><tbody>{visibleLots.map((lot) => <tr key={lot.id}><td><div className="material-cell"><div className="material-type-icon epi" aria-hidden="true"><Boxes size={17} /></div><div><strong>{lot.material?.name || "Material não informado"}</strong><small>{lot.material?.internal_code || "Código não informado"}</small></div></div></td><td>{lot.lot_number}</td><td>{lot.available_quantity} {lot.material?.unit}</td><td>{lot.expires_at ? new Date(lot.expires_at + "T00:00:00").toLocaleDateString("pt-BR") : "Sem data"}</td></tr>)}</tbody></table>{!filteredLots.length && <EmptyReportState />} {pagination}</div> : report === "movements" ? <div className="table-wrap"><table aria-label="Movimentações do estoque"><thead><tr><th scope="col">DATA</th><th scope="col">MATERIAL</th><th scope="col">TIPO</th><th scope="col">QUANTIDADE</th></tr></thead><tbody>{visibleMovements.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString("pt-BR")}</td><td>{item.material?.name || "Material não informado"}</td><td>{item.movement_type}</td><td>{item.quantity} {item.material?.unit}</td></tr>)}</tbody></table>{!filteredMovements.length && <EmptyReportState />} {pagination}</div> : <div className="table-wrap"><table aria-label="Estoque de materiais"><thead><tr><th scope="col">CÓDIGO</th><th scope="col">MATERIAL</th><th scope="col">TIPO</th><th scope="col">ESTOQUE</th><th scope="col">MÍNIMO</th><th scope="col">SITUAÇÃO</th></tr></thead><tbody>{visibleMaterials.map((item) => { const stock = totals[item.id] ?? 0; const empty = stock === 0; const low = stock > 0 && Number(item.minimum_stock) > 0 && stock < item.minimum_stock; return <tr key={item.id}><td>{item.internal_code || "Código não informado"}</td><td><strong>{item.name || "Material não informado"}</strong></td><td>{item.type}</td><td>{stock} {item.unit}</td><td>{item.minimum_stock}</td><td><span className={"status-pill " + (empty ? "danger" : low ? "warning" : "success")}>{empty ? "Sem estoque" : low ? "Estoque baixo" : "Normal"}</span></td></tr>; })}</tbody></table>{!filteredMaterials.length && <div className="empty-state" role="status" aria-live="polite"><ShieldCheck size={27} aria-hidden="true" /><strong>Nenhum material encontrado</strong><span>Ajuste os filtros selecionados.</span></div>}{pagination}</div>}</section></main>;
}

function EmptyReportState() {
  return <div className="empty-state" role="status" aria-live="polite"><ShieldCheck size={27} aria-hidden="true" /><strong>Nenhum registro encontrado</strong><span>Ajuste os filtros ou aguarde novos lançamentos.</span></div>;
}
