"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Boxes, LoaderCircle, Search, SlidersHorizontal, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Movement = { id: string; movement_type: "entry" | "delivery" | "return" | "adjustment" | "discard" | "transfer"; quantity: number; notes: string | null; created_at: string; material: { name: string; internal_code: string; unit: string } | null; employee: { full_name: string; registration: string | null } | null };
const labels: Record<Movement["movement_type"], string> = { entry: "Entrada", delivery: "Entrega", return: "Devolução", adjustment: "Ajuste", discard: "Descarte", transfer: "Transferência" };
const tones: Record<Movement["movement_type"], string> = { entry: "success", delivery: "warning", return: "success", adjustment: "warning", discard: "danger", transfer: "" };
const icons: Record<Movement["movement_type"], typeof ArrowUpRight> = { entry: ArrowUpRight, delivery: ArrowDownToLine, return: ArrowUpRight, adjustment: SlidersHorizontal, discard: ArrowDownToLine, transfer: SlidersHorizontal };
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function cleanNotes(movement: Movement) { const clean = movement.notes?.replace(/^(Entrega|Devolução)\s+[0-9a-f-]+/i, "").replace(/\s*[·•\-:]?\s*destino:\s*(stock|maintenance|disposal)\b/ig, "").trim().replace(/^[·•\-:]+\s*/, ""); return clean || (movement.movement_type === "delivery" ? "Entrega vinculada ao funcionário" : movement.movement_type === "return" ? "Devolução vinculada ao funcionário" : movement.movement_type === "discard" ? "Material descartado" : "Sem observação"); }
function returnDestination(movement: Movement) { const value = movement.notes?.match(/\bdestino:\s*(stock|maintenance|disposal)\b/i)?.[1].toLowerCase(); return value === "maintenance" ? "Manutenção" : value === "disposal" ? "Descarte" : value === "stock" ? "Estoque" : "Destino não informado"; }
function destination(movement: Movement) { if (movement.movement_type === "delivery" && movement.employee) return movement.employee.full_name; if (movement.movement_type === "return") return returnDestination(movement); if (movement.movement_type === "entry") return "Estoque"; if (movement.movement_type === "discard") return "Descarte"; if (movement.movement_type === "adjustment") return "Ajuste de estoque"; if (movement.movement_type === "transfer") return "Transferência"; return "Não informado"; }

export default function MovementsPage() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const { data: movementData, error: movementError } = await supabase
        .from("stock_movements")
        .select("id, movement_type, quantity, notes, created_at, material:materials(name, internal_code, unit)")
        .order("created_at", { ascending: false })
        .limit(500);

      if (movementError) {
        setError(friendlyError(movementError, "Não foi possível concluir a operação."));
        setLoading(false);
        return;
      }

      const references = (movementData ?? []).reduce<{ deliveries: string[]; returns: string[] }>((result, movement) => {
        const reference = movement.notes?.match(/^(Entrega|Devolução)\s+([0-9a-f-]+)/i);
        if (!reference) return result;
        const target = reference[1].toLowerCase() === "entrega" ? result.deliveries : result.returns;
        if (!target.includes(reference[2])) target.push(reference[2]);
        return result;
      }, { deliveries: [], returns: [] });

      const [{ data: deliveryData, error: deliveryError }, { data: returnData, error: returnError }] = await Promise.all([
        references.deliveries.length ? supabase.from("deliveries").select("id, employee:employees(full_name, registration)").in("id", references.deliveries) : Promise.resolve({ data: [], error: null }),
        references.returns.length ? supabase.from("returns").select("id, employee:employees(full_name, registration)").in("id", references.returns) : Promise.resolve({ data: [], error: null }),
      ]);

      if (deliveryError || returnError) {
        setError(friendlyError(deliveryError ?? returnError, "Não foi possível carregar os funcionários vinculados."));
      } else {
        const deliveries = new Map((deliveryData ?? []).map((item) => [item.id, item.employee]));
        const returns = new Map((returnData ?? []).map((item) => [item.id, item.employee]));
        const enriched = (movementData ?? []).map((movement) => {
          const reference = movement.notes?.match(/^(Entrega|Devolução)\s+([0-9a-f-]+)/i);
          const employee = reference ? (reference[1].toLowerCase() === "entrega" ? deliveries.get(reference[2]) : returns.get(reference[2])) ?? null : null;
          return { ...movement, employee };
        });
        setMovements(enriched as unknown as Movement[]);
      }
      setLoading(false);
    }
    void load();
  }, [reloadKey]);
  useEffect(() => {
    const refresh = () => setReloadKey((current) => current + 1);
    ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"].forEach((eventName) => window.addEventListener(eventName, refresh));
    return () => ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"].forEach((eventName) => window.removeEventListener(eventName, refresh));
  }, []);
  const filtered = useMemo(() => movements.filter((movement) => normalize(`${movement.material?.name ?? ""} ${movement.material?.internal_code ?? ""} ${movement.employee?.full_name ?? ""} ${movement.employee?.registration ?? ""} ${movement.notes ?? ""}`).includes(normalize(query)) && (filter === "all" || movement.movement_type === filter)), [movements, query, filter]);
  if (error && !loading) return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">AUDITORIA OPERACIONAL</p><h1>Movimentações</h1><p className="module-subtitle">Acompanhe todas as entradas, entregas, devoluções e saídas do estoque.</p></div></header><section className="panel runtime-error-card"><FeedbackMessage onRetry={() => setReloadKey((current) => current + 1)}>{error}</FeedbackMessage></section></main>;
  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">AUDITORIA OPERACIONAL</p><h1>Movimentações</h1><p className="module-subtitle">Acompanhe todas as entradas, entregas, devoluções e saídas do estoque.</p></div></header>{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar material, código ou funcionário" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar material, código ou funcionário" /></div><select aria-label="Filtrar movimentações por tipo" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos os tipos</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></section>{!loading && (<section className="module-summary"><div><strong>{movements.length}</strong><span>movimentações registradas</span></div><div><strong>{movements.filter((item) => item.movement_type === "entry").length}</strong><span>entradas</span></div><div><strong>{movements.filter((item) => item.movement_type === "delivery").length}</strong><span>entregas</span></div><div><strong>{movements.filter((item) => item.movement_type === "return").length}</strong><span>devoluções</span></div></section>)}<section className="panel module-table-card"><div className="panel-header"><div><h2>Histórico do estoque</h2><p>{filtered.length} registro(s) listado(s)</p></div></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando movimentações...</div> : filtered.length ? <div className="table-wrap"><table aria-label="Histórico de movimentações do estoque"><thead><tr><th scope="col">DATA</th><th scope="col">MATERIAL / CÓDIGO</th><th scope="col">FUNCIONÁRIO</th><th scope="col">MATRÍCULA</th><th scope="col">DESTINO / ORIGEM</th><th scope="col">TIPO</th><th scope="col">QUANTIDADE</th><th scope="col">OBSERVAÇÃO</th></tr></thead><tbody>{filtered.map((movement) => { const Icon = icons[movement.movement_type]; const hasEmployee = Boolean((movement.movement_type === "delivery" || movement.movement_type === "return") && movement.employee); const materialName = movement.material?.name ?? "Material removido"; const employeeName = movement.employee?.full_name ?? ""; const movementDestination = destination(movement); const notes = cleanNotes(movement); return <tr key={movement.id}><td style={{ whiteSpace: "nowrap" }}>{new Date(movement.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td><td><div className="material-cell"><div className="material-type-icon epi"><Boxes size={17} /></div><div><strong title={materialName}>{materialName}</strong><small>{movement.material?.internal_code || "Código não informado"} · {movement.material?.unit}</small></div></div></td><td>{hasEmployee ? <strong title={employeeName} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{employeeName}</strong> : <span className="muted-cell">—</span>}</td><td>{hasEmployee ? movement.employee?.registration || <span className="muted-cell">Sem matrícula</span> : <span className="muted-cell">—</span>}</td><td><span className="muted-cell" title={movementDestination} style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{movementDestination}</span></td><td><span className={"movement-type " + tones[movement.movement_type]} aria-label={`Tipo: ${labels[movement.movement_type]}`}><Icon size={14} /> {labels[movement.movement_type]}</span></td><td style={{ whiteSpace: "nowrap" }}><strong>{movement.quantity}</strong> {movement.material?.unit}</td><td title={notes} style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: 280 }}>{notes}</td></tr>; })}</tbody></table></div> : <div className="empty-state"><SlidersHorizontal size={27} /><strong>Nenhuma movimentação encontrada</strong><span>Os registros aparecerão aqui conforme o estoque for movimentado.</span></div>}</section></main>;
}
