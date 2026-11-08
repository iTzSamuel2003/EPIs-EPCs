"use client";

import { useEffect, useState } from "react";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function OrganizationPendingPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    void createClient().auth.getUser().then(({ data, error: userError }) => {
      if (cancelled) return;
      if (userError || !data.user) {
        window.location.replace("/login");
        return;
      }
      setEmail(data.user.email || "");
      setName(typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : "");
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError("Não foi possível validar sua sessão. Entre novamente.");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function acceptInvitation() {
    if (saving) return;
    if (!name.trim()) {
      setError("Informe seu nome completo para ativar o convite.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { error: acceptError } = await createClient().rpc("accept_my_pending_organization_invitation", { p_full_name: name.trim() });
      if (acceptError) {
        const message = acceptError.message.toLowerCase();
        if (message.includes("não há convite") || message.includes("no active invitation")) {
          setError("Não encontramos um convite ativo para o e-mail confirmado desta conta. Confirme se entrou com o endereço correto ou solicite um novo convite ao administrador.");
        } else if (message.includes("confirme o e-mail") || message.includes("confirm your email")) {
          setError("Confirme o e-mail da conta antes de ativar o acesso.");
        } else if (message.includes("mais de um convite") || message.includes("more than one")) {
          setError("Há mais de um convite ativo para este endereço. Abra o link específico enviado pelo administrador.");
        } else {
          setError(acceptError.message);
        }
        return;
      }
      setSuccess("Convite aceito. Atualizando seu acesso...");
      window.setTimeout(() => window.location.replace("/"), 500);
    } catch {
      setError("Não foi possível ativar o convite agora. Atualize a página e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    setSaving(true);
    setError("");
    try {
      const { error: signOutError } = await createClient().auth.signOut();
      if (signOutError) {
        setError("Não foi possível encerrar a sessão. Atualize a página e tente novamente.");
        return;
      }
      window.location.replace("/login");
    } catch {
      setError("Não foi possível encerrar a sessão. Atualize a página e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="login-shell"><div className="login-brand"><div className="brand-mark" aria-hidden="true"><ShieldCheck size={25} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div></div><section className="login-card" aria-labelledby="organization-pending-title"><p className="eyebrow">ATIVAÇÃO DA ORGANIZAÇÃO</p><h1 id="organization-pending-title">Vincule sua conta à organização</h1><p className="login-subtitle">Esta conta ainda não está vinculada a uma organização. Se você já recebeu um convite, aceite-o usando o e-mail confirmado abaixo. Sua função e permissões serão aplicadas conforme o convite.</p>{loading ? <p role="status">Verificando sua conta...</p> : <><label htmlFor="pending-email">Conta autenticada<input id="pending-email" type="email" value={email} readOnly /></label><label htmlFor="pending-name">Nome completo<input id="pending-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} autoComplete="name" /></label>{error && <p className="login-error" role="alert">{error}</p>}{success && <p className="login-success" role="status">{success}</p>}<button className="primary-button login-button" type="button" onClick={acceptInvitation} disabled={saving}>{saving ? "Verificando convite..." : "Localizar e aceitar meu convite"}<ArrowRight size={17} aria-hidden="true" /></button><button className="text-button" type="button" onClick={signOut} disabled={saving}><LogOut size={15} aria-hidden="true" /> Sair e entrar com outra conta</button></>}</section></main>;
}
