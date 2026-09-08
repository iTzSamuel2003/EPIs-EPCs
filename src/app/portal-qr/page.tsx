"use client";

import Image from "next/image";
import { Printer, QrCode, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function PortalQrPage() {
  const [portalUrl, setPortalUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  async function generateQr(url: string) {
    setQrDataUrl(url ? await QRCode.toDataURL(url, { width: 520, margin: 2, errorCorrectionLevel: "H" }) : "");
  }

  useEffect(() => {
    const url = `${window.location.origin}/portal`;
    setPortalUrl(url);
    void generateQr(url);
  }, []);

  return <main className="module-shell portal-qr-page">
    <header className="module-header"><div><p className="eyebrow">ACESSO DO COLABORADOR</p><h1>QR Code do Portal</h1><p className="module-subtitle">Imprima este código para facilitar o acesso à tela de matrícula e CPF.</p></div><button className="primary-button no-print" type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir QR Code</button></header>
    <section className="panel portal-qr-card"><div className="portal-qr-heading"><div className="entry-icon"><QrCode size={24} /></div><div><h2>Acesse o Portal do Colaborador</h2><p>Ao escanear, o colaborador será direcionado para informar a própria matrícula e CPF. Nenhum dado pessoal fica gravado no QR Code.</p></div></div>{qrDataUrl && <Image className="portal-qr-image" src={qrDataUrl} alt="QR Code para acessar o Portal do Colaborador" width={520} height={520} unoptimized /> }<strong className="portal-qr-label">Aponte a câmera do celular para acessar</strong><button className="secondary-button no-print" type="button" onClick={() => void generateQr(portalUrl)}><RefreshCw size={15} /> Atualizar código</button></section>
  </main>;
}
