"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type InviteMode = "loading" | "accept" | "signup" | "signin";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [mode, setMode] = useState<InviteMode>("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void createClient().auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) {
        setEmail(data.user.email || "");
        setName(typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : "");
        setMode("accept");
      } else {
        setMode("signup");
      }
    }).catch(() => {
      if (!cancelled) setMode("signup");
    });
    return () => { cancelled = true; };
  }, []);

  async function acceptInvitation(fullName: string) {
    const { error: acceptError } = await createClient().rpc("accept_organization_invitation", {
      p_token: token,
      p_full_name: fullName.trim(),
    });
    if (acceptError) {
      setError(acceptError.message);
      return false;
    }
    setSuccess("Convite aceito. Seu perfil e as permissões foram configurados.");
    window.setTimeout(() => window.location.replace("/"), 500);
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || mode === "loading") return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const supabase = createClient();
      if (mode === "accept") {
        if (!name.trim()) {
          setError("Informe seu nome completo para aceitar o convite.");
          return;
        }
        const { data, error: userError } = await supabase.auth.getUser();
        if (userError || !data.user) {
          setMode("signin");
          setError("Entre com a conta de e-mail que recebeu este convite.");
          return;
        }
        await acceptInvitation(name);
        return;
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (mode === "signup") {
        if (!name.trim()) {
          setError("Informe seu nome completo para criar a conta.");
          return;
        }
        if (password.length < 6) {
          setError("A senha deve ter pelo menos 6 caracteres.");
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        if (!data.session) {
          setSuccess("Conta criada. Confirme o e-mail e depois entre aqui para concluir o convite.");
          setMode("signin");
          return;
        }
        await acceptInvitation(name);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) {
        setError("Não foi possível entrar. Confira o e-mail e a senha e confirme o e-mail da conta.");
        return;
      }
      const { data } = await supabase.auth.getUser();
      const metadataName = typeof data.user?.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : "";
      setName(metadataName.trim());
      setMode("accept");
      setSuccess("Confirme ou informe seu nome completo para concluir o convite.");
    } catch {
      setError("Não foi possível concluir o convite. Atualize a página e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function switchAccount() {
    setSaving(true);
    setError("");
    try {
      const { error: signOutError } = await createClient().auth.signOut();
      if (signOutError) {
        setError("Não foi possível sair desta conta. Atualize a página e tente novamente.");
        return;
      }
      setPassword("");
      setMode("signin");
    } catch {
      setError("Não foi possível trocar de conta agora. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const isSignup = mode === "signup";
  const isSignin = mode === "signin";
  const isAccept = mode === "accept";

  return <main className="login-shell"><div className="login-brand"><div className="brand-mark" aria-hidden="true"><ShieldCheck size={25} /></div><div><strong>EPIS<span>+</span></strong><small>Gestão inteligente</small></div></div><section className="login-card" aria-labelledby="invite-title"><p className="eyebrow">CONVITE DE ORGANIZAÇÃO</p><h1 id="invite-title">{mode === "loading" ? "Verificando acesso" : isAccept ? "Aceitar convite" : isSignin ? "Entre para aceitar" : "Criar acesso"}</h1><p className="login-subtitle">{isAccept ? "Confirme que esta é a conta de e-mail convidada para vincular seu acesso à organização." : isSignin ? "Use o e-mail que recebeu o convite. O acesso será ativado após a confirmação do endereço." : "Crie sua conta com o mesmo e-mail para o qual o convite foi enviado."}</p>{mode === "loading" ? <p role="status">Verificando sua sessão...</p> : <form onSubmit={submit}>{!isAccept && <>{!isSignin && <label htmlFor="invite-name">Nome completo<input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} autoComplete="name" /></label>}<label htmlFor="invite-email">E-mail<input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label htmlFor="invite-password">Senha<input id="invite-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete={isSignup ? "new-password" : "current-password"} /></label></>}{isAccept && <><label htmlFor="accepted-email">Conta autenticada<input id="accepted-email" type="email" value={email} readOnly /></label><label htmlFor="invite-name">Nome completo<input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} autoComplete="name" /></label></>}{error && <p className="login-error" role="alert">{error}</p>}{success && <p className="login-success" role="status"><Check size={15} /> {success}</p>}<button className="primary-button login-button" type="submit" disabled={saving}>{saving ? "Processando..." : isAccept ? "Aceitar convite" : isSignin ? "Entrar e aceitar" : "Criar conta"}<ArrowRight size={17} aria-hidden="true" /></button></form>}{isAccept && <button className="text-button" type="button" onClick={switchAccount} disabled={saving}>Trocar de conta</button>}{isSignup && <button className="text-button" type="button" onClick={() => { setMode("signin"); setError(""); setSuccess(""); }}>Já tenho uma conta</button>}{isSignin && <button className="text-button" type="button" onClick={() => { setMode("signup"); setError(""); setSuccess(""); }}>Criar uma conta nova</button>}</section></main>;
}
