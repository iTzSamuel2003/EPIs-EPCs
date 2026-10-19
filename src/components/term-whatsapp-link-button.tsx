"use client";

import { useState } from "react";
import { LoaderCircle, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";

type RecordType = "delivery" | "return";

export function TermWhatsAppLinkButton({ recordType, recordId, employeeName }: {
  recordType: RecordType;
  recordId: string;
  employeeName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function openWhatsApp() {
    if (loading) return;
    const whatsapp = window.open("about:blank", "_blank");
    if (!whatsapp) {
      setError("Permita a abertura de pop-ups para preparar a mensagem no WhatsApp.");
      return;
    }
    whatsapp.opener = null;
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const { data, error: invokeError } = await createClient().functions.invoke("create-term-signature-link", {
        body: { record_type: recordType, record_id: recordId },
      });
      if (invokeError) throw invokeError;
      const result = data as { url?: string; expires_at?: string; employee_name?: string; employee_phone?: string | null } | null;
      if (!result?.url || !result.expires_at) throw new Error("O serviço não retornou um link válido.");

      const digits = (result.employee_phone ?? "").replace(/\D/g, "");
      const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
      const recipient = result.employee_name || employeeName;
      const termName = recordType === "delivery" ? "ficha de entrega" : "ficha de devolução";
      const expires = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.expires_at));
      const text = `Olá, ${recipient}! Acesse o link de uso único para conferir e assinar sua ${termName} de EPI/EPC. Informe seu nome completo e CPF conforme o cadastro. O link expira em ${expires}: ${result.url}`;
      const recipientPath = phone.length >= 12 && phone.length <= 13 ? `/${phone}` : "";
      whatsapp.location.replace(`https://wa.me${recipientPath}?text=${encodeURIComponent(text)}`);
      setMessage("Mensagem preparada. Confira o destinatário no WhatsApp e toque em Enviar.");
    } catch (caught) {
      whatsapp.close();
      setError(friendlyError(caught, "Não foi possível gerar o link de assinatura. Tente novamente."));
    } finally {
      setLoading(false);
    }
  }

  return <div className="term-whatsapp-action">
    <button type="button" className="action-button term-whatsapp-button" onClick={() => void openWhatsApp()} disabled={loading} aria-busy={loading}>
      {loading ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <MessageCircle size={14} aria-hidden="true" />}
      {loading ? "Gerando link..." : "Enviar link pelo WhatsApp"}
    </button>
    {message && <span className="term-whatsapp-feedback" role="status">{message}</span>}
    {error && <span className="term-whatsapp-feedback error" role="alert">{error}</span>}
  </div>;
}
