"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter(); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) { event.preventDefault(); setLoading(true); setError(""); const supabase = createClient(); const { error: signInError } = await supabase.auth.signInWithPassword({ email, password }); if (signInError) setError("E-mail ou senha inválidos."); else router.push("/"); setLoading(false); }
  return <main className="login-shell"><div className="login-brand"><div className="brand-mark"><ShieldCheck size={25} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div></div><section className="login-card"><p className="eyebrow">ACESSO RESTRITO</p><h1>Bem-vindo de volta</h1><p className="login-subtitle">Entre para acessar o controle de equipamentos da sua empresa.</p><form onSubmit={onSubmit}><label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" required /></label><label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite sua senha" required /></label>{error && <p className="login-error">{error}</p>}<button className="primary-button login-button" disabled={loading}>{loading ? "Entrando..." : "Entrar"}<ArrowRight size={17} /></button></form><p className="login-footer">Acesso protegido por Supabase Auth</p></section></main>;
}

