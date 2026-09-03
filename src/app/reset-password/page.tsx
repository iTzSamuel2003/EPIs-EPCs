"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setReady(Boolean(data.session));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && (event === "PASSWORD_RECOVERY" || session)) setReady(true);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 8) { setError("A senha deve ter pelo menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("As senhas não coincidem."); return; }
    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else { setMessage("Senha atualizada com sucesso. Você já pode entrar no sistema."); setTimeout(() => router.push("/login"), 1400); }
    setLoading(false);
  }

  return <main className="login-shell"><div className="login-brand"><div className="brand-mark"><ShieldCheck size={25} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div></div><section className="login-card"><p className="eyebrow">RECUPERAÇÃO DE ACESSO</p><h1>Defina sua senha</h1><p className="login-subtitle">Crie uma nova senha para acessar o controle de equipamentos.</p>{!ready ? <p className="login-subtitle">Abra o link mais recente recebido por e-mail para continuar.</p> : <form onSubmit={onSubmit}><label>Nova senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" minLength={8} required /></label><label>Confirme a senha<input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Repita a nova senha" minLength={8} required /></label>{error && <p className="login-error">{error}</p>}{message && <p className="login-success">{message}</p>}<button className="primary-button login-button" disabled={loading}>{loading ? "Salvando..." : "Salvar nova senha"}<ArrowRight size={17} /></button></form>}<p className="login-footer">Acesso protegido por Supabase Auth</p></section></main>;
}
