"use client";

import { useRef, useState } from "react";
import { Download, Eye, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { closePendingDownload, finishPendingDownload, openPendingDownload } from "@/lib/external-download";
import { friendlyError } from "@/lib/ui-feedback";

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "colaborador";
}

export function TermDocumentActions({ path, employeeName }: { path: string; employeeName: string }) {
  const [busyAction, setBusyAction] = useState<"view" | "download" | "">("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  async function openDocument(download: boolean) {
    if (!path || busyRef.current) return;
    busyRef.current = true;
    setBusyAction(download ? "download" : "view");
    setError("");
    const popup = openPendingDownload();

    try {
      if (!popup) throw new Error("O navegador bloqueou a abertura do documento. Permita pop-ups para este site.");
      const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "pdf";
      const fileName = `termo-entrega-${safeFileName(employeeName)}.${extension}`;
      const { data, error: signedUrlError } = await createClient()
        .storage
        .from("delivery-terms")
        .createSignedUrl(path, 300, download ? { download: fileName } : undefined);
      if (signedUrlError || !data?.signedUrl) throw signedUrlError ?? new Error("Não foi possível acessar o documento assinado.");
      finishPendingDownload(popup, data.signedUrl);
    } catch (caught) {
      closePendingDownload(popup);
      setError(friendlyError(caught, "Não foi possível abrir o documento assinado."));
    } finally {
      busyRef.current = false;
      setBusyAction("");
    }
  }

  return (
    <div className="term-document-actions">
      <button type="button" className="action-button" onClick={() => void openDocument(false)} disabled={Boolean(busyAction)}>
        {busyAction === "view" ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        {busyAction === "view" ? "Abrindo..." : "Visualizar termo assinado"}
      </button>
      <button type="button" className="action-button" onClick={() => void openDocument(true)} disabled={Boolean(busyAction)}>
        {busyAction === "download" ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
        {busyAction === "download" ? "Baixando..." : "Baixar termo assinado"}
      </button>
      {error && <small className="term-action-feedback error" role="alert">{error}</small>}
    </div>
  );
}
