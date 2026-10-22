"use client";

import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { Check, Eraser, LoaderCircle, ShieldCheck, X } from "lucide-react";

type SnapshotItem = {
  material: string;
  code?: string | null;
  unit: string;
  quantity: number;
  size?: string | null;
  expected_replacement_at?: string | null;
  ca_number?: string | null;
  ca_expires_at?: string | null;
  delivered_at?: string | null;
  lot_number?: string | null;
  test_number?: string | null;
  test_report_number?: string | null;
  test_performed_at?: string | null;
  test_expires_at?: string | null;
  units?: Array<Record<string, unknown>>;
  condition?: string | null;
  destination?: string | null;
  incident_type?: string | null;
  incident_description?: string | null;
  deduction_requested?: boolean;
  deduction_amount?: number | null;
};

type Snapshot = {
  type: "delivery" | "return";
  pre_delivery_signature?: boolean;
  organization_id?: string;
  organization_name: string;
  organization_logo_url?: string | null;
  organization_cnpj?: string | null;
  organization_address?: string | null;
  organization_phone?: string | null;
  employee_name: string;
  employee_registration: string | null;
  employee_function?: string | null;
  employee_department?: string | null;
  employee_admission_date?: string | null;
  employee_termination_date?: string | null;
  date: string;
  reason: string;
  items: SnapshotItem[];
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const reasonLabels: Record<string, string> = {
  admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido",
  role_change: "Alteração de função", replacement: "Substituição", termination: "Desligamento", voluntary: "Devolução voluntária", other: "Outro",
};
const incidentLabels: Record<string, string> = {
  normal: "Devolução normal", misuse: "Mau uso", loss: "Perda", theft: "Extravio ou furto", damage: "Dano", other: "Outra ocorrência",
};
const conditionLabels: Record<string, string> = { good: "Bom", used: "Usado", damaged: "Danificado", unusable: "Inutilizado" };
const destinationLabels: Record<string, string> = { stock: "Estoque", maintenance: "Manutenção", disposal: "Descarte", not_returned: "Não devolvido" };

function formatDate(value: string) {
  if (!value) return "Não informada";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Não informada" : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Cuiaba" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(date);
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

async function signatureRequest(body: Record<string, unknown>) {
  if (!supabaseUrl || !publishableKey) throw new Error("O serviço de assinatura não está configurado. Solicite ajuda ao responsável.");
  const response = await fetch(`${supabaseUrl}/functions/v1/employee-term-signature`, {
    method: "POST",
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { error?: string; snapshot?: Snapshot; expires_at?: string; success?: boolean } | null;
  if (!response.ok) throw new Error(result?.error || "Não foi possível validar este link.");
  return result;
}

export function PublicTermSignature({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const submitLockRef = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [signerName, setSignerName] = useState("");
  const [cpf, setCpf] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    signatureRequest({ action: "preview", token })
      .then((result) => {
        if (!active) return;
        if (!result?.snapshot || !result.expires_at) throw new Error("Este link é inválido, expirou ou já foi utilizado.");
        setSnapshot(result.snapshot);
        setExpiresAt(result.expires_at);
        setSignerName(result.snapshot.employee_name);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Não foi possível validar este link."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    if (!canvas || !bounds) return null;
    return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const position = point(event);
    if (!canvas || !context || !position) return;
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.strokeStyle = "#243452";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(position.x, position.y);
    context.lineTo(position.x + 0.1, position.y + 0.1);
    context.stroke();
    setHasSignature(true);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current?.getContext("2d");
    const position = point(event);
    if (!context || !position) return;
    context.lineTo(position.x, position.y);
    context.stroke();
  }

  function stopDrawing() {
    drawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || saving || submitLockRef.current || success) return;
    if (cpf.replace(/\D/g, "").length !== 11) { setError("Informe o CPF completo do colaborador."); return; }
    if (!hasSignature || !canvasRef.current) { setError("Faça sua assinatura no campo indicado."); return; }
    if (!accepted) { setError("Confirme que leu e conferiu as informações da ficha."); return; }
    submitLockRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await signatureRequest({ action: "complete", token, signer_name: signerName, signer_cpf: cpf, signature_data_url: canvasRef.current.toDataURL("image/png"), accepted });
      if (!result?.success) throw new Error("Não foi possível registrar a assinatura.");
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar a assinatura. Tente novamente.");
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  const isDelivery = snapshot?.type === "delivery";
  const isPreDelivery = snapshot?.pre_delivery_signature === true;
  const hasReturnIncident = !isDelivery && Boolean(snapshot?.items.some((item) => item.incident_type && item.incident_type !== "normal"));

  return <main className="public-term-signature-page">
    <section className="public-term-card">
      <div className={`public-term-brand${snapshot?.organization_logo_url ? " public-term-brand-organization" : ""}`}>{snapshot?.organization_logo_url ? <div className="public-term-org-logo" role="img" aria-label={`Logo de ${snapshot.organization_name}`} style={{ backgroundImage: `url(${JSON.stringify(snapshot.organization_logo_url)})` }} /> : <span><ShieldCheck size={22} aria-hidden="true" /></span>}<strong>{snapshot?.organization_name || <>EPIS<span>+</span></>}</strong><small>{isPreDelivery ? "Recibo de entrega de EPI/EPC" : "Registro de movimentação de EPI/EPC"}</small></div>
      {loading ? <div className="module-loading" role="status"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Validando link de uso único...</div>
        : success ? <div className="public-term-success" role="status"><Check size={38} aria-hidden="true" /><h1>{isPreDelivery ? "Recebimento registrado" : "Assinatura registrada"}</h1><p>{isPreDelivery ? `Obrigado, ${snapshot?.employee_name}. O recebimento dos materiais foi registrado e o responsável pelo controle foi informado.` : `Obrigado, ${snapshot?.employee_name}. A ficha assinada foi encaminhada ao responsável pelo controle de equipamentos.`}</p><small>Este link não poderá ser usado novamente.</small></div>
          : error && !snapshot ? <div className="public-term-error" role="alert"><X size={18} aria-hidden="true" /><span>{error}</span></div>
            : snapshot && <>
              <header className="public-term-heading"><p className="eyebrow">CONFIRMAÇÃO DO COLABORADOR</p><h1>{isPreDelivery ? "Recibo de entrega e responsabilidade" : isDelivery ? "Assinatura da ficha de entrega" : hasReturnIncident ? "Ciência da ocorrência e ficha de devolução" : "Assinatura da ficha de devolução"}</h1><p>{isPreDelivery ? "Confira os itens e assine somente no ato em que estiver recebendo os materiais." : hasReturnIncident ? "Confira os materiais, a ocorrência e os valores estimados para análise antes de assinar." : "Confira os dados abaixo antes de assinar."}</p></header>
              <div className="public-term-expiry">Link de uso único · expira em {formatDateTime(expiresAt)}</div>
              {isPreDelivery && <div className="public-term-expiry">Sua assinatura confirma o recebimento descrito nesta ficha. O sistema registrará a entrega e atualizará o estoque após a confirmação.</div>}
              <section className="public-term-summary" aria-label="Resumo da ficha">
                <div className="public-term-meta">
                  <div><small>Colaborador</small><strong>{snapshot.employee_name}</strong></div>
                  {snapshot.employee_registration && <div><small>Matrícula</small><strong>{snapshot.employee_registration}</strong></div>}
                  {snapshot.employee_function && <div><small>Cargo / função</small><strong>{snapshot.employee_function}</strong></div>}
                  {snapshot.employee_department && <div><small>Setor</small><strong>{snapshot.employee_department}</strong></div>}
                  {snapshot.employee_admission_date && <div><small>Admissão</small><strong>{formatDate(snapshot.employee_admission_date)}</strong></div>}
                  {snapshot.employee_termination_date && <div><small>Desligamento</small><strong>{formatDate(snapshot.employee_termination_date)}</strong></div>}
                  <div><small>{isDelivery ? "Data da entrega" : "Data da devolução"}</small><strong>{formatDate(snapshot.date)}</strong></div>
                  <div><small>Motivo</small><strong>{reasonLabels[snapshot.reason] || snapshot.reason}</strong></div>
                </div>
                <h2>{isPreDelivery ? "Materiais recebidos nesta entrega" : isDelivery ? "Materiais entregues" : "Materiais devolvidos"}</h2>
                <ul className="public-term-items">{snapshot.items.map((item, index) => <li key={`${item.material}-${index}`}>
                  <div className="public-term-item-heading"><strong>{item.material}</strong><span>{item.quantity} {item.unit}{item.size ? ` · Tamanho ${item.size}` : ""}</span></div>
                  {isDelivery && <>
                    {item.code && <small>Código: {item.code}</small>}
                    {item.expected_replacement_at && <small>Previsão de troca: {formatDate(item.expected_replacement_at)}</small>}
                    {item.ca_number && <small>CA {item.ca_number}{item.ca_expires_at ? ` · válido até ${formatDate(item.ca_expires_at)}` : ""}</small>}
                    {item.units?.map((unit, unitIndex) => <small key={unitIndex}>{String(unit.identifier || "Material ensaiável")}{unit.test_number ? ` · Ensaio ${String(unit.test_number)}` : ""}{unit.test_report_number ? ` · Laudo ${String(unit.test_report_number)}` : ""}{unit.test_performed_at ? ` · realizado em ${formatDate(String(unit.test_performed_at))}` : ""}{unit.test_expires_at ? ` · validade ${formatDate(String(unit.test_expires_at))}` : unit.valid_until ? ` · validade ${formatDate(String(unit.valid_until))}` : ""}{unit.ca_number ? ` · CA ${String(unit.ca_number)}` : ""}</small>)}
                  </>}
                  {!isDelivery && <>
                    {item.delivered_at && <small>Data da entrega original: {formatDate(item.delivered_at)}</small>}
                    {item.lot_number && <small>Lote: {item.lot_number}</small>}
                    {item.ca_number && <small>CA {item.ca_number}{item.ca_expires_at ? ` · validade oficial ${formatDate(item.ca_expires_at)}` : ""}</small>}
                    {(item.test_number || item.test_report_number || item.test_performed_at || item.test_expires_at) && <small>Ensaio: {item.test_number || "nº não informado"}{item.test_report_number ? ` · laudo ${item.test_report_number}` : ""}{item.test_performed_at ? ` · realizado em ${formatDate(item.test_performed_at)}` : ""}{item.test_expires_at ? ` · válido até ${formatDate(item.test_expires_at)}` : ""}</small>}
                    {item.condition && <small>Condição: {conditionLabels[item.condition] || item.condition}{item.destination ? ` · Destino: ${destinationLabels[item.destination] || item.destination}` : ""}</small>}
                    {item.incident_type && item.incident_type !== "normal" && <small>Ocorrência: {incidentLabels[item.incident_type] || item.incident_type}{item.incident_description ? ` · ${item.incident_description}` : ""}</small>}
                    {item.deduction_requested && <small className="public-term-caution">Valor estimado para análise: {item.deduction_amount ? `R$ ${item.deduction_amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}. ` : "a definir. "}A assinatura registra ciência e não autoriza desconto automático.</small>}
                  </>}
                </li>)}</ul>
              </section>
              {isPreDelivery && <section className="public-term-responsibilities" aria-labelledby="public-term-responsibilities-title">
                <h2 id="public-term-responsibilities-title">Uso, cuidado e devolução</h2>
                <p>Comprometo-me a utilizar os equipamentos somente para a finalidade indicada, seguir as orientações recebidas, cuidar da guarda e conservação e comunicar prontamente qualquer dano, alteração ou extravio. Devolverei os materiais quando solicitado, na substituição, transferência ou desligamento, conforme os procedimentos da organização.</p>
                <p>Estou ciente de que perda, extravio, dano ou mau uso poderá ser apurado individualmente. Eventual ressarcimento ou desconto dependerá da apuração e dos requisitos legais aplicáveis; esta assinatura, por si só, não autoriza desconto automático.</p>
              </section>}
              {hasReturnIncident && <section className="public-term-responsibilities" aria-labelledby="public-return-incident-title">
                <h2 id="public-return-incident-title">Ciência da ocorrência e análise</h2>
                <p>Confirmo que consultei os materiais, dados de entrega e ocorrência descritos nesta ficha. Valores indicados são estimativas para análise individual, não constituem reconhecimento automático de dívida nem autorizam desconto em folha por si só.</p>
                <p>Eventual ressarcimento dependerá da apuração dos fatos, comprovação de responsabilidade e verificação dos requisitos legais aplicáveis.</p>
              </section>}
              <form className="public-term-form" onSubmit={(event) => void submit(event)}>
                <label>Nome completo<input value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" required maxLength={160} /></label>
                <label>CPF do colaborador<input value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" required /></label>
                <div className="public-term-signature-label"><strong>Assinatura</strong><button type="button" onClick={clearSignature}><Eraser size={14} aria-hidden="true" /> Limpar</button></div>
                <canvas ref={canvasRef} width={640} height={180} className="signature-pad public-term-signature-pad" aria-label="Campo para assinar com o dedo ou mouse" tabIndex={0} onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} />
                <label className="public-term-acceptance"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />{isPreDelivery ? "Confirmo que li e compreendi as condições acima, conferi os itens e estou recebendo os materiais listados nesta ficha." : hasReturnIncident ? "Confirmo que li e conferi os materiais e a ocorrência descrita, ciente de que a assinatura não aplica desconto automático." : "Confirmo que li e conferi os materiais e as informações desta ficha."}</label>
                <p className="public-term-legal-note">{isDelivery ? "Ao confirmar, o sistema registra seu aceite, a identificação informada, a data e hora e os itens desta ficha para rastreabilidade do fornecimento de EPI, conforme o registro previsto na NR-06, item 6.5.1(d)." : "Ao confirmar, o sistema registra seu aceite, a identificação informada, a data e hora e os itens desta ficha para rastreabilidade da devolução."} Assinatura eletrônica por link individual de uso único; não utiliza certificado ICP-Brasil.</p>
                {error && <div className="public-term-error" role="alert"><X size={16} aria-hidden="true" /><span>{error}</span></div>}
                <button type="submit" className="primary-button public-term-submit" disabled={saving || !hasSignature || !accepted} aria-busy={saving}>{saving ? <><LoaderCircle className="spin" size={16} aria-hidden="true" /> Registrando assinatura...</> : <>Confirmar assinatura<Check size={16} aria-hidden="true" /></>}</button>
              </form>
              {(snapshot.organization_cnpj || snapshot.organization_address || snapshot.organization_phone) && <footer className="public-term-org-footer">{snapshot.organization_cnpj && <span>CNPJ {snapshot.organization_cnpj}</span>}{snapshot.organization_address && <span>{snapshot.organization_address}</span>}{snapshot.organization_phone && <span>{snapshot.organization_phone}</span>}</footer>}
            </>}
    </section>
  </main>;
}
