"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ClipboardList, LoaderCircle, Printer, UserRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Delivery = { id: string; delivered_at: string; reason: string; notes: string | null; employee: { full_name: string; registration: string | null } | null; delivery_items: Array<{ quantity: number; expected_replacement_at: string | null; material: { name: string; unit: string; internal_code: string | null } | null }> };
const reasons: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");

export function RecentDeliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [printable, setPrintable] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [{ data, error: loadError }, { data: profileData }] = await Promise.all([
        supabase.from("deliveries").select("id,delivered_at,reason,notes,employee:employees(full_name,registration),delivery_items(quantity,expected_replacement_at,material:materials(name,unit,internal_code))").order("delivered_at", { ascending: false }).order("created_at", { ascending: false }).limit(10),
        supabase.from("profiles").select("organization_id").single(),
      ]);
      if (loadError) setError(loadError.message); else setDeliveries((data ?? []) as unknown as Delivery[]);
      if (profileData?.organization_id) {
        const { data: organization } = await supabase.from("organizations").select("name").eq("id", profileData.organization_id).single();
        setCompanyName(organization?.name ?? "");
      }
      setLoading(false);
    }
    void load();
  }, []);

  function printTerm(delivery: Delivery) { setPrintable(delivery); window.setTimeout(() => window.print(), 100); }

  return <section className="panel recent-deliveries-card"><div className="panel-header no-print"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas entregas</h2><p>Entregas realizadas recentemente para os colaboradores.</p></div><ClipboardList size={21} /></div>{loading ? <div className="module-loading no-print"><LoaderCircle className="spin" size={22} /> Carregando histórico...</div> : error ? <div className="feedback error-feedback no-print">Não foi possível carregar o histórico.</div> : deliveries.length ? <div className="recent-delivery-list no-print">{deliveries.map((delivery) => <article className="recent-delivery-item" key={delivery.id}><div className="recent-delivery-icon"><UserRound size={17} /></div><div className="recent-delivery-main"><strong>{delivery.employee?.full_name || "Funcionário não informado"}</strong><small>{delivery.employee?.registration ? `Matrícula ${delivery.employee.registration} · ` : ""}{date(delivery.delivered_at)} · {reasons[delivery.reason] || delivery.reason}</small><div className="recent-delivery-materials">{delivery.delivery_items.map((item, index) => <span key={`${delivery.id}-${index}`}>{item.quantity}x {item.material?.name || "Material"}</span>)}</div></div><button type="button" className="action-button" onClick={() => printTerm(delivery)}><Printer size={14} /> Imprimir termo</button><CalendarClock size={17} className="recent-delivery-date" /></article>)}</div> : <div className="empty-state no-print"><ClipboardList size={27} /><strong>Nenhuma entrega registrada</strong><span>As entregas confirmadas aparecerão aqui.</span></div>}{printable && <section className="delivery-term-print"><div className="delivery-term-header"><div><strong>{companyName || "Empresa"}</strong><span>Termo de entrega e responsabilidade de materiais</span></div><button type="button" className="no-print" onClick={() => setPrintable(null)} aria-label="Fechar termo"><X size={18} /></button></div><div className="delivery-term-meta"><div><small>Colaborador</small><strong>{printable.employee?.full_name || "Não informado"}</strong></div><div><small>Matrícula</small><strong>{printable.employee?.registration || "Não informada"}</strong></div><div><small>Data da entrega</small><strong>{date(printable.delivered_at)}</strong></div><div><small>Motivo</small><strong>{reasons[printable.reason] || printable.reason}</strong></div></div><h2>Materiais entregues</h2><table><thead><tr><th>Material</th><th>Código</th><th>Quantidade</th><th>Troca prevista</th></tr></thead><tbody>{printable.delivery_items.map((item, index) => <tr key={`${printable.id}-term-${index}`}><td>{item.material?.name || "Material"}</td><td>{item.material?.internal_code || "—"}</td><td>{item.quantity} {item.material?.unit || "un."}</td><td>{item.expected_replacement_at ? date(item.expected_replacement_at) : "Conforme necessidade"}</td></tr>)}</tbody></table><p className="delivery-term-text">Declaro que recebi os materiais relacionados acima em condições adequadas de uso, comprometendo-me a utilizá-los corretamente, conservá-los e devolvê-los ao término do serviço, desligamento, troca de função ou quando solicitado. Em caso de perda, extravio, dano ou mau uso, o ocorrido será apurado conforme as políticas da empresa e a legislação aplicável, podendo gerar responsabilização após a devida análise.</p>{printable.notes && <p className="delivery-term-notes"><strong>Observações:</strong> {printable.notes}</p>}<div className="delivery-term-signatures"><div>Assinatura do colaborador<strong>{printable.employee?.full_name || ""}</strong></div><div>Assinatura do responsável<strong>Responsável pela entrega</strong></div></div></section>}</section>;
}
