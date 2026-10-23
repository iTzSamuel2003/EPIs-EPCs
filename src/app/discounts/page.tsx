"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Download, ExternalLink, FileText, LoaderCircle, RefreshCw, RotateCcw, Search, ShieldAlert, X } from "lucide-react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { DiscountRefusalModal, type RefusalOutcome } from "@/components/discount-refusal-modal";
import { printDeductionRefusalRecord, type ReturnDeductionRefusalRecord, type RefusalWitnessRecord } from "@/lib/deduction-refusal-document";

type Employee = { full_name: string; registration: string | null; job_title?: string | null; function_name?: string | null; department?: string | null; admission_date?: string | null };
type UnitDetails = { ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; test_expires_at: string | null; valid_until: string | null };
type ReturnItem = {
  id: string; quantity: number; deduction_requested: boolean; incident_type: string;
  incident_description: string | null; equipment_condition: string | null; destination: string;
  material: { name: string; unit: string } | null;
  delivery_item: { variant: { name: string; size: string | null } | null; delivery: { delivered_at: string } | null;
    lot: UnitDetails & { lot_number: string | null } | null; units: UnitDetails[] | null } | null;
};
type ReturnData = { returned_at: string; reason: string; return_items: ReturnItem[] };
type DeductionSnapshot = {
  type: "deduction"; organization_id: string; organization_name: string; organization_logo_url?: string | null;
  organization_cnpj?: string | null; organization_address?: string | null; organization_phone?: string | null;
  responsible_name: string; employee_name: string; employee_registration: string | null; employee_function?: string | null;
  employee_department?: string | null; employee_admission_date?: string | null; employee_termination_date?: string | null; date: string; reason: string;
  notes: string | null; approved_amount: number; items: Array<Record<string, unknown>>;
};
type DeductionCase = {
  id: string; organization_id: string; return_id: string; employee_id: string;
  approved_amount: number | null; status: "pending_review" | "approved" | "rejected" | "signed"; review_notes: string | null;
  reviewed_at: string | null; created_at: string; signed_at: string | null; signed_term_path: string | null;
  employee: Employee | Employee[] | null; return: ReturnData | ReturnData[] | null;
};
type SignatureLink = { id: string; deduction_case_id: string; expires_at: string; used_at: string | null; revoked_at: string | null; snapshot: DeductionSnapshot };
type LinkResult = { url: string; expires_at: string; snapshot: DeductionSnapshot; error?: string };
type RefusalRecordRow = Omit<ReturnDeductionRefusalRecord, "witnesses">;
type RefusalWitnessRow = RefusalWitnessRecord & { refusal_record_id: string };

const incidentLabels: Record<string, string> = { misuse: "Mau uso", loss: "Extravio / perda", theft: "Furto", damage: "Dano", other: "Outra ocorrência" };
const destinationLabels: Record<string, string> = { not_returned: "Não devolvido", disposal: "Descarte", maintenance: "Manutenção", stock: "Retorno ao estoque" };
const conditionLabels: Record<string, string> = { good: "Bom", used: "Usado", damaged: "Danificado", unusable: "Inutilizado" };
const statusLabels: Record<DeductionCase["status"], string> = { pending_review: "Aguardando análise do RH", approved: "Aprovado · aguardando assinatura", rejected: "Não aprovado", signed: "Assinada · pendente de lançamento em folha" };
const refusalOutcomeLabels: Record<RefusalOutcome, string> = { employee_refused: "Recusa expressa", employee_absent: "Colaborador ausente", unable_to_present: "Apresentação não concluída" };
const presentationChannelLabels: Record<ReturnDeductionRefusalRecord["presentation_channel"], string> = { in_person: "Presencial", printed_term: "Termo impresso", digital_link: "Link individual" };
const formatMoney = (value: number | null | undefined) => `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
const one = <T,>(value: T | T[] | null | undefined): T | null => Array.isArray(value) ? value[0] ?? null : value ?? null;

function itemCompliance(item: ReturnItem) {
  const lot = item.delivery_item?.lot;
  const units = item.delivery_item?.units ?? [];
  const values = [
    lot?.ca_number ? `CA ${lot.ca_number}${lot.ca_expires_at ? ` · validade ${formatDate(lot.ca_expires_at)}` : ""}` : "",
    lot?.test_number ? `Ensaio ${lot.test_number}` : "",
    lot?.test_report_number ? `Laudo ${lot.test_report_number}` : "",
    lot?.test_performed_at ? `Realizado ${formatDate(lot.test_performed_at)}` : "",
    lot?.test_expires_at ? `Ensaio válido até ${formatDate(lot.test_expires_at)}` : "",
    ...units.flatMap((unit) => [
      unit.ca_number ? `CA ${unit.ca_number}` : "", unit.test_number ? `Ensaio ${unit.test_number}` : "",
      unit.test_report_number ? `Laudo ${unit.test_report_number}` : "", unit.test_performed_at ? `Realizado ${formatDate(unit.test_performed_at)}` : "",
      unit.test_expires_at || unit.valid_until ? `Ensaio válido até ${formatDate(unit.test_expires_at || unit.valid_until)}` : "",
    ]),
  ].filter(Boolean);
  return [...new Set(values)].join(" · ") || "Sem CA ou ensaio informado no lote";
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function printDraft(snapshot: DeductionSnapshot) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Permita a abertura de janelas para imprimir o termo.");
  printWindow.opener = null;
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
  let logo = "";
  try {
    const logoUrl = new URL(snapshot.organization_logo_url || "");
    if (logoUrl.origin === supabaseOrigin && logoUrl.pathname === `/storage/v1/object/public/organization-logos/${snapshot.organization_id}/logo`) logo = logoUrl.href;
  } catch { /* Logo opcional. */ }
  const rows = snapshot.items.map((value) => {
    const item = value as Record<string, unknown>;
    const lines = [item.ca_number ? `CA ${item.ca_number}` : "", item.ca_expires_at ? `Validade CA ${formatDate(String(item.ca_expires_at))}` : "", item.test_number ? `Ensaio ${item.test_number}` : "", item.test_report_number ? `Laudo ${item.test_report_number}` : "", item.test_performed_at ? `Ensaio realizado ${formatDate(String(item.test_performed_at))}` : "", item.test_expires_at ? `Ensaio válido até ${formatDate(String(item.test_expires_at))}` : "", item.incident_type ? `Ocorrência: ${incidentLabels[String(item.incident_type)] || item.incident_type}` : "", item.incident_description ? `Descrição: ${item.incident_description}` : ""].filter(Boolean);
    const condition = item.condition ? conditionLabels[String(item.condition)] || String(item.condition) : "—";
    const destination = item.destination ? destinationLabels[String(item.destination)] || String(item.destination) : "";
    const conditionAndDestination = [condition !== "—" ? `Condição: ${condition}` : "", destination ? `Destino: ${destination}` : ""].filter(Boolean).join("\n") || "—";
    return `<tr><td>${escapeHtml(formatDate(String(item.delivered_at || snapshot.date)))}</td><td><b>${escapeHtml(item.material)}</b><br>${escapeHtml(item.lot_number ? `Lote ${item.lot_number}` : "")}</td><td>${escapeHtml(`${item.quantity || 0} ${item.unit || "un."}${item.size ? ` · ${item.size}` : ""}`)}</td><td>${escapeHtml(lines.join(" · "))}</td><td>${escapeHtml(conditionAndDestination).replace(/\n/g, "<br>")}</td></tr>`;
  }).join("");
  const address = snapshot.organization_address || (snapshot.organization_name.toLowerCase().includes("dsx") ? "Rua Harrison de Figueiredo, 132, Jd. Sta. Maria, 79833-552, Dourados-MS" : "");
  const phone = snapshot.organization_phone || (snapshot.organization_name.toLowerCase().includes("dsx") ? "+55 67 3425-2324" : "");
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Autorização específica de desconto</title><style>
    @page{size:A4;margin:13mm}*{box-sizing:border-box}body{margin:0;color:#17233c;font:11px Arial,sans-serif}.head{background:#fffef4;border-bottom:5px solid #d1c900;padding:14px 0 12px;display:flex;justify-content:space-between;align-items:center}.head h1{font-size:16px;margin:0 0 8px}.head p{font-size:9px;margin:0;color:#596983}.head img{max-width:135px;max-height:55px;object-fit:contain}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:15px 18px;padding:18px 0}.meta small{display:block;color:#7b879f;font-size:8px;font-weight:bold;margin-bottom:4px}.meta b{font-size:10px}.box{border:1px solid #9da6b6;background:#fafaf7;padding:12px;margin:10px 0;line-height:1.5}.value{background:#f8f6d9;padding:10px;font-size:12px;font-weight:bold;margin:10px 0}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:8px}th{background:#f2f0cb;text-align:left}td,th{border:1px solid #aeb4bf;padding:6px;vertical-align:top}.signature{margin:42px 0 20px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.line{border-top:1px solid #536078;padding-top:8px;font-size:9px}.foot{border-top:3px solid #d1c900;margin-top:28px;padding-top:10px;text-align:center;font-size:8px;color:#596983}.notice{font-size:8px;color:#596983;margin-top:8px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><header class="head"><div><h1>${escapeHtml(snapshot.organization_name.toLocaleUpperCase("pt-BR"))}</h1><p>AUTORIZAÇÃO ESPECÍFICA PARA DESCONTO EM FOLHA</p></div>${logo ? `<img src="${escapeHtml(logo)}" alt="Logo da organização">` : ""}</header>
    <section class="meta"><div><small>MATRÍCULA</small><b>${escapeHtml(snapshot.employee_registration || "Não informada")}</b></div><div><small>COLABORADOR</small><b>${escapeHtml(snapshot.employee_name)}</b></div><div><small>CARGO / FUNÇÃO</small><b>${escapeHtml(snapshot.employee_function || "Não informada")}</b></div><div><small>SETOR</small><b>${escapeHtml(snapshot.employee_department || "Não informado")}</b></div><div><small>DATA DE ADMISSÃO</small><b>${escapeHtml(formatDate(snapshot.employee_admission_date))}</b></div>${snapshot.employee_termination_date ? `<div><small>DATA DE DESLIGAMENTO</small><b>${escapeHtml(formatDate(snapshot.employee_termination_date))}</b></div>` : ""}<div><small>DATA DA OCORRÊNCIA</small><b>${escapeHtml(formatDate(snapshot.date))}</b></div><div><small>RESPONSÁVEL PELA ANÁLISE</small><b>${escapeHtml(snapshot.responsible_name)}</b></div></section>
    <div class="box"><b>DECLARAÇÃO E AUTORIZAÇÃO INDIVIDUAL</b><p>Eu, ${escapeHtml(snapshot.employee_name)}, declaro que recebi as informações sobre a ocorrência e os itens relacionados abaixo. Após análise individual, foi indicado o valor total de <b>${escapeHtml(formatMoney(snapshot.approved_amount))}</b>. Ao assinar, manifesto minha autorização específica para o desconto desse valor, observados os limites e requisitos da legislação aplicável e os procedimentos da empresa. Esta autorização refere-se somente a esta ocorrência e não é genérica para descontos futuros. Ela não substitui o fornecimento ou a reposição de EPI necessário à proteção, e o sistema não realiza lançamento automático em folha.</p>${snapshot.notes ? `<p><b>Justificativa da análise:</b> ${escapeHtml(snapshot.notes)}</p>` : ""}</div>
    <div class="value">VALOR TOTAL AUTORIZADO: ${escapeHtml(formatMoney(snapshot.approved_amount))}</div><h3>ITENS RELACIONADOS À OCORRÊNCIA</h3><table><thead><tr><th>DATA ENTREGA</th><th>MATERIAL</th><th>QUANT. / TAM.</th><th>CA / ENSAIO / OCORRÊNCIA</th><th>CONDIÇÃO / DESTINO</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="signature"><div class="line">${escapeHtml(snapshot.employee_name)}<br>Assinatura do colaborador</div><div class="line">Responsável pelo RH<br>Data: ____ / ____ / ______</div></div><p class="notice">Minuta para conferência. A assinatura eletrônica será registrada em link individual, com identificação e data/hora do servidor. O processamento do desconto deve observar os requisitos legais e os procedimentos da organização.</p>
    <footer class="foot">${escapeHtml([snapshot.organization_cnpj ? `CNPJ ${snapshot.organization_cnpj}` : "", address, phone, snapshot.organization_name.toLowerCase().includes("dsx") ? "www.dsxenergia.com.br" : ""].filter(Boolean).join(" · "))}</footer>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script></body></html>`);
  printWindow.document.close();
}

export default function DiscountsPage() {
  const [cases, setCases] = useState<DeductionCase[]>([]);
  const [links, setLinks] = useState<SignatureLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({});
  const [refusalRecords, setRefusalRecords] = useState<ReturnDeductionRefusalRecord[]>([]);
  const [refusalCase, setRefusalCase] = useState<{ caseId: string; employeeId: string; employeeName: string; returnDate: string; activeLinkId: string | null } | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const [caseResult, linkResult, refusalResult, witnessResult] = await Promise.all([
        supabase.from("return_deduction_cases").select("id,organization_id,return_id,employee_id,approved_amount,status,review_notes,reviewed_at,created_at,signed_at,signed_term_path,employee:employees(full_name,registration,job_title,function_name,department,admission_date),return:returns(returned_at,reason,return_items(id,quantity,deduction_requested,incident_type,incident_description,equipment_condition,destination,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size),delivery:deliveries(delivered_at),lot:material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),units:material_units(unit_identifier,valid_until,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at))))").order("created_at", { ascending: false }).limit(100),
        supabase.from("term_signature_links").select("id,deduction_case_id,expires_at,used_at,revoked_at,snapshot").not("deduction_case_id", "is", null).order("created_at", { ascending: false }).limit(300),
        supabase.from("return_deduction_refusal_records").select("id,organization_id,deduction_case_id,return_id,employee_id,outcome,presentation_channel,employee_statement,signature_link_id,case_snapshot,presented_term_snapshot,recorded_by_name,recorded_at").order("recorded_at", { ascending: false }).limit(500),
        supabase.from("return_deduction_refusal_witnesses").select("id,refusal_record_id,employee_id,employee_name_snapshot,employee_registration_snapshot,employee_job_title_snapshot,signature_data_url,signed_at").order("signed_at", { ascending: false }).limit(1000),
      ]);
      if (caseResult.error) throw caseResult.error;
      if (linkResult.error) throw linkResult.error;
      if (refusalResult.error) throw refusalResult.error;
      if (witnessResult.error) throw witnessResult.error;
      const nextCases = (caseResult.data ?? []) as unknown as DeductionCase[];
      const nextLinks = (linkResult.data ?? []) as unknown as SignatureLink[];
      const nextRefusals = (refusalResult.data ?? []) as unknown as RefusalRecordRow[];
      const nextWitnesses = (witnessResult.data ?? []) as unknown as RefusalWitnessRow[];
      const witnessesByRecord = new Map<string, RefusalWitnessRecord[]>();
      nextWitnesses.forEach((witness) => {
        const list = witnessesByRecord.get(witness.refusal_record_id) ?? [];
        list.push(witness);
        witnessesByRecord.set(witness.refusal_record_id, list);
      });
      setCases(nextCases); setLinks(nextLinks);
      setRefusalRecords(nextRefusals.map((record) => ({ ...record, witnesses: witnessesByRecord.get(record.id) ?? [] })));
      setAmountDraft(Object.fromEntries(nextCases.map((item) => [item.id, item.approved_amount == null ? "" : String(item.approved_amount)])));
      setNotesDraft(Object.fromEntries(nextCases.map((item) => [item.id, item.review_notes ?? ""])));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os casos de desconto.");
    } finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { void loadData(); }, [loadData]);

  const activeLinkByCase = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, SignatureLink>();
    for (const link of links) {
      if (link.used_at || link.revoked_at || new Date(link.expires_at).getTime() <= now) continue;
      if (!map.has(link.deduction_case_id)) map.set(link.deduction_case_id, link);
    }
    return map;
  }, [links]);

  const refusalRecordsByCase = useMemo(() => {
    const map = new Map<string, ReturnDeductionRefusalRecord[]>();
    refusalRecords.forEach((record) => {
      const records = map.get(record.deduction_case_id) ?? [];
      records.push(record);
      map.set(record.deduction_case_id, records);
    });
    return map;
  }, [refusalRecords]);

  const visibleCases = useMemo(() => cases.filter((item) => {
    const employee = one(item.employee);
    const haystack = `${employee?.full_name ?? ""} ${employee?.registration ?? ""} ${one(item.return)?.return_items?.map((entry) => entry.material?.name).join(" ") ?? ""}`.toLocaleLowerCase("pt-BR");
    const matchQuery = haystack.includes(query.toLocaleLowerCase("pt-BR"));
    const matchFilter = filter === "all" || (filter === "pending_review" ? item.status === "pending_review" : filter === "approved" ? item.status === "approved" : filter === "signed" ? item.status === "signed" : item.status === "rejected");
    return matchQuery && matchFilter;
  }), [cases, filter, query]);

  async function reviewCase(item: DeductionCase, decision: "approved" | "rejected") {
    const amount = Number(String(amountDraft[item.id] ?? "").replace(",", "."));
    const note = (notesDraft[item.id] ?? "").trim();
    if (decision === "approved" && (!Number.isFinite(amount) || amount <= 0)) { setFeedback("Informe um valor aprovado maior que zero."); return; }
    if (!note) { setFeedback("Registre a justificativa da análise para continuar."); return; }
    setBusyId(item.id); setFeedback("");
    const { error } = await supabase.rpc("review_return_deduction_case", { p_case_id: item.id, p_decision: decision, p_approved_amount: decision === "approved" ? amount : null, p_review_notes: note || null });
    if (error) setFeedback(error.message || "Não foi possível registrar a análise.");
    else { setFeedback(decision === "approved" ? "Análise aprovada. Agora você pode gerar a autorização para assinatura." : "Caso marcado como não aprovado."); await loadData(); }
    setBusyId("");
  }

  async function createSignatureLink(item: DeductionCase) {
    setBusyId(item.id); setFeedback("");
    const { data, error } = await supabase.functions.invoke("create-term-signature-link", { body: { record_type: "deduction", record_id: item.id } });
    const result = data as LinkResult | null;
    if (error || !result?.url || !result.snapshot) setFeedback(result?.error || error?.message || "Não foi possível gerar o link de assinatura.");
    else {
      setGeneratedLinks((current) => ({ ...current, [item.id]: result.url }));
      setFeedback(`Autorização preparada para ${result.snapshot.employee_name}. O link expira em ${formatDateTime(result.expires_at)}.`);
      await loadData();
    }
    setBusyId("");
  }

  async function cancelSignatureLink(item: DeductionCase) {
    setBusyId(item.id); setFeedback("");
    const { data, error } = await supabase.functions.invoke("create-term-signature-link", { body: { record_type: "deduction", record_id: item.id, action: "cancel" } });
    if (error || !(data as { cancelled?: boolean } | null)?.cancelled) setFeedback(error?.message || "Não foi possível cancelar o link.");
    else { setGeneratedLinks((current) => { const next = { ...current }; delete next[item.id]; return next; }); setFeedback("Link cancelado. O colaborador não poderá mais utilizá-lo."); await loadData(); }
    setBusyId("");
  }

  async function copyLink(item: DeductionCase) {
    const url = generatedLinks[item.id];
    if (!url) { setFeedback("O link não fica armazenado após sair desta tela. Gere outro link para copiá-lo; o anterior será invalidado."); return; }
    try { await navigator.clipboard.writeText(url); setFeedback("Link copiado. Envie ao colaborador pelo canal combinado."); }
    catch { setFeedback("Não foi possível copiar automaticamente. Selecione e copie o link exibido."); }
  }

  async function downloadSignedTerm(item: DeductionCase) {
    if (!item.signed_term_path) return;
    setBusyId(item.id);
    const { data, error } = await supabase.storage.from("delivery-terms").createSignedUrl(item.signed_term_path, 60);
    if (error || !data?.signedUrl) setFeedback("Não foi possível abrir o termo assinado.");
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    setBusyId("");
  }

  function onRefusalSaved(outcome: RefusalOutcome) {
    if (!refusalCase) return;
    const caseId = refusalCase.caseId;
    setRefusalCase(null);
    if (outcome === "employee_refused") {
      setGeneratedLinks((current) => { const next = { ...current }; delete next[caseId]; return next; });
      setFeedback("Recusa registrada na devolução vinculada. Links ativos foram cancelados; o registro da testemunha não é assinatura nem autorização de desconto.");
    } else {
      setFeedback("Tentativa de apresentação registrada na devolução vinculada. O registro não representa assinatura ou autorização de desconto.");
    }
    void loadData();
  }

  const counts = { all: cases.length, pending_review: cases.filter((item) => item.status === "pending_review").length, approved: cases.filter((item) => item.status === "approved").length, signed: cases.filter((item) => item.status === "signed").length };

  return <main className="page-content discounts-page">
    <header className="discounts-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h1>Descontos</h1><p className="subtitle">Analise ocorrências registradas nas devoluções e gerencie autorizações individuais.</p></div><button type="button" className="secondary-button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /> Atualizar</button></header>
    <div className="discounts-notice"><ShieldAlert size={19} /><span>As ocorrências são encaminhadas para análise individual. O RH registra a justificativa e o valor final aprovado e, quando aplicável, obtém autorização específica do colaborador. Nenhum desconto é automático; este fluxo não substitui o fornecimento ou a reposição de EPI necessária à proteção.</span></div>
    <section className="discounts-metrics" aria-label="Resumo dos casos"><button type="button" className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}><small>Todos os casos</small><strong>{counts.all}</strong></button><button type="button" className={filter === "pending_review" ? "selected" : ""} onClick={() => setFilter("pending_review")}><small>Aguardando análise</small><strong>{counts.pending_review}</strong></button><button type="button" className={filter === "approved" ? "selected" : ""} onClick={() => setFilter("approved")}><small>Aprovados</small><strong>{counts.approved}</strong></button><button type="button" className={filter === "signed" ? "selected" : ""} onClick={() => setFilter("signed")}><small>Assinados</small><strong>{counts.signed}</strong></button></section>
    <section className="discounts-toolbar"><label><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar colaborador, matrícula ou material" /></label><select aria-label="Filtrar casos" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos os status</option><option value="pending_review">Aguardando análise</option><option value="approved">Aprovados</option><option value="signed">Assinados</option><option value="rejected">Não aprovados</option></select></section>
    {feedback && <div className="discounts-feedback" role="status">{feedback}</div>}
    {loading ? <div className="discounts-empty"><LoaderCircle className="spin" size={22} /> Carregando casos...</div> : loadError ? <div className="discounts-empty discounts-error"><p>{loadError}</p><button type="button" className="secondary-button" onClick={() => void loadData()}>Tentar novamente</button></div> : visibleCases.length === 0 ? <div className="discounts-empty"><FileText size={24} /><strong>{cases.length ? "Nenhum caso corresponde aos filtros." : "Ainda não há casos para analisar."}</strong><span>As ocorrências marcadas para análise na página Devoluções aparecerão aqui.</span></div> :
      <section className="discounts-case-list" aria-label="Casos de desconto">
        {visibleCases.map((item) => {
          const employee = one(item.employee);
          const returnData = one(item.return);
          const deductionItems = (returnData?.return_items ?? []).filter((entry) => entry.deduction_requested);
          const activeLink = activeLinkByCase.get(item.id);
          const generatedUrl = generatedLinks[item.id];
          const caseRefusalRecords = refusalRecordsByCase.get(item.id) ?? [];
          return <article className="discount-case" key={item.id}>
            <div className="discount-case-header"><div className="discount-case-identity"><span className="discount-case-avatar">{(employee?.full_name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><h2>{employee?.full_name || "Colaborador"}</h2><p>{employee?.registration ? `Matrícula ${employee.registration} · ` : ""}{employee?.job_title || employee?.function_name ? `${employee.job_title || employee.function_name} · ` : ""}{employee?.department ? `${employee.department} · ` : ""}Devolução {formatDate(returnData?.returned_at)} · Recebido em {formatDateTime(item.created_at)}</p></div></div><span className={`discount-status status-${item.status}`}>{statusLabels[item.status]}</span></div>
            <div className="discount-case-summary">{item.approved_amount != null && <div><small>Valor aprovado</small><strong>{formatMoney(item.approved_amount)}</strong></div>}<div><small>Status da análise</small><strong>{item.reviewed_at ? `Analisado ${formatDateTime(item.reviewed_at)}` : "Aguardando RH"}</strong></div></div>
            <div className="discount-items">{deductionItems.map((entry) => {
              const delivery = entry.delivery_item?.delivery;
              const variant = entry.delivery_item?.variant;
              return <div className="discount-item" key={entry.id}><div className="discount-item-title"><strong>{entry.material?.name || "Material"}</strong><span>{entry.quantity} {entry.material?.unit || "un."}{variant?.size || variant?.name ? ` · ${variant.size || variant.name}` : ""}</span></div><p>{incidentLabels[entry.incident_type] || entry.incident_type}{entry.incident_description ? ` · ${entry.incident_description}` : ""} · {destinationLabels[entry.destination] || entry.destination}</p><small>Entrega: {formatDate(delivery?.delivered_at)} · {itemCompliance(entry)}</small></div>;
            })}</div>
            {item.review_notes && <div className="discount-review-note"><strong>Observação do RH:</strong> {item.review_notes}</div>}
            {caseRefusalRecords.length > 0 && <section className="discount-refusal-history" aria-label="Histórico de apresentação e recusa">
              <div className="discount-refusal-history-heading"><div><strong>Histórico de apresentação e não assinatura</strong><small>Complementa a devolução vinculada; não substitui a assinatura do colaborador.</small></div></div>
              {caseRefusalRecords.map((record) => <article className="discount-refusal-entry" key={record.id}>
                <div className="discount-refusal-entry-heading"><div><strong>{refusalOutcomeLabels[record.outcome]}</strong><small>{presentationChannelLabels[record.presentation_channel]} · {formatDateTime(record.recorded_at)} · Registrado por {record.recorded_by_name}</small></div><button type="button" className="secondary-button" onClick={() => { try { printDeductionRefusalRecord(record); } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível imprimir o registro."); } }}><Download size={14} /> Imprimir / salvar PDF</button></div>
                {record.employee_statement && <p><strong>Relato atribuído ao colaborador:</strong> {record.employee_statement}</p>}
                <div className="discount-refusal-witness-list">{record.witnesses.map((witness) => <div className="discount-refusal-witness" key={witness.id}><Image src={witness.signature_data_url} alt={`Assinatura de ${witness.employee_name_snapshot}`} width={74} height={34} unoptimized /><span><strong>{witness.employee_name_snapshot}</strong><small>Matrícula {witness.employee_registration_snapshot}{witness.employee_job_title_snapshot ? ` · ${witness.employee_job_title_snapshot}` : ""}</small></span></div>)}</div>
              </article>)}
            </section>}
            {item.status === "pending_review" && <div className="discount-review-form"><label>Valor aprovado (R$)<input inputMode="decimal" value={amountDraft[item.id] ?? ""} onChange={(event) => setAmountDraft((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="0,00" /></label><label>Justificativa da análise<textarea required value={notesDraft[item.id] ?? ""} onChange={(event) => setNotesDraft((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Registre apuração, evidências consideradas e base de cálculo" rows={2} /></label><div className="discount-actions"><button type="button" className="secondary-button discount-reject" onClick={() => void reviewCase(item, "rejected")} disabled={busyId === item.id}>{busyId === item.id ? <LoaderCircle className="spin" size={15} /> : <X size={15} />} Não aprovar</button><button type="button" className="primary-button" onClick={() => void reviewCase(item, "approved")} disabled={busyId === item.id}>{busyId === item.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Aprovar análise</button></div></div>}
            {item.status === "approved" && <div className="discount-actions discount-signature-actions">{activeLink && <span className="discount-link-expiry">Link ativo até {formatDateTime(activeLink.expires_at)}</span>}{generatedUrl && <input className="discount-generated-link" readOnly value={generatedUrl} aria-label="Link para assinatura" />}<button type="button" className="primary-button" onClick={() => void createSignatureLink(item)} disabled={busyId === item.id}>{busyId === item.id ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />}{activeLink ? "Gerar novo link" : "Gerar link para assinatura"}</button>{generatedUrl && <><button type="button" className="secondary-button" onClick={() => void copyLink(item)}><ClipboardCopy size={15} /> Copiar link</button><button type="button" className="secondary-button" onClick={() => { try { printDraft(activeLink?.snapshot ?? ({} as DeductionSnapshot)); } catch (error) { setFeedback(error instanceof Error ? error.message : "Não foi possível imprimir o termo."); } }} disabled={!activeLink}><Download size={15} /> Imprimir minuta</button></>}{activeLink && <button type="button" className="secondary-button discount-reject" onClick={() => void cancelSignatureLink(item)} disabled={busyId === item.id}><RotateCcw size={15} /> Cancelar link</button>}<button type="button" className="secondary-button" onClick={() => setRefusalCase({ caseId: item.id, employeeId: item.employee_id, employeeName: employee?.full_name || "Colaborador", returnDate: formatDate(returnData?.returned_at), activeLinkId: activeLink?.id ?? null })} disabled={busyId === item.id}><FileText size={15} /> Registrar apresentação / recusa</button></div>}
            {item.status === "signed" && <div className="discount-signed-footer"><span><Check size={16} /> Assinado por {activeLink?.snapshot?.employee_name || employee?.full_name} em {formatDateTime(item.signed_at)}</span><button type="button" className="secondary-button" onClick={() => void downloadSignedTerm(item)} disabled={busyId === item.id}>{busyId === item.id ? <LoaderCircle className="spin" size={15} /> : <ExternalLink size={15} />} Visualizar termo assinado</button></div>}
          </article>;
        })}
      </section>}
    {refusalCase && <DiscountRefusalModal caseId={refusalCase.caseId} employeeId={refusalCase.employeeId} employeeName={refusalCase.employeeName} returnDate={refusalCase.returnDate} activeLinkId={refusalCase.activeLinkId} onClose={() => setRefusalCase(null)} onSaved={onRefusalSaved} />}
  </main>;
}
