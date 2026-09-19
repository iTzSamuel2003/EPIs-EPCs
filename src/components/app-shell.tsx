"use client";

import { ArrowDownToLine, ArrowUpRight, Bell, Boxes, CalendarClock, ChevronDown, CircleHelp, ClipboardCheck, ClipboardList, LayoutDashboard, Menu, PackageCheck, Search, Settings, SlidersHorizontal, ShieldCheck, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type MenuItem = readonly [string, typeof LayoutDashboard, string];
type MenuSection = { label: string; items: readonly MenuItem[] };
const menuSections: readonly MenuSection[] = [
  { label: "Visão geral", items: [["Dashboard", LayoutDashboard, "/"]] },
  { label: "Cadastros", items: [["Materiais", Boxes, "/materials"], ["Funcionários", Users, "/employees"], ["Equipes", Users, "/teams"], ["Unidades físicas", Boxes, "/units"], ["Variações", Boxes, "/variants"], ["Listas por função", ClipboardList, "/function-templates"]] },
  { label: "Operações", items: [["Entradas", ClipboardList, "/entries"], ["Entregas", ArrowUpRight, "/deliveries"], ["Devoluções", ArrowDownToLine, "/returns"], ["Solicitações", ClipboardList, "/requests"], ["Estoque", PackageCheck, "/stock"], ["Validades", CalendarClock, "/validities"]] },
  { label: "Conformidade", items: [["Requisitos contratuais", ClipboardCheck, "/contract-requirements"], ["Ensaios", ClipboardCheck, "/tests"], ["Treinamentos", ClipboardCheck, "/training-compliance"], ["Conformidade", ClipboardCheck, "/compliance"]] },
  { label: "Gestão e análises", items: [["Custos", Wallet, "/costs"], ["Relatórios", ClipboardList, "/reports"], ["Movimentações", SlidersHorizontal, "/movements"], ["Auditoria", ClipboardList, "/audit"]] },
] as const;
const menu = menuSections.flatMap((section) => section.items);
type SearchResult = { id: string; label: string; detail: string | null; href: string; kind: "Material" | "Funcionário" };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const [mobileMenu, setMobileMenu] = useState(false); const [query, setQuery] = useState(""); const [results, setResults] = useState<SearchResult[]>([]); const [selectedSearchIndex, setSelectedSearchIndex] = useState(-1); const [validityCount, setValidityCount] = useState(0);
  const publicRoute = pathname === "/login" || pathname === "/reset-password" || pathname.startsWith("/medidas/") || pathname === "/portal";
  useEffect(() => {
    if (!mobileMenu) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const sidebar = document.querySelector(".sidebar");
      if (sidebar && !sidebar.contains(event.target as Node)) setMobileMenu(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [mobileMenu]);
  useEffect(() => {
    if (!mobileMenu) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileMenu(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenu]);
  useEffect(() => {
    setMobileMenu(false);
  }, [pathname]);
  useEffect(() => {
    if (publicRoute) return;
    let cancelled = false;
    let loading = false;
    let refreshTimer: number | undefined;
    const supabase = createClient();
    async function loadValidityCount() {
      if (loading) return;
      loading = true;
      try {
        const { data, error } = await supabase.rpc("get_validity_alert_count");
        if (!cancelled) setValidityCount(error ? 0 : Number(data ?? 0));
      } finally {
        loading = false;
      }
    }
    void loadValidityCount();
    const refresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void loadValidityCount(), 250);
    };
    const channel = supabase.channel("validity-count").on("postgres_changes", { event: "*", schema: "public", table: "material_lots" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "delivery_items" }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "return_items" }, refresh).subscribe();
    ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"].forEach((eventName) => window.addEventListener(eventName, refresh));
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
      ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"].forEach((eventName) => window.removeEventListener(eventName, refresh));
      window.removeEventListener("focus", refresh);
    };
  }, [publicRoute]);
  useEffect(() => { if (publicRoute) return; let cancelled = false; const term = query.trim(); if (term.length < 2) { setResults([]); setSelectedSearchIndex(-1); return; } const timer = window.setTimeout(async () => { const supabase = createClient(); const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`; const [{ data: materialData }, { data: employeeData }] = await Promise.all([supabase.from("materials").select("id,name,internal_code").or(`name.ilike.${pattern},internal_code.ilike.${pattern}`).limit(5), supabase.from("employees").select("id,full_name,registration").or(`full_name.ilike.${pattern},registration.ilike.${pattern}`).limit(5)]); if (cancelled) return; setResults([...((materialData ?? []).map((item) => ({ id: item.id, label: item.name, detail: item.internal_code || "Código não informado", href: `/materials?search=${encodeURIComponent(item.name)}`, kind: "Material" as const }))), ...((employeeData ?? []).map((item) => ({ id: item.id, label: item.full_name, detail: item.registration, href: `/employees/${item.id}`, kind: "Funcionário" as const })))]); setSelectedSearchIndex(-1); }, 220); return () => { cancelled = true; window.clearTimeout(timer); }; }, [publicRoute, query]);
  if (publicRoute) return <>{children}</>;
  function closeSearch() { setQuery(""); setResults([]); setSelectedSearchIndex(-1); } function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) { if (event.key === "Escape") { closeSearch(); return; } if (!results.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setSelectedSearchIndex((current) => (current + 1) % results.length); } else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedSearchIndex((current) => (current - 1 + results.length) % results.length); } else if (event.key === "Enter" && selectedSearchIndex >= 0) { event.preventDefault(); router.push(results[selectedSearchIndex].href); closeSearch(); } }
 return <div className="app-shell"><aside id="main-navigation" className={`sidebar ${mobileMenu ? "open" : ""}`} aria-label="Navegação principal"><div className="brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div><button className="close-menu" type="button" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={20} /></button></div><div className="workspace-label">MENU PRINCIPAL</div><div className="sidebar-sections">{menuSections.map((section) => <section className="sidebar-section" key={section.label}><h2>{section.label}</h2><nav aria-label={section.label}>{section.items.map(([label, Icon, href]) => <Link className={pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) ? "active" : ""} href={href} key={label} onClick={() => setMobileMenu(false)}><Icon size={18} aria-hidden="true" /><span>{label}</span>{label === "Validades" && validityCount > 0 && <b className="nav-count" aria-label={`${validityCount} alertas`}>{validityCount}</b>}</Link>)}</nav></section>)}</div><div className="sidebar-bottom"><Link href="/settings"><Settings size={18} aria-hidden="true" /><span>Configurações</span></Link><Link href="/help"><CircleHelp size={18} aria-hidden="true" /><span>Central de ajuda</span></Link><div className="user-mini"><div className="avatar avatar-dark">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} aria-hidden="true" /></div></div></aside><main className="main-content"><header className="topbar"><button type="button" className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Abrir menu" aria-controls="main-navigation" aria-expanded={mobileMenu}><Menu size={22} aria-hidden="true" /></button><div className="breadcrumb"><span>Visão geral</span><span>/</span><strong>{pathname === "/" ? "Dashboard" : menu.find((item) => item[2] === pathname || (item[2] !== "/" && pathname.startsWith(`${item[2]}/`)))?.[0] ?? "EPIS+"}</strong></div><div className="top-actions"><div className="global-search"><div className="search"><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Buscar materiais, funcionários..." aria-label="Buscar materiais ou funcionários" aria-controls="global-search-results" aria-expanded={query.trim().length >= 2} role="combobox" aria-autocomplete="list" /></div>{query.trim().length >= 2 && <div className="search-results" id="global-search-results" role="listbox" aria-label="Sugestões de busca">{results.length ? results.map((item) => <Link href={item.href} key={`${item.kind}-${item.id}`} className={selectedSearchIndex === results.indexOf(item) ? "search-result-active" : ""} onMouseEnter={() => setSelectedSearchIndex(results.indexOf(item))} onClick={closeSearch} role="option" aria-selected={selectedSearchIndex === results.indexOf(item)}><strong>{item.label}</strong><span>{item.kind} · {item.detail || "Sem detalhe"}</span></Link>) : <span className="search-empty" role="status">Nenhum resultado encontrado.</span>}</div>}</div><Link className="icon-button notification" href="/validities" aria-label="Ver alertas de validade"><Bell size={19} aria-hidden="true" /><i /></Link><div className="profile"><div className="avatar avatar-blue">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} aria-hidden="true" /></div></div></header>{children}</main></div>;
}
