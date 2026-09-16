"use client";

import { ClipboardList, LoaderCircle, RotateCcw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ReturnRecord = {
  id: string;
  returned_at: string;
  reason: string;
  employee: { full_name: string; registration: string | null } | null;
  return_items: Array<{
    quantity: number;
    material: { name: string; unit: string } | null;
    delivery_item: { variant: { name: string; size: string | null } | null } | null;
  }>;
};

const reasons: Record<string, string> = { replacement: "Substituição", termination: "Desligamento", role_change: "Alteração de função", damaged: "Equipamento danificado", voluntary: "Devolução voluntária", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");

export function RecentReturns() {
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await createClient().from("returns").select("id,returned_at,reason,employee:employees(full_name,registration),return_items(quantity,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size)))").order("returned_at", { ascending: false }).order("created_at", { ascending: false }).limit(10);
      if (loadError) setError(loadError.message); else setReturns((data ?? []) as unknown as ReturnRecord[]);
      setLoading(false);
    }
    void load();
    const refresh = () => { setLoading(true); void load(); };
    window.addEventListener("return-created", refresh);
    return () => window.removeEventListener("return-created", refresh);
  }, []);

  return <section className="panel recent-deliveries-card recent-returns-card"><div className="panel-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas devoluções</h2><p>Devoluções registradas recentemente pelos colaboradores.</p></div><RotateCcw size={21} /></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando histórico...</div> : error ? <div className="feedback error-feedback">{error}</div> : returns.length ? <div className="recent-delivery-list">{returns.map((item) => <article className="recent-delivery-item" key={item.id}><div className="recent-delivery-icon recent-return-icon"><UserRound size={17} /></div><div className="recent-delivery-main"><strong>{item.employee?.full_name || "Funcionário não informado"}</strong><small>{item.employee?.registration ? `Matrícula ${item.employee.registration} · ` : ""}{date(item.returned_at)} · {reasons[item.reason] || item.reason}</small><div className="recent-delivery-materials">{item.return_items.map((returnItem, index) => { const variant = returnItem.delivery_item?.variant; return <span key={`${item.id}-${index}`}>{returnItem.quantity}x {returnItem.material?.name || "Material"}{variant ? ` · ${variant.size || variant.name}` : ""}</span>; })}</div></div><ClipboardList size={17} className="recent-delivery-date" /></article>)}</div> : <div className="empty-state"><ClipboardList size={27} /><strong>Nenhuma devolução registrada</strong><span>As devoluções confirmadas aparecerão aqui.</span></div>}</section>;
}
