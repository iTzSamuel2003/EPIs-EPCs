import type { jsPDF } from "jspdf";

export type ReturnTermOrganization = {
  name: string;
  logo_url?: string | null;
  cnpj?: string | null;
  address?: string | null;
  phone?: string | null;
};

export type ReturnTermItem = {
  material: string;
  unit: string;
  quantity: number;
  size?: string | null;
  delivered_at?: string | null;
  lot_number?: string | null;
  ca_number?: string | null;
  ca_expires_at?: string | null;
  test_number?: string | null;
  test_report_number?: string | null;
  test_performed_at?: string | null;
  test_expires_at?: string | null;
  condition?: string | null;
  destination?: string | null;
  incident_type?: string | null;
  incident_description?: string | null;
};

export type ReturnTermData = {
  organization: ReturnTermOrganization;
  employee: {
    name: string;
    registration?: string | null;
    cpf?: string | null;
    job_title?: string | null;
    department?: string | null;
    admission_date?: string | null;
    termination_date?: string | null;
  };
  responsible_name?: string | null;
  return_id: string;
  returned_at: string;
  reason: string;
  notes?: string | null;
  items: ReturnTermItem[];
  signature_data_url?: string | null;
  signed_at?: string | null;
  signed_name?: string | null;
  signed_cpf?: string | null;
};

const ink: [number, number, number] = [36, 52, 82];
const muted: [number, number, number] = [89, 101, 121];
const gold: [number, number, number] = [210, 204, 0];
const paleGold: [number, number, number] = [255, 253, 240];
const border: [number, number, number] = [157, 162, 165];

const incidentNames: Record<string, string> = {
  normal: "Devolução normal",
  misuse: "Mau uso",
  loss: "Extravio",
  theft: "Furto",
  damage: "Dano",
  other: "Outra ocorrência",
};
const conditionNames: Record<string, string> = {
  good: "Bom",
  used: "Usado",
  damaged: "Danificado",
  unusable: "Inutilizado",
};
const destinationNames: Record<string, string> = {
  stock: "Retorno ao estoque",
  maintenance: "Manutenção",
  disposal: "Descarte",
  not_returned: "Não devolvido",
};
const reasonNames: Record<string, string> = {
  replacement: "Substituição",
  termination: "Desligamento",
  role_change: "Alteração de função",
  damaged: "Equipamento danificado",
  voluntary: "Devolução voluntária",
  other: "Outro",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString("pt-BR", { timeZone: "America/Cuiaba" });
}

async function loadLogoDataUrl(url?: string | null) {
  if (!url || typeof document === "undefined") return null;
  let objectUrl: string | null = null;
  try {
    const response = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 5 * 1024 * 1024 || !blob.type.toLowerCase().startsWith("image/")) return null;

    // Rasteriza PNG, JPEG, WebP e SVG para o mesmo PNG transparente do documento.
    const canvas = document.createElement("canvas");
    let image: CanvasImageSource;
    let sourceWidth: number;
    let sourceHeight: number;
    let bitmap: ImageBitmap | null = null;
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
      image = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } else {
      objectUrl = URL.createObjectURL(blob);
      const imageElement = new Image();
      imageElement.src = objectUrl;
      await imageElement.decode();
      image = imageElement;
      sourceWidth = imageElement.naturalWidth;
      sourceHeight = imageElement.naturalHeight;
    }
    const scale = Math.min(3, 1200 / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap?.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return null;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return canvas.toDataURL("image/png");
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
}

export async function createReturnTermDocument(data: ReturnTermData): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const hasIncident = data.items.some((item) => item.incident_type && item.incident_type !== "normal");
  const logo = await loadLogoDataUrl(data.organization.logo_url);
  const isDsx = data.organization.name.toLocaleUpperCase("pt-BR").includes("DSX");
  const footerAddress = data.organization.address || (isDsx ? "Rua Harrison de Figueiredo, 132, Jd. Sta. Maria, 79833-552, Dourados-MS" : "");
  const footerPhone = data.organization.phone || (isDsx ? "+55 67 3425-2324" : "");
  const footerWebsite = isDsx ? "www.dsxenergia.com.br" : "";
  let y = 0;

  function header() {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, 32, "F");
    doc.setFillColor(...paleGold);
    doc.triangle(pageWidth * 0.62, 0, pageWidth, 0, pageWidth, 30, "F");
    doc.setFillColor(...gold);
    doc.rect(0, 31, pageWidth, 2.2, "F");

    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(data.organization.name.toLocaleUpperCase("pt-BR"), margin, 10, {
      maxWidth: contentWidth - (logo ? 48 : 0),
    });
    doc.setFontSize(12.5);
    doc.text("TERMO DE DEVOLUÇÃO DE EPI / EPC", margin, 19, {
      maxWidth: contentWidth - (logo ? 48 : 0),
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(...muted);
    doc.text(
      hasIncident
        ? "REGISTRO DE OCORRÊNCIA · CIÊNCIA E APURAÇÃO INDIVIDUAL"
        : "RECIBO DE DEVOLUÇÃO E RESPONSABILIDADE",
      margin,
      26,
      { maxWidth: contentWidth - (logo ? 48 : 0) },
    );
    if (logo) {
      try {
        doc.addImage(logo, "PNG", pageWidth - margin - 42, 5, 42, 21, undefined, "FAST");
      } catch {
        // O documento continua legível mesmo se a imagem da marca não puder ser inserida.
      }
    }
    y = 39;
  }

  function addField(label: string, value: string, x: number, top: number, width: number) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(...muted);
    doc.text(label.toLocaleUpperCase("pt-BR"), x, top);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.1);
    doc.setTextColor(...ink);
    const lines = doc.splitTextToSize(value || "—", width - 3).slice(0, 3);
    doc.text(lines, x, top + 4.5, { lineHeightFactor: 1.12 });
    return Math.max(12, lines.length * 3.2 + 6);
  }

  function addMetadata() {
    const third = contentWidth / 3;
    const fields: Array<[string, string]> = [
      ["Nº DE REGISTRO / MATRÍCULA", data.employee.registration || "Não informada"],
      ["COLABORADOR", data.employee.name],
      ["DATA DA DEVOLUÇÃO", formatDate(data.returned_at)],
      ["CARGO / FUNÇÃO", data.employee.job_title || "Não informado"],
      ["SETOR", data.employee.department || "Não informado"],
      ["MOTIVO", reasonNames[data.reason] || data.reason],
      ["DATA DE ADMISSÃO", formatDate(data.employee.admission_date)],
    ];
    if (data.employee.termination_date) fields.push(["DATA DE DESLIGAMENTO", formatDate(data.employee.termination_date)]);
    if (data.responsible_name) fields.push(["RESPONSÁVEL PELO CONTROLE", data.responsible_name]);
    fields.push(["Nº DO REGISTRO", data.return_id.slice(0, 8).toLocaleUpperCase("pt-BR")]);

    for (let offset = 0; offset < fields.length; offset += 3) {
      const row = fields.slice(offset, offset + 3);
      let rowHeight = 12;
      row.forEach(([label, value], column) => {
        rowHeight = Math.max(rowHeight, addField(label, value, margin + third * column, y, third));
      });
      y += rowHeight + 1;
    }
    doc.setDrawColor(204, 209, 216);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  }

  function ensureSpace(height: number) {
    if (y + height <= pageHeight - 23) return false;
    doc.addPage();
    header();
    return true;
  }

  function sectionTitle(title: string) {
    ensureSpace(10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    doc.setTextColor(...ink);
    doc.text(title.toLocaleUpperCase("pt-BR"), margin, y + 4);
    y += 8;
  }

  const tableWidths = [19, 51, 20, 43, contentWidth - 133];
  const tableHeaders = ["DATA", "DESCRIÇÃO DO EQUIPAMENTO", "QUANT. / TAM.", "Nº CA / ENSAIO", "CONDIÇÃO / OCORRÊNCIA"];
  function drawTableHeader() {
    doc.setFillColor(242, 239, 202);
    doc.setDrawColor(...border);
    doc.rect(margin, y, contentWidth, 8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...ink);
    let x = margin;
    tableHeaders.forEach((label, index) => {
      doc.text(doc.splitTextToSize(label, tableWidths[index] - 2), x + 1.5, y + 3.2, { lineHeightFactor: 1 });
      x += tableWidths[index];
      if (index < tableHeaders.length - 1) doc.line(x, y, x, y + 8);
    });
    y += 8;
  }

  header();
  addMetadata();

  const declaration = hasIncident
    ? "Declaro que as informações e os itens desta ficha foram apresentados para registro e apuração individual. As ocorrências serão encaminhadas para análise separada, e esta ficha não representa dívida reconhecida nem autoriza desconto automático em folha. Qualquer ressarcimento dependerá da apuração dos fatos, da comprovação de responsabilidade e dos requisitos legais aplicáveis."
    : "Declaro que os materiais relacionados foram conferidos e devolvidos nas condições e destinos registrados nesta ficha. Eventuais danos, perdas ou divergências serão avaliados individualmente, conforme os procedimentos da organização e os requisitos legais aplicáveis.";
  const declarationLines = doc.splitTextToSize(declaration, contentWidth - 9);
  const declarationHeight = declarationLines.length * 3.35 + 13;
  ensureSpace(declarationHeight + 7);
  doc.setFillColor(250, 250, 250);
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, contentWidth, declarationHeight, 0.5, 0.5, "FD");
  doc.setFillColor(...gold);
  doc.rect(margin, y, 1.4, declarationHeight, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.setTextColor(...ink);
  doc.text(hasIncident ? "DECLARAÇÃO DE CIÊNCIA DA OCORRÊNCIA" : "DECLARAÇÃO DE DEVOLUÇÃO E RESPONSABILIDADE", margin + 4, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.1);
  doc.setTextColor(55, 66, 84);
  doc.text(declarationLines, margin + 4, y + 9, { lineHeightFactor: 1.22 });
  y += declarationHeight + 4;

  const signatureBlockHeight = 25;
  ensureSpace(signatureBlockHeight + 5);
  const signatureWidth = contentWidth * 0.62;
  const signatureX = margin + (contentWidth - signatureWidth) / 2;
  const signatureLineY = y + 14;
  if (data.signature_data_url) {
    try {
      doc.addImage(data.signature_data_url, "PNG", signatureX + 3, y - 1, signatureWidth - 6, 13, undefined, "FAST");
    } catch {
      // A linha de assinatura permanece disponível se a imagem não for válida.
    }
  }
  doc.setDrawColor(70, 80, 98);
  doc.line(signatureX, signatureLineY, signatureX + signatureWidth, signatureLineY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.7);
  doc.setTextColor(...ink);
  doc.text(data.signed_name || data.employee.name, pageWidth / 2, signatureLineY + 4, { align: "center", maxWidth: signatureWidth });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.text(data.signed_at ? "ASSINATURA ELETRÔNICA DO COLABORADOR" : "ASSINATURA DO COLABORADOR", pageWidth / 2, signatureLineY + 8, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.setTextColor(...muted);
  const cpfDigits = data.signed_cpf?.replace(/\D/g, "") || "";
  const maskedCpf = cpfDigits.length === 11 ? `***.***.***-${cpfDigits.slice(-2)}` : "CPF não informado";
  const signatureNote = data.signed_at
    ? `Assinatura registrada em ${formatDateTime(data.signed_at)} · ${maskedCpf}`
    : "A assinatura confirma a ciência das informações desta ficha.";
  doc.text(signatureNote, pageWidth / 2, signatureLineY + 12, { align: "center", maxWidth: signatureWidth });
  y = signatureLineY + 17;

  sectionTitle(hasIncident ? "Itens vinculados à devolução / ocorrência" : "Materiais devolvidos");
  drawTableHeader();
  for (const item of data.items) {
    const compliance = [
      item.ca_number ? `CA ${item.ca_number}${item.ca_expires_at ? ` · validade ${formatDate(item.ca_expires_at)}` : ""}` : "",
      item.test_number ? `Ensaio nº ${item.test_number}` : "",
      item.test_report_number ? `Laudo ${item.test_report_number}` : "",
      item.test_performed_at ? `Realizado ${formatDate(item.test_performed_at)}` : "",
      item.test_expires_at ? `Válido até ${formatDate(item.test_expires_at)}` : "",
    ].filter(Boolean).join("\n") || "—";
    const occurrence = [
      conditionNames[item.condition || ""] || item.condition || "Não informada",
      incidentNames[item.incident_type || "normal"] || item.incident_type || "",
      destinationNames[item.destination || ""] || item.destination || "",
      item.incident_description || "",
    ].filter(Boolean).join("\n") || "Devolução normal";
    const values = [
      formatDate(item.delivered_at || data.returned_at),
      `${item.material}${item.lot_number ? `\nLote ${item.lot_number}` : ""}`,
      `${item.quantity} ${item.unit}${item.size ? `\nTam. ${item.size}` : ""}`,
      compliance,
      occurrence,
    ];
    const cellLines = values.map((value, index) => doc.splitTextToSize(value, tableWidths[index] - 3));
    const rowHeight = Math.max(12, ...cellLines.map((lines) => lines.length * 3.05 + 4));
    if (ensureSpace(rowHeight + 10)) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...ink);
      doc.text("CONTINUAÇÃO · MATERIAIS DA DEVOLUÇÃO", margin, y + 4);
      y += 7;
      drawTableHeader();
    }
    let x = margin;
    doc.setDrawColor(...border);
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, contentWidth, rowHeight, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.setTextColor(...ink);
    cellLines.forEach((lines, index) => {
      doc.text(lines, x + 1.5, y + 4, { lineHeightFactor: 1.12 });
      x += tableWidths[index];
      if (index < tableWidths.length - 1) doc.line(x, y, x, y + rowHeight);
    });
    y += rowHeight;
  }

  if (data.notes) {
    y += 4;
    const lines = doc.splitTextToSize(data.notes, contentWidth);
    if (ensureSpace(lines.length * 3.5 + 12)) sectionTitle("Observações");
    else sectionTitle("Observações");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(...ink);
    doc.text(lines, margin, y + 2, { lineHeightFactor: 1.2 });
    y += lines.length * 3.5 + 5;
  }

  const footerParts = [
    data.organization.cnpj ? `CNPJ ${data.organization.cnpj}` : "",
    footerAddress,
    footerPhone,
    footerWebsite,
  ].filter(Boolean);
  for (let pageNumber = 1; pageNumber <= doc.getNumberOfPages(); pageNumber += 1) {
    doc.setPage(pageNumber);
    const footerLineY = pageHeight - 15;
    doc.setDrawColor(...gold);
    doc.setLineWidth(1.1);
    doc.line(margin, footerLineY, pageWidth - margin, footerLineY);
    doc.setLineWidth(0.2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(...muted);
    if (footerParts.length) {
      doc.text(footerParts.join("  ·  "), pageWidth / 2, footerLineY + 4, { align: "center", maxWidth: contentWidth });
    }
    doc.setFontSize(5.8);
    doc.text(
      `REGISTRO ${data.return_id.toLocaleUpperCase("pt-BR")} · ${pageNumber}/${doc.getNumberOfPages()} · NÃO AUTORIZA DESCONTO AUTOMÁTICO`,
      pageWidth / 2,
      pageHeight - 5,
      { align: "center", maxWidth: contentWidth },
    );
  }
  return doc;
}
