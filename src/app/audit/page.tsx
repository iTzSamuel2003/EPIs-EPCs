"use client";

import Link from "next/link";
import { ClipboardList, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, formatDateTimeBR } from "@/lib/ui-feedback";

type Audit = { id: string; action: string; table_name: string; record_id: string | null; created_at: string; actor_id: string | null };
type Actor = { id: string; full_name: string | null; email: string | null };
const actionLabels: Record<string, string> = { insert: "Criação", update: "Alteração", delete: "Exclusão" };
const tableLabels: Record<string, string> = { employees: "Funcionários", materials: "Materiais", deliveries: "Entregas", returns: "Devoluções", material_lots: "Lotes de estoque", stock_movements: "Movimentações", organizations: "Organizações", profiles: "Usuários" };

function relatedHref(table: string, id: string | null) {
  if (!id) return null;
  if (table === "employees") return `/employees/${id}`;
  if (table === "materials") return `/materials?search=${encodeURIComponent(id)}`;
  return null;
}

export default function AuditPage() {
  const [rows, setRows] = useState<Audit[]>([]);
  const [actors, setActors] = useState<Record<string, Actor>>({});
  const [query, setQuery] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    setRows([]); setActors({});
    const supabase = createClient();
    const { data, error: loadError } = await supabase.from("audit_logs").select("id,action,table_name,record_id,created_at,actor_id").order("created_at", { ascending: false }).limit(500);
    if (loadError) { setError(friendlyError(loadError, "Não foi possível carregar a auditoria.")); setLoading(false); return; }
    const auditRows = (data ?? []) as Audit[]; setRows(auditRows);
    const actorIds = [...new Set(auditRows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
    if (actorIds.length) {
      const { data: actorData } = await supabase.from("profiles").select("id,full_name,email").in("id", actorIds);
      setActors(Object.fromEntries(((actorData ?? []) as Actor[]).map((actor) => [actor.id, actor])));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const modules = useMemo(() => [...new Set(rows.map((row) => row.table_name))].sort(), [rows]);
  const users = useMemo(() => [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))], [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const actor = row.actor_id ? actors[row.actor_id] : null;
    const text = `${actionLabels[row.action] ?? row.action} ${tableLabels[row.table_name] ?? row.table_name} ${row.record_id ?? ""} ${actor?.full_name ?? ""} ${actor?.email ?? ""}`.toLowerCase();
    const date = row.created_at.slice(0, 10);
    return text.includes(query.toLowerCase()) && (userFilter === "all" || row.actor_id === userFilter) && (moduleFilter === "all" || row.table_name === moduleFilter) && (actionFilter === "all" || row.action === actionFilter) && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
  }), [rows, actors, query, userFilter, moduleFilter, actionFilter, fromDate, toDate]);

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">SEGURANÇA E CONTROLE</p><h1>Auditoria</h1><p className="module-subtitle">Consulte quem alterou cada registro e quando a ação aconteceu.</p></div><button className="secondary-button" type="button" onClick={() => void load()}>Atualizar</button></header><section className="module-toolbar audit-filters"><div className="module-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuário, módulo ou registro" aria-label="Buscar na auditoria" /></div><select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} aria-label="Filtrar por usuário"><option value="all">Todos os usuários</option>{users.map((id) => <option key={id} value={id}>{actors[id]?.full_name || actors[id]?.email || id}</option>)}</select><select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} aria-label="Filtrar por módulo"><option value="all">Todos os módulos</option>{modules.map((module) => <option key={module} value={module}>{tableLabels[module] || module}</option>)}</select><select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} aria-label="Filtrar por ação"><option value="all">Todas as ações</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label>De<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>Até<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></section><section className="panel module-table-card">{error && <div className="feedback error-feedback"><X size={17} /> {error}<button className="feedback-retry" type="button" onClick={() => void load()}>Tentar novamente</button></div>}{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando auditoria...</div> : <div className="table-wrap"><table><thead><tr><th>DATA</th><th>AÇÃO</th><th>MÓDULO</th><th>REGISTRO</th><th>USUÁRIO</th></tr></thead><tbody>{filtered.map((row) => { const actor = row.actor_id ? actors[row.actor_id] : null; const href = relatedHref(row.table_name, row.record_id); return <tr key={row.id}><td>{formatDateTimeBR(row.created_at)}</td><td><span className="movement-type">{actionLabels[row.action] || row.action}</span></td><td>{tableLabels[row.table_name] || row.table_name}</td><td>{href ? <Link className="text-link" href={href}>{row.record_id?.slice(0, 8)}... <ExternalLink size={13} /></Link> : row.record_id || "—"}</td><td><strong>{actor?.full_name || "Sistema"}</strong><small>{actor?.email || (row.actor_id ? "Usuário identificado por ID" : "Ação automática")}</small></td></tr>; })}</tbody></table>{!filtered.length && <div className="empty-state"><ClipboardList size={27} /><strong>Nenhum registro encontrado</strong><span>Ajuste os filtros ou aguarde novas alterações.</span></div>}</div>}</section></main>;
}
