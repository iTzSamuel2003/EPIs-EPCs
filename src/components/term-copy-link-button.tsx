"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Check, Clipboard, LoaderCircle, RotateCcw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";

type RecordType = "delivery" | "return";
type ConfirmationAction = "renew" | "cancel";

export function TermCopyLinkButton({ recordType, recordId, allowRenew = false }: { recordType: RecordType; recordId: string; allowRenew?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<ConfirmationAction | null>(null);
  const busyRef = useRef(false);
  const backButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pendingAction) return;
    backButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) setPendingAction(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingAction]);

  async function copyLink(forceRenew = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError("");
    setMessage("");

    try {
      let activeUrl = url;
      let activeExpiry = expiresAt;
      if (forceRenew || !activeUrl || !activeExpiry || new Date(activeExpiry).getTime() <= Date.now()) {
        const { data, error: invokeError } = await createClient().functions.invoke("create-term-signature-link", {
          body: { record_type: recordType, record_id: recordId },
        });
        if (invokeError) throw invokeError;
        const result = data as { url?: string; expires_at?: string } | null;
        if (!result?.url || !result.expires_at) throw new Error("O serviço não retornou um link válido.");
        activeUrl = result.url;
        activeExpiry = result.expires_at;
        setUrl(activeUrl);
        setExpiresAt(activeExpiry);
      }

      try {
        await navigator.clipboard.writeText(activeUrl);
        setMessage(`${forceRenew ? "Novo link gerado; os anteriores foram cancelados" : "Link copiado"} · válido até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(activeExpiry))}.`);
      } catch {
        setMessage(`${forceRenew ? "Novo link gerado; os anteriores foram cancelados. " : ""}Não foi possível copiar automaticamente. Selecione o link abaixo e copie-o.`);
      }
      if (forceRenew) setPendingAction(null);
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível gerar o link de assinatura."));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction || busyRef.current) return;
    if (pendingAction === "renew") {
      await copyLink(true);
      return;
    }

    if (recordType !== "return" || !allowRenew) return;
    busyRef.current = true;
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const { data, error: invokeError } = await createClient().functions.invoke("create-term-signature-link", {
        body: { action: "cancel", record_type: "return", record_id: recordId },
      });
      if (invokeError) throw invokeError;
      const result = data as { cancelled?: boolean; revoked_count?: number } | null;
      if (!result?.cancelled) throw new Error("O serviço não confirmou o cancelamento do link.");
      setUrl("");
      setExpiresAt("");
      setMessage(result.revoked_count
        ? "Link de devolução cancelado. Você pode gerar outro quando quiser."
        : "Nenhum link pendente foi encontrado para cancelar.");
      setPendingAction(null);
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível cancelar o link de devolução."));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  const actionTitle = pendingAction === "cancel" ? "Cancelar link de devolução?" : "Gerar novo link de assinatura?";
  const actionDescription = pendingAction === "cancel"
    ? "O link atual deixará de funcionar. Nenhum novo link será criado. Você poderá gerar outro quando quiser."
    : "O link atual e qualquer outro link pendente serão invalidados. Um novo link será gerado e copiado para você enviar ao colaborador.";

  return (
    <div className="term-copy-link-action">
      <button type="button" className="action-button" onClick={() => void copyLink()} disabled={loading} aria-busy={loading}>
        {loading ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : message && url ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
        {loading ? "Gerando link..." : "Copiar link para assinatura"}
      </button>
      {allowRenew && <>
        <button type="button" className="action-button term-renew-link-button" onClick={() => { setError(""); setPendingAction("renew"); }} disabled={loading} aria-haspopup="dialog">
          <RotateCcw size={14} aria-hidden="true" /> Gerar novo link
        </button>
        <button type="button" className="action-button term-cancel-link-button" onClick={() => { setError(""); setPendingAction("cancel"); }} disabled={loading} aria-haspopup="dialog">
          <Ban size={14} aria-hidden="true" /> Cancelar link
        </button>
      </>}
      {url && message && <input className="term-copy-link-url" value={url} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Link de assinatura" />}
      {message && <small className="term-action-feedback" role="status">{message}</small>}
      {error && !pendingAction && <small className="term-action-feedback error" role="alert">{error}</small>}

      {pendingAction && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) setPendingAction(null); }}>
        <section className="modal-card request-confirm-modal term-link-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="term-link-confirm-title" aria-describedby="term-link-confirm-description">
          <div className={`request-confirm-icon${pendingAction === "cancel" ? " term-link-cancel-icon" : ""}`}>
            {pendingAction === "cancel" ? <Ban size={23} aria-hidden="true" /> : <RotateCcw size={23} aria-hidden="true" />}
          </div>
          <div className="modal-header">
            <div><p className="eyebrow">LINK DE ASSINATURA</p><h2 id="term-link-confirm-title">{actionTitle}</h2></div>
            <button className="close-modal" type="button" onClick={() => setPendingAction(null)} disabled={loading} aria-label="Fechar"><X size={18} /></button>
          </div>
          <p className="request-confirm-description" id="term-link-confirm-description">{actionDescription}</p>
          {error && <div className="feedback error-feedback term-link-confirm-error" role="alert">{error}</div>}
          <div className="modal-actions">
            <button ref={backButtonRef} type="button" className="secondary-button" onClick={() => setPendingAction(null)} disabled={loading}>Voltar</button>
            <button type="button" className={`primary-button${pendingAction === "cancel" ? " request-confirm-danger" : ""}`} onClick={() => void confirmAction()} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : pendingAction === "cancel" ? <Ban size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
              {loading ? (pendingAction === "cancel" ? "Cancelando link..." : "Gerando novo link...") : (pendingAction === "cancel" ? "Cancelar link" : "Gerar novo link")}
            </button>
          </div>
        </section>
      </div>}
    </div>
  );
}
