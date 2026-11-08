"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";

export default function LoginPage() {
  const router = useRouter(); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [resetLoading, setResetLoading] = useState(false); const [resetSent, setResetSent] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setError("");
    try {
      const identifier = email.trim();
      const isTestLogin = /^teste-[a-z0-9][a-z0-9-]{2,62}$/i.test(identifier);
      const authEmail = isTestLogin ? `${identifier.toLowerCase()}@test.epistemporario.invalid` : identifier;
      const { error: signInError } = await createClient().auth.signInWithPassword({ email: authEmail, password });
      if (signInError) setError("Usuário/e-mail ou senha inválidos."); else await router.push("/");
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível entrar agora. Tente novamente."));
    } finally {
      setLoading(false);
    }
  }
  async function requestReset() {
    if (loading || resetLoading) return;
    setError(""); setResetSent(false);
    const identifier = email.trim();
    if (/^teste-[a-z0-9][a-z0-9-]{2,62}$/i.test(identifier) || identifier.toLowerCase().endsWith("@test.epistemporario.invalid")) {
      setError("A senha temporária não é recuperada por e-mail. Peça à administração da plataforma para gerar outra.");
      return;
    }
    if (!identifier.includes("@")) { setError("Informe o e-mail cadastrado para receber o link."); return; }
    setResetLoading(true);
    try {
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(identifier, { redirectTo: `${window.location.origin}/reset-password` });
      if (resetError) setError(friendlyError(resetError, "Não foi possível concluir a operação.")); else setResetSent(true);
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível concluir a operação."));
    } finally {
      setResetLoading(false);
    }
  }
  return <main className="login-shell"><div className="login-brand"><div className="brand-mark" aria-hidden="true"><ShieldCheck size={25} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div></div><section className="login-card" aria-labelledby="login-title"><p className="eyebrow">ACESSO RESTRITO</p><h1 id="login-title">Bem-vindo de volta</h1><p className="login-subtitle">Entre para acessar o controle de equipamentos da sua empresa.</p><form onSubmit={onSubmit}><label htmlFor="login-email">E-mail ou usuário de teste<input id="login-email" name="email" type="text" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com ou teste-..." required /></label><label htmlFor="login-password">Senha<input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite sua senha" required /></label>{error && <p id="login-error" className="login-error" role="alert" aria-live="assertive">{error}</p>}{resetSent && <p id="login-success" className="login-success" role="status" aria-live="polite">Link de redefinição enviado. Verifique seu e-mail.</p>}<button className="primary-button login-button" type="submit" disabled={loading} aria-busy={loading}>{loading ? "Entrando..." : "Entrar"}<ArrowRight size={17} aria-hidden="true" /></button></form><button className="text-button" type="button" onClick={requestReset} disabled={loading || resetLoading}>{resetLoading ? "Enviando..." : "Esqueci minha senha"}</button><p className="login-footer">Acesso protegido por Supabase Auth</p></section></main>;
}
