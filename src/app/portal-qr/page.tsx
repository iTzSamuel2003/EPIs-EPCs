"use client";

import Image from "next/image";
import { Printer, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import jsPDF from "jspdf";

const permanentPortalUrl = "https://epis-epcs.vercel.app/portal";

export default function PortalQrPage() {
  const [qrDataUrl, setQrDataUrl] = useState("");

  async function generateQr(url: string) {
    setQrDataUrl(url ? await QRCode.toDataURL(url, { width: 520, margin: 2, errorCorrectionLevel: "H" }) : "");
  }

  function downloadPdf() {
    if (!qrDataUrl) return;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.setTextColor(23, 35, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Acesse o Portal do Colaborador", 105, 38, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 112, 135);
    doc.setFontSize(12);
    doc.text("Escaneie o código e informe sua matrícula e CPF.", 105, 49, { align: "center" });
    doc.addImage(qrDataUrl, "PNG", 45, 67, 120, 120);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Aponte a câmera do celular para acessar", 105, 205, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(125, 135, 150);
    doc.text("O código não contém matrícula, CPF ou outros dados pessoais.", 105, 214, { align: "center" });
    doc.save("qrcode-portal-colaborador.pdf");
  }

  useEffect(() => {
    void generateQr(permanentPortalUrl);
  }, []);

  return <main className="module-shell portal-qr-page">
    <header className="module-header"><div><p className="eyebrow">ACESSO DO COLABORADOR</p><h1>QR Code do Portal</h1><p className="module-subtitle">Imprima este código para facilitar o acesso à tela de matrícula e CPF.</p></div><div className="header-actions no-print"><button className="secondary-button" type="button" onClick={downloadPdf}><QrCode size={16} /> Baixar PDF</button><button className="primary-button" type="button" onClick={() => window.print()}><Printer size={16} /> Imprimir</button></div></header>
    <section className="panel portal-qr-card"><div className="portal-qr-heading"><div className="entry-icon"><QrCode size={24} /></div><div><h2>Acesse o Portal do Colaborador</h2><p>Ao escanear, o colaborador será direcionado para informar a própria matrícula e CPF. Nenhum dado pessoal fica gravado no QR Code.</p></div></div>{qrDataUrl && <Image className="portal-qr-image" src={qrDataUrl} alt="QR Code para acessar o Portal do Colaborador" width={520} height={520} unoptimized /> }<strong className="portal-qr-label">Aponte a câmera do celular para acessar</strong><div className="portal-qr-actions no-print"><span>Para imprimir sem data, URL e título, desative “Cabeçalhos e rodapés” na janela de impressão.</span></div></section>
  </main>;
}
