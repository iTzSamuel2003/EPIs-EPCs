"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardList, History, LoaderCircle, Printer, RotateCcw, ShieldAlert, Truck, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmployeeNavigation } from "@/components/employee-navigation";
import { createClient } from "@/lib/supabase/client";

type Employee = { id: string; full_name: string; registration: string | null; job_title: string | null; department: string | null };
type Delivery = { id: string; delivered_at: string; reason: string; notes: string | null; responsible_id: string };
type DeliveryItem = { id: string; delivery_id: string; quantity: number; material: { name: string; internal_code: string | null; unit: string } | null; lot: { lot_number: string } | null };
type ReturnRecord = { id: string; returned_at: string; reason: string; notes: string | null; responsible_id: string };
type ReturnItem = { return_id: string; delivery_item_id: string; quantity: number; equipment_condition: string; destination: string };
type Accountability = { return_id: string; incident_type: string; incident_description: string | null; employee_signature_name: string | null; deduction_requested: boolean; deduction_amount: number | null };
type Profile = { id: string; full_name: string };
type HistoryEvent = { id: string; date: string; kind: "delivery" | "return"; material: string; code: string; unit: string; quantity: number; lot: string; reason: string; notes: string; responsible: string; condition?: string; destination?: string; accountability?: Accountability };

const deliveryReasons: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
const returnReasons: Record<string, string> = { replacement: "Substituição", termination: "Desligamento", role_change: "Alteração de função", damaged: "Equipamento danificado", voluntary: "Devolução voluntária", other: "Outro" };
const incidentLabels: Record<string, string> = { normal: "Normal", misuse: "Mau uso", loss: "Extravio", theft: "Furto", damage: "Dano", other: "Outro" };
const conditionLabels: Record<string, string> = { good: "Bom", used: "Usado", damaged: "Danificado", unusable: "Inutilizado" };
const destinationLabels: Record<string, string> = { stock: "Estoque", maintenance: "Manutenção", disposal: "Descarte" };

function formatDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR"); }
function accountabilityDetails(value?: Accountability) { if (!value || value.incident_type === "normal") return ""; const parts = [incidentLabels[value.incident_type] ?? value.incident_type, value.employee_signature_name ? `Assinado por ${value.employee_signature_name}` : "Sem assinatura", value.deduction_requested ? `Desconto solicitado${value.deduction_amount ? `: R$ ${Number(value.deduction_amount).toFixed(2)}` : ""}` : ""]; return ` · ${parts.filter(Boolean).join(" · ")}`; }

export default function EmployeeHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [kind, setKind] = useState("all");
  const [materialFilter, setMaterialFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: employeeData, error: employeeError } = await supabase.from("employees").select("id,full_name,registration,job_title,department").eq("id", id).maybeSingle();
      if (employeeError || !employeeData) { setError(employeeError?.message ?? "Funcionário não encontrado."); setLoading(false); return; }
      const [{ data: deliveries, error: deliveriesError }, { data: returns, error: returnsError }, { data: profileData }] = await Promise.all([
        supabase.from("deliveries").select("id,delivered_at,reason,notes,responsible_id").eq("employee_id", id).order("delivered_at", { ascending: false }),
        supabase.from("returns").select("id,returned_at,reason,notes,responsible_id").eq("employee_id", id).order("returned_at", { ascending: false }),
        supabase.from("profiles").select("id,full_name"),
      ]);
      if (deliveriesError || returnsError) { setError(deliveriesError?.message ?? returnsError?.message ?? "Não foi possível carregar o histórico."); setLoading(false); return; }
      const deliveryRows = (deliveries ?? []) as Delivery[];
      const returnRows = (returns ?? []) as ReturnRecord[];
      const deliveryIds = deliveryRows.map((item) => item.id);
      const returnIds = returnRows.map((item) => item.id);
      const [{ data: deliveryItems, error: itemError }, { data: returnItems, error: returnItemError }, { data: accountabilityData }] = await Promise.all([
        deliveryIds.length ? supabase.from("delivery_items").select("id,delivery_id,quantity,materials(name,internal_code,unit),material_lots(lot_number)").in("delivery_id", deliveryIds) : Promise.resolve({ data: [], error: null }),
        returnIds.length ? supabase.from("return_items").select("return_id,delivery_item_id,quantity,equipment_condition,destination").in("return_id", returnIds) : Promise.resolve({ data: [], error: null }),
        returnIds.length ? supabase.from("return_accountability").select("return_id,incident_type,incident_description,employee_signature_name,deduction_requested,deduction_amount").in("return_id", returnIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (itemError || returnItemError) { setError(itemError?.message ?? returnItemError?.message ?? "Não foi possível carregar os itens do histórico."); setLoading(false); return; }
      const itemRows = (deliveryItems ?? []) as unknown as DeliveryItem[];
      const returnItemRows = (returnItems ?? []) as ReturnItem[];
      const deliveryById = new Map(deliveryRows.map((item) => [item.id, item]));
      const returnById = new Map(returnRows.map((item) => [item.id, item]));
      const itemById = new Map(itemRows.map((item) => [item.id, item]));
      const accountabilityByReturn = new Map(((accountabilityData ?? []) as Accountability[]).map((item) => [item.return_id, item]));
      const profileById = new Map(((profileData ?? []) as Profile[]).map((item) => [item.id, item.full_name]));
      const deliveryEvents = itemRows.map((item): HistoryEvent => { const delivery = deliveryById.get(item.delivery_id)!; return { id: `delivery-${item.id}`, date: delivery.delivered_at, kind: "delivery", material: item.material?.name ?? "Material", code: item.material?.internal_code ?? "", unit: item.material?.unit ?? "un.", quantity: item.quantity, lot: item.lot?.lot_number ?? "—", reason: deliveryReasons[delivery.reason] ?? delivery.reason, notes: delivery.notes ?? "", responsible: profileById.get(delivery.responsible_id) ?? "Usuário do sistema" }; });
      const returnEvents = returnItemRows.map((item): HistoryEvent => { const returned = returnById.get(item.return_id)!; const delivered = itemById.get(item.delivery_item_id); const accountability = accountabilityByReturn.get(item.return_id); return { id: `return-${item.return_id}-${item.delivery_item_id}`, date: returned.returned_at, kind: "return", material: delivered?.material?.name ?? "Material", code: delivered?.material?.internal_code ?? "", unit: delivered?.material?.unit ?? "un.", quantity: -item.quantity, lot: delivered?.lot?.lot_number ?? "—", reason: returnReasons[returned.reason] ?? returned.reason, notes: returned.notes ?? "", responsible: profileById.get(returned.responsible_id) ?? "Usuário do sistema", condition: conditionLabels[item.equipment_condition] ?? item.equipment_condition, destination: destinationLabels[item.destination] ?? item.destination, accountability }; });
      setEmployee(employeeData as Employee); setEvents([...deliveryEvents, ...returnEvents].sort((a, b) => b.date.localeCompare(a.date))); setLoading(false);
    }
    void load();
  }, [id]);

  const materials = useMemo(() => [...new Set(events.map((event) => event.material))].sort(), [events]);
  const filteredEvents = useMemo(() => events.filter((event) => (kind === "all" || event.kind === kind) && (!materialFilter || event.material === materialFilter) && (!from || event.date >= from) && (!to || event.date <= to)), [events, from, kind, materialFilter, to]);
  const summary = useMemo(() => ({ delivered: filteredEvents.filter((event) => event.kind === "delivery").reduce((total, event) => total + event.quantity, 0), returned: filteredEvents.filter((event) => event.kind === "return").reduce((total, event) => total + Math.abs(event.quantity), 0), incidents: filteredEvents.filter((event) => event.accountability && event.accountability.incident_type !== "normal").length }), [filteredEvents]);

  if (loading) return <main className="module-shell"><div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando histórico...</div></main>;
  if (error || !employee) return <main className="module-shell"><div className="feedback error-feedback"><X size={17} /> {error || "Funcionário não encontrado."}</div><Link className="secondary-button" href="/employees"><ArrowLeft size={16} /> Funcionários</Link></main>;
  return <main className="module-shell history-page"><header className="module-header no-print"><div><Link className="employee-back-link" href={`/employees/${id}`}><ArrowLeft size={14} /> Ficha do funcionário</Link><p className="eyebrow">CONTROLE INDIVIDUAL</p><h1>Histórico de materiais</h1><p className="module-subtitle">{employee.full_name} · {employee.registration || "Matrícula não informada"} · {employee.job_title || "Função não informada"}</p></div><div className="employee-header-tools"><EmployeeNavigation id={id} current="history" /><button className="secondary-button" onClick={() => window.print()}><Printer size={16} /> Imprimir histórico</button></div></header>
    <section className="module-summary history-summary"><div><Truck size={18} /><strong>{summary.delivered}</strong><span>Itens entregues</span></div><div><RotateCcw size={18} /><strong>{summary.returned}</strong><span>Itens devolvidos</span></div><div><ClipboardList size={18} /><strong>{filteredEvents.length}</strong><span>Movimentações</span></div><div><ShieldAlert size={18} /><strong>{summary.incidents}</strong><span>Ocorrências</span></div></section>
    <section className="module-toolbar no-print history-filters"><label>De<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Até<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Todos</option><option value="delivery">Entregas</option><option value="return">Devoluções</option></select></label><label>Material<select value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)}><option value="">Todos</option>{materials.map((material) => <option key={material} value={material}>{material}</option>)}</select></label></section>
    <section className="panel module-table-card history-table-card"><div className="panel-header"><div><h2>Movimentações registradas</h2><p>{filteredEvents.length} evento(s) encontrado(s).</p></div><History size={20} /></div>{filteredEvents.length ? <div className="table-wrap"><table><thead><tr><th>DATA</th><th>MATERIAL</th><th>MOVIMENTAÇÃO</th><th>QTD.</th><th>LOTE</th><th>MOTIVO / DETALHES</th><th>RESPONSÁVEL</th></tr></thead><tbody>{filteredEvents.map((event) => <tr key={event.id}><td>{formatDate(event.date)}</td><td><strong>{event.material}</strong><small>{event.code ? `${event.code} · ${event.unit}` : event.unit}</small></td><td><span className={`movement-type ${event.kind === "delivery" ? "success" : "warning"}`}>{event.kind === "delivery" ? <Truck size={13} /> : <RotateCcw size={13} />} {event.kind === "delivery" ? "Entrega" : "Devolução"}</span></td><td className={event.quantity < 0 ? "history-negative" : "history-positive"}>{event.quantity > 0 ? "+" : ""}{event.quantity}</td><td>{event.lot}</td><td><strong>{event.reason}</strong><small>{event.kind === "return" ? `${event.condition} · ${event.destination}` : event.notes || "Sem observações"}{accountabilityDetails(event.accountability)}</small></td><td>{event.responsible}</td></tr>)}</tbody></table></div> : <div className="empty-state"><ClipboardList size={27} /><strong>Nenhuma movimentação encontrada</strong><span>Não há eventos para os filtros selecionados.</span></div>}</section>
  </main>;
}
