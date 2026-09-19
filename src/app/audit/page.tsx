"use client";

import Link from "next/link";
import { ClipboardList, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, formatDateTimeBR } from "@/lib/ui-feedback";

type AuditData = { name?: string | null; internal_code?: string | null } | null;
type Audit = { id: string; action: string; table_name: string; record_id: string | null; created_at: string; actor_id: string | null; old_data: AuditData; new_data: AuditData };
type Actor = { id: string; full_name: string | null; email: string | null };
const actionLabels: Record<string, string> = { insert: "Criação", update: "Alteração", delete: "Exclusão" };
const tableLabels: Record<string, string> = { employees: "Funcionários", materials: "Materiais", deliveries: "Entregas", returns: "Devoluções", material_lots: "Lotes de estoque", stock_movements: "Movimentações", organizations: "Organizações", profiles: "Usuários" };

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function relatedHref(row: Audit) {
  const { table_name: table, record_id: id } = row;
  if (!id) return null;
  if (table === "employees") return `/employees/${id}`;
  if (table === "materials") {
    const material = row.new_data ?? row.old_data;
    const search = material?.internal_code || material?.name;
    return search ? `/materials?search=${encodeURIComponent(search)}` : "/materials";
  }
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
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);

  async function load() {
    mountedRef.current = true;
    const requestId = ++loadRequestRef.current;
    setLoading(true); setError("");
    setRows([]); setActors({});
    try {
      const supabase = createClient();
      const { data, error: loadError } = await supabase.from("audit_logs").select("id,action,table_name,record_id,created_at,actor_id,old_data,new_data").order("created_at", { ascending: false }).limit(500);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      if (loadError) {
        setRows([]); setActors({});
        setError(friendlyError(loadError, "Não foi possível carregar a auditoria."));
        return;
      }
      const auditRows = (data ?? []) as Audit[];
      setRows(auditRows);
      const actorIds = [...new Set(auditRows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
      if (actorIds.length) {
        const { data: actorData, error: actorError } = await supabase.from("profiles").select("id,full_name,email").in("id", actorIds);
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;
        if (actorError) {
          setActors({});
          setError(friendlyError(actorError, "Não foi possível carregar os usuários da auditoria."));
          return;
        }
        setActors(Object.fromEntries(((actorData ?? []) as Actor[]).map((actor) => [actor.id, actor])));
      }
    } catch (unexpectedError) {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setRows([]); setActors({});
        setError(friendlyError(unexpectedError, "Não foi possível carregar a auditoria."));
      }
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { mountedRef.current = false; };
  }, []);

  const modules = useMemo(() => [...new Set(rows.map((row) => row.table_name))].sort(), [rows]);
  const users = useMemo(() => [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))], [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const actor = row.actor_id ? actors[row.actor_id] : null;
    const text = `${actionLabels[row.action] ?? row.action} ${tableLabels[row.table_name] ?? row.table_name} ${row.record_id ?? ""} ${actor?.full_name ?? ""} ${actor?.email ?? ""}`.toLowerCase();
    const date = localDateKey(row.created_at);
    return text.includes(query.toLowerCase()) && (userFilter === "all" || row.actor_id === userFilter) && (moduleFilter === "all" || row.table_name === moduleFilter) && (actionFilter === "all" || row.action === actionFilter) && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
  }), [rows, actors, query, userFilter, moduleFilter, actionFilter, fromDate, toDate]);

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">SEGURANÇA E CONTROLE</p><h1>Auditoria</h1><p className="module-subtitle">Consulte quem alterou cada registro e quando a ação aconteceu.</p></div><button className="secondary-button" type="button" onClick={() => void load()} aria-label="Atualizar registros de auditoria"><span aria-hidden="true">↻</span> Atualizar</button></header><section className="module-toolbar audit-filters" aria-label="Filtros da auditoria"><div className="module-search"><Search size={17} aria-hidden="true" /><input id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuário, módulo ou registro" aria-label="Buscar na auditoria" /></div><label htmlFor="audit-user">Usuário<select id="audit-user" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} aria-label="Filtrar por usuário"><option value="all">Todos os usuários</option>{users.map((id) => <option key={id} value={id}>{actors[id]?.full_name || actors[id]?.email || `Usuário ${id.slice(0, 8)}`}</option>)}</select></label><label htmlFor="audit-module">Módulo<select id="audit-module" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} aria-label="Filtrar por módulo"><option value="all">Todos os módulos</option>{modules.map((module) => <option key={module} value={module}>{tableLabels[module] || module}</option>)}</select></label><label htmlFor="audit-action">Ação<select id="audit-action" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} aria-label="Filtrar por ação"><option value="all">Todas as ações</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor="audit-from">De<input id="audit-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label htmlFor="audit-to">Até<input id="audit-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></section><section className="panel module-table-card">{error && <div className="feedback error-feedback" role="alert"><X size={17} aria-hidden="true" /> {error}<button className="feedback-retry" type="button" onClick={() => void load()}>Tentar novamente</button></div>}{loading ? <div className="module-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando auditoria...</div> : <div className="table-wrap"><table aria-label="Registros de auditoria"><thead><tr><th scope="col">DATA</th><th scope="col">AÇÃO</th><th scope="col">MÓDULO</th><th scope="col">REGISTRO</th><th scope="col">USUÁRIO</th></tr></thead><tbody>{filtered.map((row) => { const actor = row.actor_id ? actors[row.actor_id] : null; const href = relatedHref(row); return <tr key={row.id}><td>{formatDateTimeBR(row.created_at)}</td><td><span className="movement-type">{actionLabels[row.action] || row.action}</span></td><td>{tableLabels[row.table_name] || row.table_name}</td><td title={row.record_id || undefined}>{href ? <Link className="text-link" href={href}>{row.record_id?.slice(0, 8)}... <ExternalLink size={13} aria-hidden="true" /></Link> : row.record_id || "—"}</td><td><strong>{actor?.full_name || "Sistema"}</strong><small>{actor?.email || (row.actor_id ? "Usuário identificado por ID" : "Ação automática")}</small></td></tr>; })}</tbody></table>{!filtered.length && <div className="empty-state" role="status" aria-live="polite"><ClipboardList size={27} aria-hidden="true" /><strong>Nenhum registro encontrado</strong><span>Ajuste os filtros ou aguarde novas alterações.</span></div>}</div>}</section></main>;
}
