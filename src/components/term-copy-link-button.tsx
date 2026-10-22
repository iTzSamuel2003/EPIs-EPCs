"use client";

import { useRef, useState } from "react";
import { Check, Clipboard, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";

type RecordType = "delivery" | "return";

export function TermCopyLinkButton({ recordType, recordId }: { recordType: RecordType; recordId: string }) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  async function copyLink() {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError("");
    setMessage("");

    try {
      let activeUrl = url;
      let activeExpiry = expiresAt;
      if (!activeUrl || !activeExpiry || new Date(activeExpiry).getTime() <= Date.now()) {
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
        setMessage(`Link copiado · válido até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(activeExpiry))}.`);
      } catch {
        setMessage("Não foi possível copiar automaticamente. Selecione o link abaixo e copie-o.");
      }
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível gerar o link de assinatura."));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="term-copy-link-action">
      <button type="button" className="action-button" onClick={() => void copyLink()} disabled={loading} aria-busy={loading}>
        {loading ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : message && url ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
        {loading ? "Gerando link..." : "Copiar link para assinatura"}
      </button>
      {url && message && <input className="term-copy-link-url" value={url} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="Link de assinatura" />}
      {message && <small className="term-action-feedback" role="status">{message}</small>}
      {error && <small className="term-action-feedback error" role="alert">{error}</small>}
    </div>
  );
}
