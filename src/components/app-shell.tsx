"use client";

import {
  ArrowDownToLine, ArrowUpRight, Bell, Boxes, CalendarClock, ChevronDown,
  CircleHelp, ClipboardCheck, ClipboardList, LayoutDashboard, Menu,
  PackageCheck, Search, Settings, ShieldCheck, SlidersHorizontal, Users,
  Wallet, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const menu = [
  ["Dashboard", LayoutDashboard, "/"], ["Materiais", Boxes, "/materials"],
  ["Variações", Boxes, "/variants"], ["Listas por função", ClipboardList, "/function-templates"],
  ["Funcionários", Users, "/employees"], ["Entregas", ArrowUpRight, "/deliveries"],
  ["Devoluções", ArrowDownToLine, "/returns"], ["Estoque", PackageCheck, "/stock"],
  ["Entradas", ClipboardList, "/entries"], ["Validades", CalendarClock, "/validities"],
  ["Ensaios", ClipboardCheck, "/tests"], ["Custos", Wallet, "/costs"], ["CA", ShieldCheck, "/ca"],
  ["Relatórios", ClipboardList, "/reports"], ["Movimentações", SlidersHorizontal, "/movements"],
  ["Auditoria", ClipboardList, "/audit"],
] as const;

type SearchResult = { id: string; label: string; detail: string; href: string; kind: "Material" | "Funcionário" };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); return; }
    const timer = window.setTimeout(async () => {
      const supabase = createClient();
      const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      const [{ data: materialData }, { data: employeeData }] = await Promise.all([
        supabase.from("materials").select("id,name,internal_code").or(`name.ilike.${pattern},internal_code.ilike.${pattern}`).limit(5),
        supabase.from("employees").select("id,full_name,registration").or(`full_name.ilike.${pattern},registration.ilike.${pattern}`).limit(5),
      ]);
      setResults([
        ...((materialData ?? []).map((item) => ({ id: item.id, label: item.name, detail: item.internal_code, href: "/materials", kind: "Material" as const }))),
        ...((employeeData ?? []).map((item) => ({ id: item.id, label: item.full_name, detail: item.registration || "Sem matrícula", href: `/employees/${item.id}`, kind: "Funcionário" as const }))),
      ]);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (pathname === "/login" || pathname === "/reset-password" || pathname.startsWith("/medidas/")) return <>{children}</>;
  function closeSearch() { setQuery(""); setResults([]); }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div><button className="close-menu" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={20} /></button></div>
      <div className="workspace-label">MENU PRINCIPAL</div>
      <nav>{menu.map(([label, Icon, href]) => <Link className={pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) ? "active" : ""} href={href} key={label} onClick={() => setMobileMenu(false)}><Icon size={18} /><span>{label}</span>{label === "Validades" && <b className="nav-count">5</b>}</Link>)}</nav>
      <div className="sidebar-bottom"><Link href="/settings"><Settings size={18} /><span>Configurações</span></Link><Link href="/help"><CircleHelp size={18} /><span>Central de ajuda</span></Link><div className="user-mini"><div className="avatar avatar-dark">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} /></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <button className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu size={22} /></button>
        <div className="breadcrumb"><span>Visão geral</span><span>/</span><strong>{pathname === "/" ? "Dashboard" : menu.find((item) => item[2] === pathname)?.[0] ?? "EPIS+"}</strong></div>
        <div className="top-actions">
          <div className="global-search"><div className="search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar materiais, funcionários..." aria-label="Buscar materiais ou funcionários" /></div>{query.trim().length >= 2 && <div className="search-results">{results.length ? results.map((item) => <Link href={item.href} key={`${item.kind}-${item.id}`} onClick={closeSearch}><strong>{item.label}</strong><span>{item.kind} · {item.detail}</span></Link>) : <span className="search-empty">Nenhum resultado encontrado.</span>}</div>}</div>
          <Link className="icon-button notification" href="/validities" aria-label="Ver alertas de validade"><Bell size={19} /><i /></Link>
          <div className="profile"><div className="avatar avatar-blue">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} /></div>
        </div>
      </header>
      {children}
    </main>
  </div>;
}
