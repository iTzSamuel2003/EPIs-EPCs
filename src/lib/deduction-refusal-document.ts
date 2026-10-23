export type RefusalWitnessRecord = {
  id: string;
  employee_id: string;
  employee_name_snapshot: string;
  employee_registration_snapshot: string;
  employee_job_title_snapshot: string | null;
  signature_data_url: string | null;
  signed_at: string | null;
  link?: { id: string; refusal_witness_id: string; expires_at: string; used_at: string | null; revoked_at: string | null; signature_file_path: string | null };
};

export type RefusalCaseSnapshot = {
  case_id: string;
  return_id: string;
  organization_id: string;
  organization_name: string;
  organization_cnpj: string | null;
  organization_address: string | null;
  organization_phone: string | null;
  organization_logo_url: string | null;
  employee_name: string;
  employee_registration: string | null;
  employee_job_title: string | null;
  employee_department: string | null;
  return_date: string;
  return_reason: string;
  return_notes: string | null;
  approved_amount: number;
  review_notes: string | null;
  items: Array<{
    material_name: string;
    quantity: number;
    unit: string;
    incident_type: string;
    incident_description: string | null;
    condition: string;
    destination: string;
  }>;
};

export type ReturnDeductionRefusalRecord = {
  id: string;
  organization_id: string;
  deduction_case_id: string;
  return_id: string;
  employee_id: string;
  outcome: "employee_refused" | "employee_absent" | "unable_to_present";
  presentation_channel: "in_person" | "printed_term" | "digital_link";
  employee_statement: string | null;
  signature_link_id: string | null;
  case_snapshot: RefusalCaseSnapshot;
  presented_term_snapshot: Record<string, unknown>;
  recorded_by_name: string;
  recorded_at: string;
  witnesses: RefusalWitnessRecord[];
};

const outcomeLabels: Record<ReturnDeductionRefusalRecord["outcome"], string> = {
  employee_refused: "O colaborador recusou expressamente assinar",
  employee_absent: "O colaborador estava ausente",
  unable_to_present: "Não foi possível concluir a apresentação",
};

const channelLabels: Record<ReturnDeductionRefusalRecord["presentation_channel"], string> = {
  in_person: "Apresentação presencial",
  printed_term: "Termo impresso apresentado",
  digital_link: "Link individual apresentado",
};

const incidentLabels: Record<string, string> = {
  misuse: "Mau uso", loss: "Extravio / perda", theft: "Furto", damage: "Dano", other: "Outra ocorrência", normal: "Devolução normal",
};

const conditionLabels: Record<string, string> = { good: "Bom", used: "Usado", damaged: "Danificado", unusable: "Inutilizado" };
const destinationLabels: Record<string, string> = { not_returned: "Não devolvido", disposal: "Descarte", maintenance: "Manutenção", stock: "Retorno ao estoque" };
const reasonLabels: Record<string, string> = { replacement: "Substituição", termination: "Desligamento", role_change: "Alteração de função", damaged: "Equipamento danificado", other: "Outro" };

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function formatDate(value?: string | null) {
  if (!value) return "Não informada";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "Não informada" : parsed.toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" });
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Não informada" : parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" });
}

function formatMoney(value: number) {
  return `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeOrganizationLogo(snapshot: RefusalCaseSnapshot) {
  try {
    const logo = new URL(snapshot.organization_logo_url || "");
    const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
    return logo.origin === supabaseOrigin && logo.pathname === `/storage/v1/object/public/organization-logos/${snapshot.organization_id}/logo` ? logo.href : "";
  } catch {
    return "";
  }
}

export function printDeductionRefusalRecord(record: ReturnDeductionRefusalRecord) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Permita a abertura de janelas para imprimir ou salvar o registro.");
  printWindow.opener = null;

  const snapshot = record.case_snapshot;
  const rows = snapshot.items.map((item) => `<tr>
    <td>${escapeHtml(item.material_name)}</td>
    <td>${escapeHtml(`${item.quantity} ${item.unit}`)}</td>
    <td>${escapeHtml([incidentLabels[item.incident_type] || item.incident_type, item.incident_description].filter(Boolean).join(" · "))}</td>
    <td>${escapeHtml([conditionLabels[item.condition] || item.condition, destinationLabels[item.destination] || item.destination].filter(Boolean).join(" · "))}</td>
  </tr>`).join("");
  const witnesses = record.witnesses.map((witness) => `<section class="witness">
    ${witness.signature_data_url ? `<img src="${escapeHtml(witness.signature_data_url)}" alt="Assinatura digital da testemunha">` : `<div class="pending">ASSINATURA PENDENTE</div>`}
    <div class="line"><strong>${escapeHtml(witness.employee_name_snapshot)}</strong><br>Matrícula ${escapeHtml(witness.employee_registration_snapshot)}${witness.employee_job_title_snapshot ? ` · ${escapeHtml(witness.employee_job_title_snapshot)}` : ""}<br>Testemunha da apresentação — ${witness.signed_at ? `assinou em ${escapeHtml(formatDateTime(witness.signed_at))}` : "aguardando assinatura individual"}</div>
  </section>`).join("");
  const logo = safeOrganizationLogo(snapshot);
  const contact = [snapshot.organization_cnpj ? `CNPJ ${snapshot.organization_cnpj}` : "", snapshot.organization_address, snapshot.organization_phone].filter(Boolean).join(" · ");
  const outcomeText = outcomeLabels[record.outcome];
  const noAuthorization = "Este documento registra exclusivamente a apresentação e o fato presenciado. Não é assinatura, anuência, reconhecimento de dívida ou autorização de desconto pelo colaborador.";
  const witnessStatement = record.witnesses.every((witness) => Boolean(witness.signed_at))
    ? "As testemunhas declararam ter presenciado a apresentação. Suas assinaturas confirmam somente o relato que observaram; não substituem a assinatura do colaborador e não autorizam desconto em folha."
    : "As testemunhas foram indicadas para confirmar o que presenciaram. As assinaturas individuais estão pendentes; enquanto não assinadas, este registro não representa declaração da testemunha.";

  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Registro de apresentação — ${escapeHtml(snapshot.employee_name)}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#17233c;font:11px Arial,sans-serif}.head{background:#fffef4;border-bottom:5px solid #d1c900;padding:14px 0 12px;display:flex;justify-content:space-between;align-items:center}.head h1{font-size:16px;margin:0 0 7px}.head p{font-size:9px;margin:0;color:#596983}.head img{max-width:135px;max-height:55px;object-fit:contain}.notice{border:1px solid #aeb4bf;border-left:4px solid #d1c900;background:#fafaf7;padding:10px 12px;margin:16px 0;line-height:1.5}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:13px 16px;padding:16px 0}.meta small{display:block;color:#7b879f;font-size:8px;font-weight:bold;margin-bottom:4px}.meta b{font-size:10px}h2{font-size:12px;margin:18px 0 8px}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:9px}th{background:#f2f0cb;text-align:left}td,th{border:1px solid #aeb4bf;padding:7px;vertical-align:top}.statement{padding:10px;border:1px solid #dfe4ed;background:#fafbfe;line-height:1.5}.witnesses{display:grid;grid-template-columns:repeat(${record.witnesses.length},1fr);gap:20px;margin-top:24px}.witness{min-width:0}.witness img{display:block;width:100%;height:70px;object-fit:contain;object-position:center bottom;border-bottom:1px solid #536078}.pending{height:70px;border-bottom:1px solid #536078;display:grid;place-items:center;color:#c2573b;font-size:8px;font-weight:bold}.line{padding-top:7px;font-size:9px;line-height:1.45}.fine{font-size:8px;color:#596983;line-height:1.45;margin-top:15px}.foot{border-top:3px solid #d1c900;margin-top:24px;padding-top:9px;text-align:center;font-size:8px;color:#596983}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><header class="head"><div><h1>${escapeHtml(snapshot.organization_name)}</h1><p>REGISTRO COMPLEMENTAR DE APRESENTAÇÃO E NÃO ASSINATURA</p></div>${logo ? `<img src="${escapeHtml(logo)}" alt="Logo da organização">` : ""}</header>
    <section class="meta"><div><small>COLABORADOR</small><b>${escapeHtml(snapshot.employee_name)}</b></div><div><small>MATRÍCULA</small><b>${escapeHtml(snapshot.employee_registration || "Não informada")}</b></div><div><small>DATA DA DEVOLUÇÃO</small><b>${escapeHtml(formatDate(snapshot.return_date))}</b></div><div><small>CARGO / FUNÇÃO</small><b>${escapeHtml(snapshot.employee_job_title || "Não informado")}</b></div><div><small>SETOR</small><b>${escapeHtml(snapshot.employee_department || "Não informado")}</b></div><div><small>MOTIVO DA DEVOLUÇÃO</small><b>${escapeHtml(reasonLabels[snapshot.return_reason] || snapshot.return_reason)}</b></div><div><small>RESULTADO</small><b>${escapeHtml(outcomeText)}</b></div><div><small>FORMA DE APRESENTAÇÃO</small><b>${escapeHtml(channelLabels[record.presentation_channel])}</b></div><div><small>VALOR QUE CONSTAVA NA MINUTA</small><b>${escapeHtml(formatMoney(snapshot.approved_amount))}</b></div><div><small>REGISTRADO EM</small><b>${escapeHtml(formatDateTime(record.recorded_at))}</b></div><div><small>RESPONSÁVEL PELO REGISTRO</small><b>${escapeHtml(record.recorded_by_name)}</b></div><div><small>Nº DA DEVOLUÇÃO</small><b>${escapeHtml(snapshot.return_id.slice(0, 8).toLocaleUpperCase("pt-BR"))}</b></div></section>
    <div class="notice"><strong>DECLARAÇÃO SOBRE O REGISTRO</strong><br>${escapeHtml(noAuthorization)} ${record.outcome === "employee_refused" ? "A recusa foi registrada sem assinatura em nome do colaborador." : "O registro descreve que não houve assinatura nesta tentativa, sem afirmar recusa expressa quando ela não foi constatada."}</div>
    ${record.employee_statement ? `<div class="statement"><strong>Relato atribuído ao colaborador:</strong> ${escapeHtml(record.employee_statement)}<br><small>Texto registrado pelo responsável; não representa confissão ou reconhecimento de dívida.</small></div>` : ""}
    <h2>ITENS DA OCORRÊNCIA REGISTRADA NA DEVOLUÇÃO</h2><table><thead><tr><th>MATERIAL</th><th>QUANTIDADE</th><th>OCORRÊNCIA</th><th>CONDIÇÃO / DESTINO</th></tr></thead><tbody>${rows || `<tr><td colspan="4">Consulte a devolução vinculada ${escapeHtml(snapshot.return_id.slice(0, 8).toLocaleUpperCase("pt-BR"))} para os itens da ocorrência.</td></tr>`}</tbody></table>
    <p class="fine"><strong>Testemunhas:</strong> ${escapeHtml(witnessStatement)}</p><div class="witnesses">${witnesses}</div>
    <p class="fine">Caso nº ${escapeHtml(record.deduction_case_id)} · Devolução nº ${escapeHtml(record.return_id)} · Registrado por ${escapeHtml(record.recorded_by_name)} em ${escapeHtml(formatDateTime(record.recorded_at))}. Qualquer decisão sobre desconto deve ser analisada separadamente pelo RH, conforme a legislação e as circunstâncias do caso.</p>
    <footer class="foot">${escapeHtml(contact || snapshot.organization_name)} · REGISTRO INFORMATIVO — NÃO É AUTORIZAÇÃO DE DESCONTO</footer>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script></body></html>`);
  printWindow.document.close();
}
