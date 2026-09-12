"use client";

import { AlertTriangle, LogIn, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("EPIS+ runtime error", error);
  }, [error]);

  return <main className="page-content runtime-error-page"><section className="panel runtime-error-card" role="alert"><div className="runtime-error-icon"><AlertTriangle size={24} /></div><p className="eyebrow">ERRO INESPERADO</p><h1>Não foi possível carregar esta tela</h1><p>Ocorreu uma falha temporária. Tente novamente ou volte ao login para iniciar uma nova sessão.</p><div className="modal-actions"><Link className="secondary-button" href="/login"><LogIn size={16} /> Voltar ao login</Link><button className="primary-button" type="button" onClick={reset}><RefreshCcw size={16} /> Tentar novamente</button></div></section></main>;
}
