import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFImage, StandardFonts, rgb } from "pdf-lib";

const productionOrigin = "https://epis-epcs.vercel.app";
const allowedOrigins = new Set([productionOrigin, "http://localhost:3000", "http://127.0.0.1:3000"]);
const maxRequestBytes = 800_000;
const attempts = new Map<string, { count: number; resetAt: number }>();
const reasonLabels: Record<string, string> = {
  admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido",
  role_change: "Alteração de função", replacement: "Substituição", termination: "Desligamento", voluntary: "Devolução voluntária", other: "Outro",
};
const incidentLabels: Record<string, string> = {
  normal: "Devolução normal", misuse: "Mau uso", loss: "Perda", theft: "Extravio ou furto", damage: "Dano", other: "Outra ocorrência",
};
const conditionLabels: Record<string, string> = { good: "Bom", used: "Usado", damaged: "Danificado", unusable: "Inutilizado" };
const destinationLabels: Record<string, string> = { stock: "Estoque", maintenance: "Manutenção", disposal: "Descarte" };

type Snapshot = {
  version: number;
  type: "delivery" | "return";
  pre_delivery_signature?: boolean;
  organization_id?: string;
  organization_name: string;
  organization_logo_url?: string | null;
  organization_cnpj?: string | null;
  organization_address?: string | null;
  organization_phone?: string | null;
  responsible_name: string;
  employee_name: string;
  employee_registration: string | null;
  employee_function?: string | null;
  employee_department?: string | null;
  employee_admission_date?: string | null;
  employee_termination_date?: string | null;
  date: string;
  reason: string;
  notes: string | null;
  items: Array<Record<string, unknown>>;
};

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : productionOrigin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function respond(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowAttempt(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  return true;
}

function isToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function dateLabel(value: unknown) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "Não informada";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? "Não informada" : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba" }).format(date);
}

function maskedCpf(value: string) {
  return `***.***.***-${value.slice(-2)}`;
}

function formatReason(value: unknown) {
  const key = String(value ?? "");
  return reasonLabels[key] ?? (key || "Não informado");
}

function renderText(value: unknown) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

async function createPreDeliverySignedPdf(snapshot: Snapshot, signatureBytes: Uint8Array, signerName: string, signerCpf: string, signedAt: Date, linkId: string) {
  const document = await PDFDocument.create();
  document.setTitle(`Ficha de EPI - ${snapshot.employee_name}`);
  document.setSubject(`Recebimento de EPI com assinatura eletrônica. Registro ${linkId}.`);
  document.setCreator("EPIS+ Gestão inteligente");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pdfReplacements: Record<string, string> = {
    "—": "-", "–": "-", "−": "-", "·": "-", "•": "-", "…": "...",
    "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "‚": "'",
    "\u00a0": " ", "\u202f": " ", "\u2009": " ",
  };
  function pdfText(value: unknown) {
    return Array.from(String(value ?? "")).map((character) => {
      if (character === "\n" || character === "\r" || character === "\t") return character;
      const candidate = pdfReplacements[character] ?? character;
      try { regular.encodeText(candidate); return candidate; }
      catch {
        const fallback = candidate.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "");
        return fallback || "?";
      }
    }).join("");
  }
  const signature = await document.embedPng(signatureBytes);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 42;
  const width = pageSize[0] - margin * 2;
  const gold = rgb(0.82, 0.79, 0.03);
  const ink = rgb(0.14, 0.18, 0.25);
  const muted = rgb(0.36, 0.4, 0.47);
  const border = rgb(0.55, 0.58, 0.6);
  let page = document.addPage(pageSize);
  let y = 0;
  let logo: PDFImage | null = null;

  try {
    if (snapshot.organization_id && snapshot.organization_logo_url) {
      const logoUrl = new URL(snapshot.organization_logo_url);
      const expectedPath = `/storage/v1/object/public/organization-logos/${snapshot.organization_id}/logo`;
      if (logoUrl.origin === new URL(supabaseUrl).origin && logoUrl.pathname === expectedPath) {
        const { data: file, error } = await admin.storage.from("organization-logos").download(`${snapshot.organization_id}/logo`);
        if (!error && file && file.size <= 2 * 1024 * 1024) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mime = file.type.split(";")[0].trim().toLowerCase();
          logo = mime === "image/png" ? await document.embedPng(bytes) : mime === "image/jpeg" ? await document.embedJpg(bytes) : null;
        }
      }
    }
  } catch { /* A logo indisponível não impede a emissão do documento. */ }

  function drawHeader(target: typeof page) {
    const top = pageSize[1];
    target.drawRectangle({ x: 0, y: top - 97, width: pageSize[0], height: 97, color: rgb(1, 0.998, 0.96) });
    target.drawRectangle({ x: 0, y: top - 101, width: pageSize[0], height: 5, color: gold });
    target.drawText(pdfText(renderText(snapshot.organization_name).toUpperCase()), { x: margin, y: top - 35, size: 11, font: bold, color: ink, maxWidth: width - 160 });
    target.drawText(pdfText("FICHA DE EPI - EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL"), { x: margin, y: top - 60, size: 12, font: bold, color: ink, maxWidth: width - 160 });
    target.drawText(pdfText("RECIBO DE ENTREGA E RESPONSABILIDADE"), { x: margin, y: top - 78, size: 8, font: regular, color: muted });
    if (logo) {
      const scale = Math.min(138 / logo.width, 57 / logo.height);
      const imageWidth = logo.width * scale;
      const imageHeight = logo.height * scale;
      target.drawImage(logo, { x: pageSize[0] - margin - imageWidth, y: top - 75 + (57 - imageHeight) / 2, width: imageWidth, height: imageHeight });
    }
  }

  function addPage() {
    page = document.addPage(pageSize);
    drawHeader(page);
    y = pageSize[1] - 116;
  }

  function wrappedLines(text: string, font: typeof regular, size: number, maxWidth: number) {
    const result: string[] = [];
    for (const paragraph of pdfText(text).replace(/\r/g, "").split("\n")) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (!words.length) { result.push(""); continue; }
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          result.push(current);
          current = word;
        } else current = candidate;
      }
      if (current) result.push(current);
    }
    return result;
  }

  function drawWrapped(text: string, x: number, top: number, maxWidth: number, size: number, font: typeof regular, color = ink, lineHeight = size + 2) {
    const lines = wrappedLines(text, font, size, maxWidth);
    lines.forEach((value, index) => {
      if (value) page.drawText(value, { x, y: top - index * lineHeight, size, font, color, maxWidth });
    });
    return lines.length * lineHeight;
  }

  function drawMetaCell(label: string, value: string, x: number, top: number, cellWidth: number) {
    page.drawText(pdfText(label.toUpperCase()), { x, y: top - 7, size: 6.2, font: bold, color: muted, maxWidth: cellWidth });
    const valueHeight = drawWrapped(value || "Não informada", x, top - 20, cellWidth, 8, bold, ink, 9.5);
    return Math.max(31, 23 + valueHeight);
  }

  function drawTableHeader() {
    const labels = ["DATA", "DESCRIÇÃO DO EQUIPAMENTO", "QUANT.", "TAM.", "Nº CA / ENSAIO", "ASSINATURA"];
    const widths = [54, 160, 48, 40, 130, 79];
    const height = 27;
    let x = margin;
    labels.forEach((label, index) => {
      page.drawRectangle({ x, y: y - height, width: widths[index], height, color: rgb(0.95, 0.94, 0.8), borderColor: border, borderWidth: 0.65 });
      drawWrapped(label, x + 4, y - 9, widths[index] - 8, 6.4, bold, ink, 7.2);
      x += widths[index];
    });
    y -= height;
  }

  function drawTableRow(values: string[]) {
    const widths = [54, 160, 48, 40, 130, 79];
    const cellLines = values.map((value, index) => wrappedLines(value, regular, 6.5, widths[index] - 8));
    const rowHeight = Math.max(32, ...cellLines.map((lines) => lines.length * 8 + 10));
    if (y - rowHeight < 58) { addPage(); drawTableHeader(); }
    let x = margin;
    values.forEach((value, index) => {
      page.drawRectangle({ x, y: y - rowHeight, width: widths[index], height: rowHeight, color: rgb(1, 1, 1), borderColor: border, borderWidth: 0.55 });
      drawWrapped(value, x + 4, y - 10, widths[index] - 8, 6.5, regular, ink, 8);
      x += widths[index];
    });
    y -= rowHeight;
  }

  drawHeader(page);
  y = pageSize[1] - 116;
  const metadata = [
    ["Nº DE REGISTRO / MATRÍCULA", snapshot.employee_registration || "Não informada"],
    ["COLABORADOR", snapshot.employee_name],
    ["DATA DE ADMISSÃO", dateLabel(snapshot.employee_admission_date)],
    ...(snapshot.employee_termination_date ? [["DATA DE DESLIGAMENTO", dateLabel(snapshot.employee_termination_date)]] : []),
    ["CARGO / FUNÇÃO", snapshot.employee_function || "Não informada"],
    ["SETOR", snapshot.employee_department || "Não informado"],
    ["DATA DA ENTREGA", dateLabel(snapshot.date)],
    ["MOTIVO", formatReason(snapshot.reason)],
    ["RESPONSÁVEL PELO CONTROLE", snapshot.responsible_name],
  ];
  const columns = 3;
  const cellGap = 10;
  const cellWidth = (width - cellGap * (columns - 1)) / columns;
  for (let index = 0; index < metadata.length; index += columns) {
    const row = metadata.slice(index, index + columns);
    const rowHeights = row.map(([label, value], column) => drawMetaCell(label, value, margin + column * (cellWidth + cellGap), y, cellWidth));
    y -= Math.max(...rowHeights) + 3;
  }
  y -= 5;

  const declaration = "Declaro que recebi os equipamentos de proteção relacionados nesta ficha e que fui orientado(a) sobre seu uso, finalidade, limitações, guarda e conservação, conforme as medidas de prevenção da organização e as NR-06 e NR-01. Comprometo-me a utilizar corretamente os equipamentos, seguir as orientações recebidas, comunicar danos ou alterações e devolvê-los quando solicitado, inclusive em caso de substituição, mudança de função ou desligamento.\nEstou ciente de que situações de perda, extravio, dano ou uso inadequado serão apuradas individualmente. Qualquer ressarcimento ou desconto dependerá da apuração e dos requisitos legais aplicáveis; esta declaração, por si só, não autoriza desconto automático.";
  const declarationLines = wrappedLines(declaration, regular, 7.2, width - 18);
  const declarationHeight = declarationLines.length * 9.5 + 26;
  page.drawRectangle({ x: margin, y: y - declarationHeight, width, height: declarationHeight, color: rgb(0.985, 0.985, 0.975), borderColor: border, borderWidth: 0.7 });
  page.drawText(pdfText("DECLARAÇÃO DE RECEBIMENTO E RESPONSABILIDADE"), { x: margin + 9, y: y - 13, size: 7.3, font: bold, color: ink });
  drawWrapped(declaration, margin + 9, y - 26, width - 18, 7.2, regular, ink, 9.5);
  y -= declarationHeight + 9;

  const signatureBoxWidth = 250;
  const signatureBoxHeight = 76;
  if (y - signatureBoxHeight < 58) { addPage(); }
  const signatureTop = y;
  page.drawLine({ start: { x: margin + 4, y: signatureTop - 48 }, end: { x: margin + signatureBoxWidth - 4, y: signatureTop - 48 }, thickness: 0.75, color: muted });
  const signatureScale = Math.min(220 / signature.width, 39 / signature.height);
  const signatureWidth = signature.width * signatureScale;
  const signatureHeight = signature.height * signatureScale;
  page.drawImage(signature, { x: margin + (signatureBoxWidth - signatureWidth) / 2, y: signatureTop - signatureHeight - 45, width: signatureWidth, height: signatureHeight });
  page.drawText(pdfText(renderText(signerName)), { x: margin + 4, y: signatureTop - 61, size: 8, font: bold, color: ink });
  page.drawText(pdfText(`CPF ${maskedCpf(signerCpf)} · Assinado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(signedAt)}`), { x: margin + 4, y: signatureTop - 72, size: 6.5, font: regular, color: muted });
  page.drawText(pdfText("ASSINATURA ELETRÔNICA DO COLABORADOR"), { x: margin + signatureBoxWidth + 14, y: signatureTop - 30, size: 7.2, font: bold, color: ink, maxWidth: width - signatureBoxWidth - 14 });
  drawWrapped("A assinatura confirma o recebimento e a ciência sobre todos os itens listados nesta ficha.", margin + signatureBoxWidth + 14, signatureTop - 44, width - signatureBoxWidth - 14, 7, regular, muted, 9);
  y = signatureTop - signatureBoxHeight - 9;

  page.drawText("MATERIAIS ENTREGUES", { x: margin, y, size: 9, font: bold, color: ink });
  y -= 10;
  drawTableHeader();
  for (const value of snapshot.items) {
    const item = object(value);
    const units = Array.isArray(item.units) ? item.units.map(object) : [];
    const compliance = [
      item.ca_number ? `CA ${renderText(item.ca_number)}${item.ca_expires_at ? ` · validade ${dateLabel(item.ca_expires_at)}` : ""}` : "",
      ...units.flatMap((unit) => [
        unit.test_number ? `Ensaio ${renderText(unit.test_number)}` : "",
        unit.test_report_number ? `Laudo ${renderText(unit.test_report_number)}` : "",
        unit.test_performed_at ? `Realizado ${dateLabel(unit.test_performed_at)}` : "",
        unit.test_expires_at ? `Ensaio válido até ${dateLabel(unit.test_expires_at)}` : unit.valid_until ? `Válido até ${dateLabel(unit.valid_until)}` : "",
      ]),
    ].filter(Boolean).join("\n");
    drawTableRow([
      dateLabel(snapshot.date),
      renderText(item.material) || "Material",
      `${Number(item.quantity) || 0} ${renderText(item.unit) || "un."}`,
      renderText(item.size) || "—",
      compliance || "—",
      "ASSINADO NESTA FICHA",
    ]);
  }

  if (snapshot.notes) {
    y -= 8;
    page.drawText("OBSERVAÇÕES", { x: margin, y, size: 7, font: bold, color: ink });
    y -= 11;
    y -= drawWrapped(String(snapshot.notes), margin, y, width, 7, regular, ink, 9) + 4;
  }

  const isDsx = normalizeName(snapshot.organization_name).includes("dsx");
  const address = snapshot.organization_address || (isDsx ? "Rua Harrison de Figueiredo, 132, Jd. Sta. Maria, 79833-552, Dourados-MS" : "");
  const phone = snapshot.organization_phone || (isDsx ? "+55 67 3425-2324" : "");
  const website = isDsx ? "www.dsxenergia.com.br" : "";
  const footer = [snapshot.organization_cnpj ? `CNPJ ${snapshot.organization_cnpj}` : "", address, phone, website].filter(Boolean).join("  |  ");
  for (const [index, currentPage] of document.getPages().entries()) {
    currentPage.drawLine({ start: { x: margin, y: 38 }, end: { x: pageSize[0] - margin, y: 38 }, thickness: 2.5, color: gold });
    if (footer) currentPage.drawText(pdfText(footer), { x: margin, y: 25, size: 6.1, font: regular, color: muted, maxWidth: width });
    currentPage.drawText(pdfText(`Registro ${linkId} · ${index + 1}/${document.getPageCount()} · assinatura por link de uso único; não utiliza certificado ICP-Brasil.`), { x: margin, y: 13, size: 5.5, font: regular, color: muted, maxWidth: width });
  }
  return document.save();
}

async function createSignedPdf(snapshot: Snapshot, signatureBytes: Uint8Array, signerName: string, signerCpf: string, signedAt: Date, linkId: string) {
  if (snapshot.pre_delivery_signature) return createPreDeliverySignedPdf(snapshot, signatureBytes, signerName, signerCpf, signedAt, linkId);
  const document = await PDFDocument.create();
  document.setTitle(`${snapshot.pre_delivery_signature ? "Recibo de entrega e responsabilidade" : snapshot.type === "delivery" ? "Termo de entrega" : "Termo de devolução"} - ${snapshot.employee_name}`);
  document.setSubject(`Assinatura eletrônica por link de uso único. Registro ${linkId}.`);
  document.setCreator("EPIS+ Gestão inteligente");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const signature = await document.embedPng(signatureBytes);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 46;
  let page = document.addPage(pageSize);
  let y = 794;

  function newPage() {
    page = document.addPage(pageSize);
    y = 794;
  }

  function line(text: string, size = 10, isBold = false, gap = 14) {
    const font = isBold ? bold : regular;
    const clean = renderText(text);
    const words = clean.split(" ").filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > pageSize[0] - margin * 2 && current) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
    for (const value of lines) {
      if (y < 58) newPage();
      page.drawText(value, { x: margin, y, size, font, color: rgb(0.17, 0.22, 0.31), maxWidth: pageSize[0] - margin * 2 });
      y -= gap;
    }
  }

  try {
    if (snapshot.organization_id && snapshot.organization_logo_url) {
      const logoUrl = new URL(snapshot.organization_logo_url);
      const supabaseOrigin = new URL(supabaseUrl).origin;
      const expectedPath = `/storage/v1/object/public/organization-logos/${snapshot.organization_id}/logo`;
      if (logoUrl.origin === supabaseOrigin && logoUrl.pathname === expectedPath) {
        const { data: logo, error: logoError } = await admin.storage.from("organization-logos").download(`${snapshot.organization_id}/logo`);
        if (!logoError && logo && logo.size <= 2 * 1024 * 1024) {
          const bytes = new Uint8Array(await logo.arrayBuffer());
          const mimeType = logo.type.split(";")[0].trim().toLowerCase();
          const embeddedLogo = mimeType === "image/png" ? await document.embedPng(bytes) : mimeType === "image/jpeg" ? await document.embedJpg(bytes) : null;
          if (embeddedLogo) {
            const scale = Math.min(42 / embeddedLogo.width, 42 / embeddedLogo.height);
            const width = embeddedLogo.width * scale;
            const height = embeddedLogo.height * scale;
            page.drawImage(embeddedLogo, { x: (pageSize[0] - width) / 2, y: y - 42, width, height });
            y -= 48;
          }
        }
      }
    }
  } catch { /* Logo indisponível não deve impedir a assinatura do recibo. */ }

  line(snapshot.organization_name, 16, true, 23);
  line(snapshot.pre_delivery_signature ? "RECIBO DE ENTREGA E RESPONSABILIDADE SOBRE EPI/EPC" : snapshot.type === "delivery" ? "TERMO DE ENTREGA DE MATERIAIS" : "TERMO DE DEVOLUÇÃO DE MATERIAIS", 11, true, 20);
  const organizationDetails = [snapshot.organization_cnpj ? `CNPJ ${snapshot.organization_cnpj}` : "", snapshot.organization_address || "", snapshot.organization_phone || ""].filter(Boolean).join(" · ");
  if (organizationDetails) line(organizationDetails, 8, false, 11);
  page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: pageSize[0] - margin, y: y + 3 }, thickness: 0.7, color: rgb(0.82, 0.85, 0.89) });
  y -= 12;
  line(`Colaborador: ${snapshot.employee_name}`, 10, true);
  if (snapshot.employee_registration) line(`Matrícula: ${snapshot.employee_registration}`);
  if (snapshot.employee_function) line(`Cargo / função: ${snapshot.employee_function}`);
  if (snapshot.employee_department) line(`Setor: ${snapshot.employee_department}`);
  if (snapshot.employee_admission_date) line(`Data de admissão: ${dateLabel(snapshot.employee_admission_date)}`);
  if (snapshot.employee_termination_date) line(`Data de desligamento: ${dateLabel(snapshot.employee_termination_date)}`);
  line(`Data: ${dateLabel(snapshot.date)}    Motivo: ${formatReason(snapshot.reason)}`);
  y -= 8;
  line(snapshot.pre_delivery_signature ? "Materiais recebidos nesta entrega" : snapshot.type === "delivery" ? "Materiais entregues" : "Materiais devolvidos", 11, true, 18);

  for (const value of snapshot.items) {
    const item = object(value);
    const size = renderText(item.size);
    const title = `${Number(item.quantity) || 0} ${renderText(item.unit) || "un."} - ${renderText(item.material) || "Material"}${size ? ` - Tamanho ${size}` : ""}`;
    line(title, 10, true, 14);
    if (snapshot.type === "delivery") {
      if (item.code) line(`Código: ${renderText(item.code)}`, 8, false, 11);
      if (item.expected_replacement_at) line(`Previsão de troca: ${dateLabel(item.expected_replacement_at)}`, 8, false, 11);
      if (item.ca_number) line(`CA: ${renderText(item.ca_number)}${item.ca_expires_at ? ` - validade ${dateLabel(item.ca_expires_at)}` : ""}`, 8, false, 11);
      const units = Array.isArray(item.units) ? item.units.map(object) : [];
      for (const unit of units) {
        const details = [
          unit.identifier ? `Identificação ${renderText(unit.identifier)}` : "",
          unit.test_number ? `ensaio ${renderText(unit.test_number)}` : "",
          unit.test_report_number ? `laudo ${renderText(unit.test_report_number)}` : "",
          unit.test_performed_at ? `realizado em ${dateLabel(unit.test_performed_at)}` : "",
          unit.test_expires_at ? `válido até ${dateLabel(unit.test_expires_at)}` : unit.valid_until ? `válido até ${dateLabel(unit.valid_until)}` : "",
          unit.ca_number ? `CA ${renderText(unit.ca_number)}` : "",
          unit.ca_expires_at ? `CA válido até ${dateLabel(unit.ca_expires_at)}` : "",
        ].filter(Boolean).join(" - ");
        if (details) line(details, 8, false, 11);
      }
    } else {
      if (item.condition) line(`Condição: ${conditionLabels[String(item.condition)] ?? renderText(item.condition)} - Destino: ${destinationLabels[String(item.destination)] ?? renderText(item.destination)}`, 8, false, 11);
      const incident = incidentLabels[String(item.incident_type)] ?? renderText(item.incident_type);
      if (incident && incident !== incidentLabels.normal) line(`Ocorrência: ${incident}${item.incident_description ? ` - ${renderText(item.incident_description)}` : ""}`, 8, false, 11);
      if (item.deduction_requested === true) line(`Solicitação de análise: ${item.deduction_amount ? `R$ ${Number(item.deduction_amount).toFixed(2)}` : "valor a avaliar"}. Nenhum desconto é aplicado automaticamente.`, 8, false, 11);
    }
    y -= 5;
  }

  if (snapshot.notes) {
    y -= 4;
    line("Observações", 9, true);
    line(String(snapshot.notes), 8, false, 11);
  }
  y -= 7;
  const statement = snapshot.pre_delivery_signature
    ? "Declaro que conferi e recebi os materiais relacionados nesta ficha. Comprometo-me a utilizá-los somente para a finalidade a que se destinam, seguir as orientações recebidas, cuidar da guarda e conservação, comunicar prontamente dano, alteração ou extravio e devolvê-los quando solicitado, na substituição, transferência ou desligamento, conforme os procedimentos aplicáveis. Estou ciente de que perda, extravio, dano ou mau uso poderá ser apurado individualmente; qualquer ressarcimento ou desconto dependerá da apuração e dos requisitos legais aplicáveis, não decorrendo automaticamente desta assinatura."
    : snapshot.type === "delivery"
      ? "Declaro que conferi e recebi os materiais relacionados nesta ficha. Comprometo-me a utilizá-los somente para a finalidade a que se destinam, seguir as orientações recebidas, cuidar da guarda e conservação, comunicar prontamente dano, alteração ou extravio e devolvê-los quando solicitado, na substituição, transferência ou desligamento, conforme os procedimentos aplicáveis da NR-06. Estou ciente de que eventuais danos ou perdas serão apurados individualmente; qualquer ressarcimento ou desconto dependerá da apuração e dos requisitos legais aplicáveis, não decorrendo automaticamente desta assinatura."
    : "Declaro que acompanhei a devolução dos materiais relacionados e conferi as informações desta ficha. Eventual ocorrência ou solicitação de desconto será analisada separadamente e não implica desconto automático.";
  line(statement, 9, false, 14);
  y -= 10;
  if (y < 178) newPage();
  page.drawLine({ start: { x: margin, y: y - 62 }, end: { x: margin + 238, y: y - 62 }, thickness: 0.8, color: rgb(0.4, 0.45, 0.53) });
  const imageScale = Math.min(220 / signature.width, 58 / signature.height);
  const imageWidth = signature.width * imageScale;
  const imageHeight = signature.height * imageScale;
  page.drawImage(signature, { x: margin + (238 - imageWidth) / 2, y: y - imageHeight - 58, width: imageWidth, height: imageHeight });
  page.drawText("Assinatura eletrônica do colaborador", { x: margin, y: y - 77, size: 8, font: regular, color: rgb(0.38, 0.43, 0.5) });
  page.drawText(signerName, { x: margin, y: y - 92, size: 9, font: bold, color: rgb(0.17, 0.22, 0.31) });
  page.drawText(`CPF ${maskedCpf(signerCpf)}`, { x: margin, y: y - 106, size: 8, font: regular, color: rgb(0.38, 0.43, 0.5) });
  page.drawText(`Assinado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(signedAt)}`, { x: margin, y: y - 119, size: 8, font: regular, color: rgb(0.38, 0.43, 0.5) });
  page.drawText(`Responsável que enviou o link: ${renderText(snapshot.responsible_name)}`, { x: margin, y: y - 134, size: 8, font: regular, color: rgb(0.38, 0.43, 0.5), maxWidth: pageSize[0] - margin * 2 });
  page.drawText(`Registro EPIS+ ${linkId} - assinatura eletrônica por link de uso único; não é certificado ICP-Brasil.`, { x: margin, y: y - 149, size: 7, font: regular, color: rgb(0.45, 0.49, 0.55), maxWidth: pageSize[0] - margin * 2 });
  return document.save();
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const serviceKey = (secretKeys ? JSON.parse(secretKeys).default : "") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origem não autorizada." }, 403, origin);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return respond({ error: "Método não permitido." }, 405, origin);
  if (!supabaseUrl || !serviceKey) return respond({ error: "Configuração do serviço indisponível." }, 500, origin);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes) return respond({ error: "Assinatura excede o limite permitido." }, 413, origin);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowAttempt(ip)) return respond({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429, origin);

  let body: Record<string, unknown>;
  try {
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).length > maxRequestBytes) return respond({ error: "Assinatura excede o limite permitido." }, 413, origin);
    body = object(JSON.parse(bodyText));
  } catch { return respond({ error: "Solicitação inválida." }, 400, origin); }
  const action = typeof body.action === "string" ? body.action : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!isToken(token)) return respond({ error: "Este link é inválido, expirou ou já foi utilizado." }, 404, origin);
  const tokenHash = await sha256(token);
  const { data: link, error: linkError } = await admin.from("term_signature_links")
    .select("id,organization_id,employee_id,delivery_id,return_id,pending_delivery_id,expires_at,used_at,revoked_at,failed_attempts,locked_until,accessed_at,snapshot,snapshot_hash")
    .eq("token_hash", tokenHash).maybeSingle();
  if (linkError || !link) return respond({ error: "Este link é inválido, expirou ou já foi utilizado." }, 404, origin);

  const validUntil = new Date(link.expires_at).getTime();
  if (link.used_at || link.revoked_at || !Number.isFinite(validUntil) || validUntil <= Date.now()) return respond({ error: "Este link é inválido, expirou ou já foi utilizado." }, 410, origin);
  if (link.locked_until && new Date(link.locked_until).getTime() > Date.now()) return respond({ error: "O link foi bloqueado temporariamente após tentativas inválidas. Solicite outro ao responsável." }, 423, origin);

  const snapshot = object(link.snapshot) as Snapshot;
  if (!snapshot || snapshot.version !== 1 || !(snapshot.type === "delivery" || snapshot.type === "return") || await sha256(stableJson(snapshot)) !== link.snapshot_hash) {
    return respond({ error: "Não foi possível validar a integridade desta ficha. Solicite um novo link." }, 409, origin);
  }

  if (action === "preview") {
    if (link.pending_delivery_id) {
      const { data: pending, error: pendingError } = await admin.from("pending_deliveries").select("status").eq("id", link.pending_delivery_id).eq("organization_id", link.organization_id).maybeSingle();
      if (pendingError || !pending || pending.status !== "pending_signature") return respond({ error: "Esta ficha não está mais pendente de assinatura." }, 410, origin);
    } else {
      const table = link.delivery_id ? "deliveries" : "returns";
      const recordId = link.delivery_id ?? link.return_id;
      const { data: transaction, error: transactionError } = await admin.from(table).select("term_signed_at").eq("id", recordId).eq("organization_id", link.organization_id).maybeSingle();
      if (transactionError || !transaction || transaction.term_signed_at) return respond({ error: "Esta ficha não está mais pendente de assinatura." }, 410, origin);
    }
    if (!link.accessed_at) await admin.from("term_signature_links").update({ accessed_at: new Date().toISOString() }).eq("id", link.id).is("accessed_at", null);
    return respond({ snapshot, expires_at: link.expires_at }, 200, origin);
  }

  if (action !== "complete") return respond({ error: "Ação inválida." }, 400, origin);
  const signerName = typeof body.signer_name === "string" ? body.signer_name.trim().replace(/\s+/g, " ") : "";
  const signerCpf = digits(body.signer_cpf);
  const signatureDataUrl = typeof body.signature_data_url === "string" ? body.signature_data_url : "";
  if (body.accepted !== true || !signerName || signerName.length > 160 || signerCpf.length !== 11 || signatureDataUrl.length > 700_000) {
    return respond({ error: "Confira o nome, CPF, aceite e assinatura antes de continuar." }, 400, origin);
  }
  const match = signatureDataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return respond({ error: "A assinatura não está em um formato válido. Limpe o campo e assine novamente." }, 400, origin);
  let signatureBytes: Uint8Array;
  try { signatureBytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)); } catch { return respond({ error: "A assinatura está inválida." }, 400, origin); }
  const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signatureBytes.length < 24 || signatureBytes.length > 512_000 || !pngHeader.every((byte, index) => signatureBytes[index] === byte)) return respond({ error: "A assinatura excede o limite ou está inválida." }, 400, origin);
  const signatureDimensions = new DataView(signatureBytes.buffer, signatureBytes.byteOffset, signatureBytes.byteLength);
  const signatureWidth = signatureDimensions.getUint32(16);
  const signatureHeight = signatureDimensions.getUint32(20);
  if (signatureWidth === 0 || signatureWidth > 1600 || signatureHeight === 0 || signatureHeight > 600) return respond({ error: "As dimensões da imagem de assinatura são inválidas." }, 400, origin);

  const { data: employee, error: employeeError } = await admin.from("employees").select("full_name,cpf").eq("id", link.employee_id).eq("organization_id", link.organization_id).maybeSingle();
  if (employeeError || !employee) return respond({ error: "Não foi possível validar o colaborador. Solicite um novo link." }, 409, origin);
  if (digits(employee.cpf) !== signerCpf || normalizeName(signerName) !== normalizeName(String(employee.full_name))) {
    const { data: attemptsCount } = await admin.rpc("record_term_signature_failure", { p_link_id: link.id });
    if (Number(attemptsCount ?? 0) >= 5) return respond({ error: "Muitas tentativas de validação. O link foi bloqueado por 15 minutos; solicite outro ao responsável." }, 429, origin);
    return respond({ error: "O nome completo ou CPF não corresponde ao cadastro do colaborador." }, 400, origin);
  }

  const signedAt = new Date();
  const recordId = String(link.pending_delivery_id ?? link.delivery_id ?? link.return_id);
  const path = `${link.organization_id}/${recordId}/whatsapp-signature-${link.id}-${crypto.randomUUID()}.pdf`;
  let pdfBytes: Uint8Array;
  try { pdfBytes = await createSignedPdf(snapshot, signatureBytes, String(employee.full_name), signerCpf, signedAt, String(link.id)); }
  catch (error) {
    console.error("Delivery signature PDF preparation failed", { message: error instanceof Error ? error.message.slice(0, 240) : "unknown PDF generation error" });
    return respond({ error: "Não foi possível preparar o documento. Tente novamente ou solicite um novo link." }, 500, origin);
  }

  const { error: uploadError } = await admin.storage.from("delivery-terms").upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) return respond({ error: "Não foi possível salvar o documento assinado. Tente novamente." }, 500, origin);

  const { data: completedAt, error: completeError } = await admin.rpc("complete_employee_term_signature", {
    p_link_id: link.id,
    p_signature_file_path: path,
    p_signer_name: String(employee.full_name),
    p_signer_cpf: signerCpf,
  });
  if (completeError || !completedAt) {
    await admin.storage.from("delivery-terms").remove([path]);
    const completionMessage = completeError?.message ?? "A ficha já foi assinada ou o link deixou de ser válido.";
    console.error("Delivery signature finalization failed", { code: completeError?.code ?? null, message: completionMessage.slice(0, 240), link_id: link.id });
    if (/lote.*saldo|saldo.*lote|estoque insuficiente|plano de lotes/i.test(completionMessage)) {
      return respond({ error: "O saldo de um dos lotes mudou desde a criação da ficha. Nenhuma entrega foi registrada; solicite uma nova ficha ao responsável." }, 409, origin);
    }
    if (/link de assinatura inválido|link.*expirado|link.*utilizado|ficha.*não está mais pendente|ficha.*já foi assinada/i.test(completionMessage)) {
      return respond({ error: "Esta ficha não está mais disponível para assinatura. Se você ainda não assinou, solicite ao responsável um novo link." }, 410, origin);
    }
    return respond({ error: "Não foi possível registrar a assinatura agora. Ela não foi salva e o estoque não foi baixado. Tente novamente em instantes; se o erro continuar, avise o responsável pelo controle." }, 500, origin);
  }

  return respond({ success: true, signed_at: completedAt }, 200, origin);
});
