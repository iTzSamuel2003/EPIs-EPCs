"use client";

import { ArrowDownToLine, ArrowUpRight, Boxes, CalendarClock, ClipboardCheck, ClipboardList, LayoutDashboard, PackageCheck, Settings, ShieldCheck, SlidersHorizontal, Users, X, Menu, ChevronDown, CircleHelp, Search, Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const menu = [
  ["Dashboard", LayoutDashboard, "/"], ["Materiais", Boxes, "/materials"], ["Funcionários", Users, "/employees"],
  ["Entregas", ArrowUpRight, "/deliveries"], ["Devoluções", ArrowDownToLine, "/returns"], ["Estoque", PackageCheck, "/stock"],
  ["Entradas", ClipboardList, "/entries"], ["Validades", CalendarClock, "/validities"], ["Ensaios", ClipboardCheck, "/tests"],
  ["CA", ShieldCheck, "/ca"], ["Relatórios", ClipboardList, "/reports"], ["Movimentações", SlidersHorizontal, "/movements"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileMenu, setMobileMenu] = useState(false);
  if (pathname === "/" || pathname === "/login" || pathname === "/reset-password") return <>{children}</>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div><button className="close-menu" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={20} /></button></div>
      <div className="workspace-label">MENU PRINCIPAL</div>
      <nav>{menu.map(([label, Icon, href]) => <Link className={pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) ? "active" : ""} href={href} key={label} onClick={() => setMobileMenu(false)}><Icon size={18} /><span>{label}</span>{label === "Validades" && <b className="nav-count">5</b>}</Link>)}</nav>
      <div className="sidebar-bottom"><Link href="/settings"><Settings size={18} /><span>Configurações</span></Link><Link href="/help"><CircleHelp size={18} /><span>Central de ajuda</span></Link><div className="user-mini"><div className="avatar avatar-dark">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} /></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><button className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Abrir menu"><Menu size={22} /></button><div className="breadcrumb"><span>Visão geral</span><span>/</span><strong>{pathname === "/" ? "Dashboard" : menu.find((item) => item[2] === pathname)?.[0] ?? "EPIS+"}</strong></div><div className="top-actions"><div className="search"><Search size={18} /><input placeholder="Buscar materiais, funcionários..." /></div><button className="icon-button notification" aria-label="Notificações"><Bell size={19} /><i /></button><div className="profile"><div className="avatar avatar-blue">SA</div><div><strong>Samuel Albuquerque</strong><small>Administrador</small></div><ChevronDown size={15} /></div></div></header>{children}</main>
  </div>;
}
