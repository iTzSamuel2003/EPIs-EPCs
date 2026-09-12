"use client";

import { ArrowDownToLine, ArrowUpRight, Bell, Boxes, CalendarClock, ChevronDown, CircleHelp, ClipboardCheck, ClipboardList, LayoutDashboard, Menu, PackageCheck, Search, Settings, SlidersHorizontal, ShieldCheck, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type MenuItem = readonly [string, typeof LayoutDashboard, string];
type MenuSection = { label: string; items: readonly MenuItem[] };
const menuSections: readonly MenuSection[] = [
  { label: "Visão geral", items: [["Dashboard", LayoutDashboard, "/"]] },
  { label: "Cadastros", items: [["Materiais", Boxes, "/materials"], ["Funcionários", Users, "/employees"], ["Equipes", Users, "/teams"], ["Unidades físicas", Boxes, "/units"], ["Variações", Boxes, "/variants"], ["Listas por função", ClipboardList, "/function-templates"]] },
  { label: "Operações", items: [["Entradas", ClipboardList, "/entries"], ["Entregas", ArrowUpRight, "/deliveries"], ["Devoluções", ArrowDownToLine, "/returns"], ["Solicitações", ClipboardList, "/requests"], ["Estoque", PackageCheck, "/stock"], ["Validades", CalendarClock, "/validities"]] },
  { label: "Conformidade", items: [["Requisitos contratuais", ClipboardCheck, "/contract-requirements"], ["Ensaios", ClipboardCheck, "/tests"], ["Treinamentos", ClipboardCheck, "/training-compliance"], ["Conformidade", ClipboardCheck, "/compliance"], ["CA", ShieldCheck, "/ca"]] },
  { label: "Gestão e análises", items: [["Custos", Wallet, "/costs"], ["Relatórios", ClipboardList, "/reports"], ["Movimentações", SlidersHorizontal, "/movements"], ["Auditoria", ClipboardList, "/audit"]] },
] as const;
const menu = menuSections.flatMap((section) => section.items);
type SearchResult = { id: string; label: string; detail: string | null; href: string; kind: "Material" | "Funcionario" };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const [mobileMenu, setMobileMenu] = useState(false); const [query, setQuery] = useState(""); const [results, setResults] = useState<SearchResult[]>([]); const [validityCount, setValidityCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function loadValidityCount() {
      const { data, error } = await supabase.rpc("get_validity_alert_count");
      if (cancelled) return;
      setValidityCount(error ? 0 : Number(data ?? 0));
    }
    void loadValidityCount();
    const refresh = () => void loadValidityCount();
    const channel = supabase.channel("validity-count").on("postgres_changes", { event: "*", schema: "public", table: "material_lots" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "delivery_items" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "return_items" }, refresh).subscribe();
    ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"].forEach((eventName) => window.addEventListener(eventName, refresh));
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"].forEach((eventName) => window.removeEventListener(eventName, refresh));
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => { let cancelled = false; const term = query.trim(); if (term.length < 2) { setResults([]); return; } const timer = window.setTimeout(async () => { const supabase = createClient(); const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`; const [{ data: materialData }, { data: employeeData }] = await Promise.all([supabase.from("materials").select("id,name,internal_code").or(`name.ilike.${pattern},internal_code.ilike.${pattern}`).limit(5), supabase.from("employees").select("id,full_name,registration").or(`full_name.ilike.${pattern},registration.ilike.${pattern}`).limit(5)]); if (cancelled) return; setResults([...((materialData ?? []).map((item) => ({ id: item.id, label: item.name, detail: item.internal_code || "Código não informado", href: "/materials", kind: "Material" as const }))), ...((employeeData ?? []).map((item) => ({ id: item.id, label: item.full_name, detail: item.registration, href: `/employees/${item.id}`, kind: "Funcionario" as const })))]); }, 220); return () => { cancelled = true; window.clearTimeout(timer); }; }, [query]);
  if (pathname === "/login" || pathname === "/reset-password" || pathname.startsWith("/medidas/") || pathname === "/portal") return <>{children}</>;
  function closeSearch() { setQuery(""); setResults([]); }
  return <div className="app-shell"><aside className={`sidebar ${mobileMenu ? "open" : ""}`}><div className="brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>EPIS<span>+</span></strong><small>Gestao inteligente</small></div><button className="close-menu" type="button" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={20} /></button></div><div className="workspace-label">MENU PRINCIPAL</div><div className="sidebar-sections">{menuSections.map((section) => <section className="sidebar-section" key={section.label}><h2>{section.label}</h2><nav>{section.items.map(([label, Icon, href]) => <Link className={pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) ? "active" : ""} href={href} key={label} onClick={() => setMobileMenu(false)}><Icon size={18} /><span>{label}</span>{label === "Validades" && validityCount > 0 && <b className="nav-count">{validityCount}</b>}</Link>)}</nav></section>)}</div><div className="sidebar-bottom"><Link href="/settings"><Settings size={18} /><span>Configuracoes</span></Link><Link href="/help"><CircleHelp size={18} /><span>Central de ajuda</span></Link><div className="user-mini"><div className="avatar avatar-dark">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} /></div></div></aside><main className="main-content"><header className="topbar"><button className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu size={22} /></button><div className="breadcrumb"><span>Visao geral</span><span>/</span><strong>{pathname === "/" ? "Dashboard" : menu.find((item) => item[2] === pathname)?.[0] ?? "EPIS+"}</strong></div><div className="top-actions"><div className="global-search"><div className="search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar materiais, funcionarios..." aria-label="Buscar materiais ou funcionarios" /></div>{query.trim().length >= 2 && <div className="search-results">{results.length ? results.map((item) => <Link href={item.href} key={`${item.kind}-${item.id}`} onClick={closeSearch}><strong>{item.label}</strong><span>{item.kind} · {item.detail || "Sem detalhe"}</span></Link>) : <span className="search-empty">Nenhum resultado encontrado.</span>}</div>}</div><Link className="icon-button notification" href="/validities" aria-label="Ver alertas de validade"><Bell size={19} /><i /></Link><div className="profile"><div className="avatar avatar-blue">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} /></div></div></header>{children}</main></div>;
}
