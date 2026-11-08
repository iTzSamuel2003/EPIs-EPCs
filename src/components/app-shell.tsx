"use client";

import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Bell, Boxes, Building2, CalendarClock, ChevronDown, CircleHelp, ClipboardCheck, ClipboardList, LayoutDashboard, LogOut, Menu, PackageCheck, Search, Settings, SlidersHorizontal, ShieldCheck, Stethoscope, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { rolePageDefaults } from "@/lib/access-control";

type MenuItem = readonly [string, typeof LayoutDashboard, string];
type MenuSection = { label: string; items: readonly MenuItem[] };
type ManagementContext = {
  management_session_id: string;
  organization_id: string;
  organization_name: string;
  organization_logo_url: string | null;
  expires_at: string;
};
type ManagementReadAudit = { sessionId: string; resource: string; status: "checking" | "ready" | "error"; message?: string };
const managementSessionChangeKey = "epis.management-session-change";
const testAccessEmailSuffix = "@test.epistemporario.invalid";
const sensitiveManagementRoutes = ["/employees", "/employee-history", "/attendance", "/asos", "/requests", "/returns", "/discounts", "/deliveries", "/training-compliance", "/compliance"];

function getSensitiveManagementRoute(pathname: string) {
  return sensitiveManagementRoutes.find((route) => pathname === route || pathname.startsWith(`${route}/`)) ?? null;
}

const menuSections: readonly MenuSection[] = [
  { label: "Visão geral", items: [["Dashboard", LayoutDashboard, "/"]] },
  { label: "Cadastros", items: [["Bases", Building2, "/bases"], ["Materiais", Boxes, "/materials"], ["Funcionários", Users, "/employees"], ["Equipes", Users, "/teams"], ["Unidades físicas", Boxes, "/units"], ["Variações", Boxes, "/variants"], ["Listas por função", ClipboardList, "/function-templates"]] },
  { label: "Operações", items: [["Entradas", ClipboardList, "/entries"], ["Entregas", ArrowUpRight, "/deliveries"], ["Devoluções", ArrowDownToLine, "/returns"], ["Transferências", ArrowLeftRight, "/transfers"], ["Descontos", Wallet, "/discounts"], ["Solicitações", ClipboardList, "/requests"], ["Estoque", PackageCheck, "/stock"], ["Validades", CalendarClock, "/validities"]] },
  { label: "Recursos Humanos", items: [["Assiduidade", CalendarClock, "/attendance"], ["Histórico de colaboradores", Users, "/employee-history"], ["ASOs", Stethoscope, "/asos"]] },
  { label: "Conformidade", items: [["Consulta CA", ClipboardCheck, "/ca"], ["Requisitos contratuais", ClipboardCheck, "/contract-requirements"], ["Ensaios", ClipboardCheck, "/tests"], ["Treinamentos", ClipboardCheck, "/training-compliance"], ["Conformidade", ClipboardCheck, "/compliance"]] },
  { label: "Gestão e análises", items: [["Custos", Wallet, "/costs"], ["Relatórios", ClipboardList, "/reports"], ["Movimentações", SlidersHorizontal, "/movements"], ["Auditoria", ClipboardList, "/audit"]] },
] as const;
const allMenuSections: readonly MenuSection[] = [...menuSections, { label: "Plataforma", items: [["Organizações", Building2, "/settings/organizations"]] }];
const menu = allMenuSections.flatMap((section) => section.items);
type SearchResult = { id: string; label: string; detail: string | null; href: string; kind: "Material" | "Funcionário" };
type CurrentUser = { name: string; role: string; isPlatformAdmin: boolean; platformOnly: boolean; isTestAccess: boolean };

const CurrentUserContext = createContext<CurrentUser>({ name: "Usuário", role: "user", isPlatformAdmin: false, platformOnly: false, isTestAccess: false });
const roleLabels: Record<string, string> = { admin: "Administrador", rh: "RH", tst: "TST", user: "Usuário", platform_admin: "Administrador da plataforma" };

export function useCurrentUser() {
  return useContext(CurrentUserContext);
}

function getInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR") || "U";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [currentUserName, setCurrentUserName] = useState("Usuário");
  const [currentUserRole, setCurrentUserRole] = useState("user");
  const pathname = usePathname(); const router = useRouter(); const [mobileMenu, setMobileMenu] = useState(false); const [query, setQuery] = useState(""); const [results, setResults] = useState<SearchResult[]>([]); const [searchError, setSearchError] = useState<string | null>(null); const [sessionError, setSessionError] = useState<string | null>(null); const [selectedSearchIndex, setSelectedSearchIndex] = useState(-1); const [validityCount, setValidityCount] = useState(0); const [allowedPaths, setAllowedPaths] = useState<string[] | null>(null); const [organizationLogo, setOrganizationLogo] = useState(""); const [signingOut, setSigningOut] = useState(false); const menuToggleRef = useRef<HTMLButtonElement>(null); const closeMenuRef = useRef<HTMLButtonElement>(null); const menuWasOpen = useRef(false); const searchRequestRef = useRef(0);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationAccess, setOrganizationAccess] = useState<"checking" | "ready" | "missing" | "blocked" | "error">("checking");
  const [blockedLifecycleStatus, setBlockedLifecycleStatus] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isTestAccess, setIsTestAccess] = useState(false);
  const [platformOnly, setPlatformOnly] = useState(false);
  const [organizationAccessError, setOrganizationAccessError] = useState("");
  const [managementContext, setManagementContext] = useState<ManagementContext | null>(null);
  const [managementReadAudit, setManagementReadAudit] = useState<ManagementReadAudit | null>(null);
  const managementSessionId = managementContext?.management_session_id ?? null;
  const [managementExiting, setManagementExiting] = useState(false);
  const managementAuditRoute = managementContext ? getSensitiveManagementRoute(pathname) : null;
  const publicRoute = pathname === "/login" || pathname === "/reset-password" || pathname === "/no-access" || pathname === "/organization-pending" || pathname.startsWith("/medidas/") || pathname.startsWith("/assinar/") || pathname === "/portal" || pathname.startsWith("/invite/");
  useEffect(() => {
    if (!mobileMenu) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const sidebar = document.querySelector(".sidebar");
      if (sidebar && !sidebar.contains(event.target as Node)) setMobileMenu(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMobileMenu(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenu]);
  useEffect(() => {
    setMobileMenu(false);
  }, [pathname]);
  useEffect(() => {
    if (publicRoute || !allowedPaths || pathname === "/login" || organizationAccess === "blocked") return;
    const protectedPath = pathname === "/portal-qr" ? "/settings" : pathname;
    const permitted = allowedPaths.some((path) => protectedPath === path || (path !== "/" && protectedPath.startsWith(`${path}/`)));
    if (!permitted) router.replace(allowedPaths[0] ?? "/no-access");
  }, [allowedPaths, organizationAccess, pathname, publicRoute, router]);
  useEffect(() => {
    if (publicRoute) return;
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => subscription.unsubscribe();
  }, [publicRoute, router]);
  useEffect(() => {
    if (publicRoute) return;
    let cancelled = false;
    setOrganizationAccess("checking");
    setOrganizationAccessError("");
    setBlockedLifecycleStatus(null);
    setOrganizationLogo("");
    setOrganizationName("");
    setIsPlatformAdmin(false);
    setIsTestAccess(false);
    setPlatformOnly(false);
    setAllowedPaths(null);
    setManagementContext(null);
    setManagementReadAudit(null);
    void createClient().auth.getUser().then(async ({ data, error: authError }) => {
      if (cancelled) return;
      if (authError || !data.user) {
        router.replace("/login");
        return;
      }
      setIsTestAccess(data.user.email?.toLowerCase().endsWith(testAccessEmailSuffix) ?? false);
      const supabase = createClient();
      const { data: managementRows, error: managementError } = await supabase.rpc("get_platform_organization_management_context");
      if (cancelled) return;
      if (managementError) {
        setOrganizationAccessError("Não foi possível verificar o modo de gestão da organização. Atualize a página ou tente novamente.");
        setOrganizationAccess("error");
        return;
      }
      const management = Array.isArray(managementRows) ? managementRows[0] as ManagementContext | undefined : undefined;
      if (management?.management_session_id && management.organization_id) {
        const metadata = data.user.user_metadata as Record<string, unknown> | undefined;
        const platformName = [metadata?.full_name, metadata?.name, data.user.email?.split("@")[0]].find((value) => typeof value === "string" && value.trim()) as string | undefined;
        setManagementContext(management);
        setCurrentUserName(platformName?.trim() || "Administrador da plataforma");
        setCurrentUserRole("admin");
        setIsPlatformAdmin(false);
        setPlatformOnly(false);
        setOrganizationName(management.organization_name?.trim() || "Organização");
        setOrganizationLogo(management.organization_logo_url || "");
        setAllowedPaths(rolePageDefaults.admin.filter((path) => path !== "/settings/organizations"));
        setOrganizationAccess("ready");
        return;
      }
      const { data: platformAdmin, error: platformAdminError } = await supabase.rpc("current_user_is_platform_admin");
      if (cancelled) return;
      if (platformAdminError) {
        setOrganizationAccessError("Não foi possível verificar as permissões da conta. Atualize a página ou tente novamente.");
        setOrganizationAccess("error");
        return;
      }
      setIsPlatformAdmin(platformAdmin === true);
      const { data: profile, error: profileError } = await supabase.from("profiles").select("full_name,role,organization_id").eq("id", data.user.id).maybeSingle();
      if (cancelled) return;
      if (profileError) {
        setOrganizationAccessError("Não foi possível verificar o vínculo desta conta. Atualize a página ou tente novamente.");
        setOrganizationAccess("error");
        return;
      }
      if (!profile?.organization_id) {
        const metadata = data.user.user_metadata as Record<string, unknown> | undefined;
        const platformName = [profile?.full_name, metadata?.full_name, metadata?.name, data.user.email?.split("@")[0]].find((value) => typeof value === "string" && value.trim()) as string | undefined;
        setCurrentUserName(platformName?.trim() || "Usuário");
        if (platformAdmin === true) {
          setCurrentUserRole("platform_admin");
          setPlatformOnly(true);
          setOrganizationName("Administração da plataforma");
          setAllowedPaths(["/settings/organizations"]);
          setOrganizationAccess("ready");
        } else {
          setAllowedPaths([]);
          setOrganizationAccess("missing");
          router.replace("/organization-pending");
        }
        return;
      }
      const { data: lifecycleRows, error: lifecycleError } = await supabase.rpc("get_my_organization_lifecycle_status");
      if (cancelled) return;
      const lifecycle = Array.isArray(lifecycleRows) ? lifecycleRows[0] : null;
      if (lifecycleError || !lifecycle?.lifecycle_status) {
        setOrganizationAccessError("Não foi possível verificar se a organização está liberada para acesso. Tente novamente.");
        setOrganizationAccess("error");
        return;
      }
      setOrganizationName(lifecycle.organization_name?.trim() || "Organização");
      if (lifecycle.lifecycle_status !== "active") {
        if (platformAdmin === true) {
          setCurrentUserName(profile.full_name?.trim() || data.user.email?.split("@")[0] || "Usuário");
          setCurrentUserRole("platform_admin");
          setPlatformOnly(true);
          setOrganizationName("Administração da plataforma");
          setAllowedPaths(["/settings/organizations"]);
          setOrganizationAccess("ready");
          return;
        }
        setBlockedLifecycleStatus(lifecycle.lifecycle_status);
        setAllowedPaths([]);
        setOrganizationAccess("blocked");
        return;
      }
      const role = profile.role || "user";
      setCurrentUserName(profile.full_name?.trim() || data.user.email?.split("@")[0] || "Usuário");
      setCurrentUserRole(role);
      const [{ data: override }, { data: roleAccess }] = role !== "admin" ? await Promise.all([
        supabase.from("profile_access_overrides").select("page_paths").eq("profile_id", data.user.id).eq("organization_id", profile.organization_id).maybeSingle(),
        supabase.from("organization_role_access").select("page_paths").eq("organization_id", profile.organization_id).eq("role", role).maybeSingle(),
      ]) : [{ data: null }, { data: null }];
      if (cancelled) return;
      const paths = role === "admin" ? rolePageDefaults.admin : override ? override.page_paths : roleAccess?.page_paths ?? rolePageDefaults[role] ?? rolePageDefaults.user;
      setPlatformOnly(false);
      setAllowedPaths(platformAdmin === true ? [...new Set([...paths, "/settings/organizations"])] : paths);
      const { data: organization } = await supabase.from("organizations").select("name,logo_url").eq("id", profile.organization_id).maybeSingle();
      if (!cancelled) {
        setOrganizationLogo(organization?.logo_url || "");
        setOrganizationName(organization?.name?.trim() || "");
        setOrganizationAccess("ready");
      }
    }).catch(() => {
      if (cancelled) return;
      setOrganizationAccessError("Não foi possível carregar os dados de acesso. Atualize a página para tentar novamente.");
      setOrganizationAccess("error");
    });
    return () => { cancelled = true; };
  }, [publicRoute, router]);
  useEffect(() => {
    if (!managementSessionId) return;
    let cancelled = false;
    const supabase = createClient();
    async function validateManagementContext() {
      const { data, error } = await supabase.rpc("get_platform_organization_management_context");
      if (cancelled) return;
      const context = Array.isArray(data) ? data[0] as ManagementContext | undefined : undefined;
      if (error || !context?.management_session_id) {
        setManagementContext(null);
        setOrganizationAccess("checking");
        window.location.replace(new URL("/settings/organizations", window.location.origin).href);
        return;
      }
      setManagementContext(context);
      setOrganizationName(context.organization_name?.trim() || "Organização");
      setOrganizationLogo(context.organization_logo_url || "");
    }
    const interval = window.setInterval(() => void validateManagementContext(), 30_000);
    window.addEventListener("focus", validateManagementContext);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", validateManagementContext);
    };
  }, [managementSessionId]);
  useEffect(() => {
    if (!managementSessionId || !managementAuditRoute) return;
    let cancelled = false;
    const sessionId = managementSessionId;
    setManagementReadAudit({ sessionId, resource: managementAuditRoute, status: "checking" });
    void createClient().rpc("audit_sensitive_management_read", { p_resource_name: managementAuditRoute }).then(({ error }) => {
      if (cancelled) return;
      setManagementReadAudit({
        sessionId,
        resource: managementAuditRoute,
        status: error ? "error" : "ready",
        message: error ? "Não foi possível registrar o acesso a esta área. O conteúdo foi bloqueado; tente novamente." : undefined,
      });
    });
    return () => { cancelled = true; };
  }, [managementSessionId, managementAuditRoute]);
  useEffect(() => {
    function reloadOnManagementChange(event: StorageEvent) {
      if (event.key === managementSessionChangeKey) window.location.reload();
    }
    window.addEventListener("storage", reloadOnManagementChange);
    return () => window.removeEventListener("storage", reloadOnManagementChange);
  }, []);
  useEffect(() => {
    let frame: number | undefined;
    if (mobileMenu) {
      menuWasOpen.current = true;
      frame = requestAnimationFrame(() => closeMenuRef.current?.focus());
    } else if (menuWasOpen.current) {
      menuWasOpen.current = false;
      frame = requestAnimationFrame(() => menuToggleRef.current?.focus());
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [mobileMenu]);
  useEffect(() => {
    if (publicRoute) return;
    let cancelled = false;
    let loading = false;
    let refreshPending = false;
    let refreshTimer: number | undefined;
    const supabase = createClient();
    async function loadValidityCount() {
      if (cancelled) return;
      if (loading) {
        refreshPending = true;
        return;
      }
      loading = true;
      try {
        const { data, error } = await supabase.rpc("get_validity_alert_count");
        if (!cancelled) setValidityCount(error ? 0 : Number(data ?? 0));
      } finally {
        loading = false;
        if (!cancelled && refreshPending) {
          refreshPending = false;
          void loadValidityCount();
        }
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
  useEffect(() => {
    if (publicRoute) return;
    let cancelled = false;
    const requestId = ++searchRequestRef.current;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearchError(null);
      setSelectedSearchIndex(-1);
      return;
    }
    setResults([]);
    setSearchError(null);
    const timer = window.setTimeout(async () => {
      const supabase = createClient();
      const safeTerm = term.replaceAll("%", "\\%").replaceAll("_", "\\_").replaceAll(",", " ").replaceAll("(", " ").replaceAll(")", " ");
      const pattern = `%${safeTerm}%`;
      try {
        const [materialResponse, employeeResponse] = await Promise.all([
          supabase.from("materials").select("id,name,internal_code").or(`name.ilike.${pattern},internal_code.ilike.${pattern}`).limit(5),
          supabase.from("employees").select("id,full_name,registration").or(`full_name.ilike.${pattern},registration.ilike.${pattern}`).limit(5),
        ]);
        if (cancelled || searchRequestRef.current !== requestId) return;
        const failedSources = [
          materialResponse.error ? "materiais" : null,
          employeeResponse.error ? "funcionários" : null,
        ].filter((source): source is string => source !== null);
        if (failedSources.length) {
          setResults([]);
          setSearchError(`Não foi possível buscar ${failedSources.join(" e ")}. Tente novamente.`);
          setSelectedSearchIndex(-1);
          return;
        }
        setSearchError(null);
        setResults([
          ...((materialResponse.data ?? []).map((item) => ({ id: item.id, label: item.name, detail: item.internal_code || "Código não informado", href: `/materials?search=${encodeURIComponent(item.name)}`, kind: "Material" as const }))),
          ...((employeeResponse.data ?? []).map((item) => ({ id: item.id, label: item.full_name, detail: item.registration, href: `/employees/${item.id}`, kind: "Funcionário" as const }))),
        ]);
        setSelectedSearchIndex(-1);
      } catch {
        if (cancelled || searchRequestRef.current !== requestId) return;
        setResults([]);
        setSearchError("Não foi possível realizar a busca. Tente novamente.");
        setSelectedSearchIndex(-1);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [publicRoute, query]);
  if (publicRoute) return <>{children}</>;
  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSessionError(null);
    try {
      const supabase = createClient();
      if (managementContext) {
        const { error: managementError } = await supabase.rpc("end_platform_organization_management_session");
        if (managementError) {
          setSessionError("Não foi possível registrar o encerramento da gestão. Tente novamente.");
          setSigningOut(false);
          return;
        }
        window.localStorage.setItem(managementSessionChangeKey, String(Date.now()));
      }
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSessionError("Não foi possível encerrar a sessão. Tente novamente.");
        setSigningOut(false);
        return;
      }
      router.replace("/login");
    } catch {
      setSessionError("Não foi possível encerrar a sessão. Tente novamente.");
      setSigningOut(false);
    }
  }
  async function handleExitManagement() {
    if (!managementContext || managementExiting) return;
    setManagementExiting(true);
    setSessionError(null);
    try {
      const { error } = await createClient().rpc("end_platform_organization_management_session");
      if (error) {
        setSessionError("Não foi possível encerrar o modo de gestão. Tente novamente.");
        setManagementExiting(false);
        return;
      }
      window.localStorage.setItem(managementSessionChangeKey, String(Date.now()));
      window.location.assign(new URL("/settings/organizations", window.location.origin).href);
    } catch {
      setSessionError("Não foi possível encerrar o modo de gestão. Tente novamente.");
      setManagementExiting(false);
    }
  }
  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLElement>) { if (event.key !== "Tab" || !mobileMenu) return; const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).filter((element) => element.offsetParent !== null); if (!focusable.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  function closeSearch() { setQuery(""); setResults([]); setSelectedSearchIndex(-1); } function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) { if (event.key === "Escape") { closeSearch(); return; } if (!results.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setSelectedSearchIndex((current) => (current + 1) % results.length); } else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedSearchIndex((current) => (current - 1 + results.length) % results.length); } else if (event.key === "Enter" && selectedSearchIndex >= 0) { event.preventDefault(); router.push(results[selectedSearchIndex].href); closeSearch(); } }
  const userInitials = getInitials(currentUserName);
  const displayedUserName = isTestAccess ? "Acesso de teste" : currentUserName;
  const userRoleLabel = isPlatformAdmin ? roleLabels.platform_admin : roleLabels[currentUserRole] ?? "Usuário";
  const managementAuditReady = !managementAuditRoute || (
    managementReadAudit?.sessionId === managementContext?.management_session_id
    && managementReadAudit?.resource === managementAuditRoute
    && managementReadAudit?.status === "ready"
  );

  if (organizationAccess === "blocked") {
    const isSuspended = blockedLifecycleStatus === "suspended";
    const title = isSuspended ? "Organização suspensa" : "Organização em preparação";
    const description = isSuspended
      ? "O acesso aos dados e módulos está temporariamente suspenso. Entre em contato com o administrador da plataforma."
      : "O acesso aos módulos será liberado quando o primeiro administrador aceitar o convite.";
    return <main className="login-shell"><section className="login-card" aria-live="polite"><p className="eyebrow">ACESSO À ORGANIZAÇÃO</p><h1>{title}</h1><p className="login-subtitle">{organizationName ? `${organizationName}: ` : ""}{description}</p><button className="secondary-button login-button" type="button" onClick={() => void handleSignOut()} disabled={signingOut}>{signingOut ? "Saindo..." : "Sair da conta"}</button></section></main>;
  }

  if (organizationAccess !== "ready") {
    return <main className="login-shell"><section className="login-card" aria-live="polite"><p className="eyebrow">ACESSO À ORGANIZAÇÃO</p><h1>{organizationAccess === "error" ? "Não foi possível validar seu acesso" : "Preparando seu acesso"}</h1><p className="login-subtitle">{organizationAccessError || "Estamos verificando o vínculo da sua conta com uma organização."}</p>{organizationAccess === "error" && <button className="primary-button login-button" type="button" onClick={() => window.location.reload()}>Tentar novamente</button>}</section></main>;
  }

  return (
    <CurrentUserContext.Provider value={{ name: currentUserName, role: currentUserRole, isPlatformAdmin, platformOnly, isTestAccess }}>
      <div className="app-shell">
        {mobileMenu && <button type="button" className="sidebar-backdrop" onClick={() => setMobileMenu(false)} aria-label="Fechar menu" />}
        <aside id="main-navigation" className={`sidebar ${mobileMenu ? "open" : ""}`} aria-label="Navegação principal" onKeyDown={handleMenuKeyDown}>
          <div className={`brand ${organizationLogo ? "brand-with-custom-logo" : ""}`}>
            <div className={`brand-mark ${organizationLogo ? "brand-mark-custom" : ""}`}>{organizationLogo ? <img src={organizationLogo} alt={organizationName ? `Logo ${organizationName}` : "Logo da organização"} /> : <ShieldCheck size={22} />}</div>
            <div className="brand-copy"><strong className="brand-title" title={organizationName || "EPIS+"}>{organizationName || <>EPIS<span>+</span></>}</strong><small>Gestão inteligente</small></div>
            <button ref={closeMenuRef} className="close-menu" type="button" onClick={() => setMobileMenu(false)} aria-label="Fechar menu"><X size={20} /></button>
          </div>
          <div className="workspace-label">MENU PRINCIPAL</div>
          <div className="sidebar-sections">
            {allMenuSections.map((section) => {
              const visibleItems = section.items.filter(([, , href]) => !allowedPaths || allowedPaths.includes(href));
              return visibleItems.length ? (
                <section className="sidebar-section" key={section.label}>
                  <h2>{section.label}</h2>
                  <nav aria-label={section.label}>
                    {visibleItems.map(([label, Icon, href]) => {
                      const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
                      return <Link className={active ? "active" : ""} href={href} key={label} onClick={() => setMobileMenu(false)} aria-current={active ? "page" : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span>{label === "Validades" && validityCount > 0 && <b className="nav-count" aria-label={`${validityCount} alertas`}>{validityCount}</b>}</Link>;
                    })}
                  </nav>
                </section>
              ) : null;
            })}
          </div>
          <div className="sidebar-bottom">
            {(!allowedPaths || allowedPaths.includes("/settings")) && <Link href="/settings"><Settings size={18} aria-hidden="true" /><span>Configurações</span></Link>}
            {(!allowedPaths || allowedPaths.includes("/help")) && <Link href="/help"><CircleHelp size={18} aria-hidden="true" /><span>Central de ajuda</span></Link>}
            {sessionError && <span className="login-error" role="alert">{sessionError}</span>}
            <div className="user-mini">
              <div className="avatar avatar-dark">{userInitials}</div>
              <div><strong title={displayedUserName}>{displayedUserName}</strong><small>{userRoleLabel}</small></div>
              <button type="button" className="icon-button" onClick={handleSignOut} aria-label="Sair da conta" title="Sair" disabled={signingOut} aria-busy={signingOut}><LogOut size={16} aria-hidden="true" /></button>
              <ChevronDown size={15} aria-hidden="true" />
            </div>
          </div>
        </aside>
        <main className="main-content">
          {managementContext && <div className="platform-management-banner" role="status">
            <div className="platform-management-copy"><ShieldCheck size={19} aria-hidden="true" /><div><strong>Modo de gestão da plataforma</strong><span>Organização: {managementContext.organization_name}. Acesso temporário até {new Date(managementContext.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</span></div></div>
            <button className="secondary-button" type="button" onClick={() => void handleExitManagement()} disabled={managementExiting} aria-busy={managementExiting}>{managementExiting ? "Encerrando..." : "Sair da gestão"}</button>
          </div>}
          <header className="topbar">
            <button ref={menuToggleRef} type="button" className="menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Abrir menu" aria-controls="main-navigation" aria-expanded={mobileMenu}><Menu size={22} aria-hidden="true" /></button>
            <div className="breadcrumb"><span>Visão geral</span><span>/</span><strong>{pathname === "/" ? "Dashboard" : menu.find((item) => item[2] === pathname || (item[2] !== "/" && pathname.startsWith(`${item[2]}/`)))?.[0] ?? "EPIS+"}</strong></div>
            <div className="top-actions">
              <div className="global-search">
                <div className="search"><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Buscar materiais, funcionários..." aria-label="Buscar materiais ou funcionários" aria-controls="global-search-results" aria-expanded={query.trim().length >= 2} aria-haspopup="listbox" role="combobox" aria-autocomplete="list" aria-activedescendant={selectedSearchIndex >= 0 ? `search-result-${results[selectedSearchIndex]?.id}` : undefined} /></div>
                {query.trim().length >= 2 && <div className="search-results" id="global-search-results" role="listbox" aria-label="Sugestões de busca">{searchError ? <span className="search-empty" role="alert">{searchError}</span> : results.length ? results.map((item, index) => <Link id={`search-result-${item.id}`} href={item.href} key={`${item.kind}-${item.id}`} className={selectedSearchIndex === index ? "search-result-active" : ""} onMouseEnter={() => setSelectedSearchIndex(index)} onClick={closeSearch} role="option" aria-selected={selectedSearchIndex === index}><strong>{item.label}</strong><span>{item.kind} · {item.detail || "Sem detalhe"}</span></Link>) : <span className="search-empty" role="status">Nenhum resultado encontrado.</span>}</div>}
              </div>
              <Link className="icon-button notification" href="/validities" aria-label="Ver alertas de validade"><Bell size={19} aria-hidden="true" /><i /></Link>
              <div className="profile">
                <div className="avatar avatar-blue">{userInitials}</div>
                <div><strong title={displayedUserName}>{displayedUserName}</strong><small>{userRoleLabel}</small></div>
                <ChevronDown size={15} aria-hidden="true" />
              </div>
            </div>
          </header>
          {!managementAuditReady ? <section className="module-shell management-audit-gate" aria-live="polite">
            <div className="panel"><h1>{managementReadAudit?.status === "error" ? "Acesso temporariamente bloqueado" : "Validando acesso"}</h1><p>{managementReadAudit?.message || "Registrando o acesso protegido antes de carregar os dados desta área..."}</p>{managementReadAudit?.status === "error" && <button className="secondary-button" type="button" onClick={() => window.location.reload()}>Tentar novamente</button>}</div>
          </section> : children}
        </main>
      </div>
    </CurrentUserContext.Provider>
  );
}
