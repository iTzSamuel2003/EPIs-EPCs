"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ClipboardList, LoaderCircle, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Delivery = { id: string; delivered_at: string; reason: string; notes: string | null; employee: { full_name: string; registration: string | null } | null; delivery_items: Array<{ quantity: number; material: { name: string; unit: string } | null }> };
const reasons: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");

export function RecentDeliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await createClient().from("deliveries").select("id,delivered_at,reason,notes,employee:employees(full_name,registration),delivery_items(quantity,material:materials(name,unit))").order("delivered_at", { ascending: false }).order("created_at", { ascending: false }).limit(10);
      if (loadError) setError(loadError.message); else setDeliveries((data ?? []) as unknown as Delivery[]);
      setLoading(false);
    }
    void load();
  }, []);

  return <section className="panel recent-deliveries-card"><div className="panel-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas entregas</h2><p>Entregas realizadas recentemente para os colaboradores.</p></div><ClipboardList size={21} /></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando histórico...</div> : error ? <div className="feedback error-feedback">Não foi possível carregar o histórico.</div> : deliveries.length ? <div className="recent-delivery-list">{deliveries.map((delivery) => <article className="recent-delivery-item" key={delivery.id}><div className="recent-delivery-icon"><UserRound size={17} /></div><div className="recent-delivery-main"><strong>{delivery.employee?.full_name || "Funcionário não informado"}</strong><small>{delivery.employee?.registration ? `Matrícula ${delivery.employee.registration} · ` : ""}{date(delivery.delivered_at)} · {reasons[delivery.reason] || delivery.reason}</small><div className="recent-delivery-materials">{delivery.delivery_items.map((item, index) => <span key={`${delivery.id}-${index}`}>{item.quantity}x {item.material?.name || "Material"}</span>)}</div></div><CalendarClock size={17} className="recent-delivery-date" /></article>)}</div> : <div className="empty-state"><ClipboardList size={27} /><strong>Nenhuma entrega registrada</strong><span>As entregas confirmadas aparecerão aqui.</span></div>}</section>;
}
