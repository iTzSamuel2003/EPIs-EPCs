"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, FileText, LoaderCircle, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type RefusalOutcome = "employee_refused" | "employee_absent" | "unable_to_present";
export type PresentationChannel = "in_person" | "printed_term" | "digital_link";

type WitnessEmployee = {
  id: string;
  full_name: string;
  registration: string;
  job_title: string | null;
  function_name: string | null;
  department: string | null;
};

type WitnessDraft = { employeeId: string; signatureDataUrl: string };

type DiscountRefusalModalProps = {
  caseId: string;
  employeeId: string;
  employeeName: string;
  returnDate: string;
  activeLinkId: string | null;
  onClose: () => void;
  onSaved: (outcome: RefusalOutcome) => void;
};

function WitnessSignaturePad({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  function getPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    if (!canvas || !bounds) return null;
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getPoint(event);
    if (!canvas || !context || !point) return;
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.strokeStyle = "#243452";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.1, point.y + 0.1);
    context.stroke();
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current?.getContext("2d");
    const point = getPoint(event);
    if (!context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return <div className="discount-witness-signature">
    <div className="signature-pad-label"><span>{label}</span><button type="button" onClick={clearSignature} disabled={!value}><Eraser size={13} /> Limpar</button></div>
    <canvas
      ref={canvasRef}
      width={720}
      height={180}
      className="signature-pad"
      aria-label={label}
      role="img"
      onPointerDown={startDrawing}
      onPointerMove={draw}
      onPointerUp={stopDrawing}
      onPointerCancel={stopDrawing}
      onLostPointerCapture={stopDrawing}
    />
  </div>;
}

export function DiscountRefusalModal({ caseId, employeeId, employeeName, returnDate, activeLinkId, onClose, onSaved }: DiscountRefusalModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const [outcome, setOutcome] = useState<RefusalOutcome>("employee_refused");
  const [channel, setChannel] = useState<PresentationChannel>("in_person");
  const [employeeStatement, setEmployeeStatement] = useState("");
  const [witnesses, setWitnesses] = useState<WitnessDraft[]>([{ employeeId: "", signatureDataUrl: "" }]);
  const [employees, setEmployees] = useState<WitnessEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [employeeLoadError, setEmployeeLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: queryError } = await supabase.from("employees")
          .select("id,full_name,registration,job_title,function_name,department")
          .eq("status", "active")
          .order("full_name")
          .limit(1000);
        if (!active) return;
        if (queryError) setEmployeeLoadError(queryError.message || "Não foi possível carregar as testemunhas.");
        else setEmployees((data ?? []) as WitnessEmployee[]);
      } catch (caught) {
        if (active) setEmployeeLoadError(caught instanceof Error ? caught.message : "Não foi possível carregar as testemunhas.");
      } finally {
        if (active) setLoadingEmployees(false);
      }
    })();
    closeButtonRef.current?.focus();
    return () => { active = false; };
  }, [supabase]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const selectedWitnessIds = new Set(witnesses.map((witness) => witness.employeeId).filter(Boolean));

  function updateWitness(index: number, field: keyof WitnessDraft, value: string) {
    setWitnesses((current) => current.map((witness, witnessIndex) => {
      if (witnessIndex !== index) return witness;
      return field === "employeeId"
        ? { employeeId: value, signatureDataUrl: "" }
        : { ...witness, signatureDataUrl: value };
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (loadingEmployees || employeeLoadError) { setError("Aguarde o carregamento da lista de funcionários ativos."); return; }
    if (channel === "digital_link" && !activeLinkId) { setError("Não há link ativo para registrar como apresentado."); return; }
    if (witnesses.some((witness) => !witness.employeeId || !witness.signatureDataUrl)) {
      setError("Selecione cada testemunha e peça que ela assine a própria declaração.");
      return;
    }
    if (new Set(witnesses.map((witness) => witness.employeeId)).size !== witnesses.length) {
      setError("Selecione testemunhas diferentes.");
      return;
    }
    if (witnesses.some((witness) => witness.employeeId === employeeId)) {
      setError("O colaborador relacionado à ocorrência não pode ser testemunha do próprio registro.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const { error: saveError } = await supabase.rpc("record_return_deduction_refusal", {
        p_case_id: caseId,
        p_outcome: outcome,
        p_presentation_channel: channel,
        p_employee_statement: employeeStatement.trim() || null,
        p_signature_link_id: channel === "digital_link" ? activeLinkId : null,
        p_witnesses: witnesses.map((witness) => ({ employee_id: witness.employeeId, signature_data_url: witness.signatureDataUrl })),
      });
      if (saveError) { setError(saveError.message || "Não foi possível registrar a apresentação."); return; }
      onSaved(outcome);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar a apresentação.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="signature-modal-backdrop">
    <section className="signature-modal discount-refusal-modal" role="dialog" aria-modal="true" aria-labelledby="discount-refusal-title" aria-describedby="discount-refusal-description">
      <button ref={closeButtonRef} type="button" className="signature-modal-close" onClick={onClose} disabled={saving} aria-label="Fechar registro"><X size={18} /></button>
      <div className="signature-modal-icon"><FileText size={22} /></div>
      <h2 id="discount-refusal-title">Registrar apresentação e não assinatura</h2>
      <p id="discount-refusal-description">Este registro será anexado à devolução de {employeeName} ({returnDate}). A testemunha confirma somente o que presenciou; não assina pelo colaborador, não reconhece dívida e não autoriza desconto.</p>

      <form onSubmit={submit} className="discount-refusal-form">
        <label>Resultado da apresentação
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as RefusalOutcome)}>
            <option value="employee_refused">O colaborador recusou expressamente assinar</option>
            <option value="employee_absent">O colaborador estava ausente</option>
            <option value="unable_to_present">Não foi possível concluir a apresentação</option>
          </select>
        </label>
        <label>Como o termo foi apresentado
          <select value={channel} onChange={(event) => setChannel(event.target.value as PresentationChannel)}>
            <option value="in_person">Presencialmente, explicado ao colaborador</option>
            <option value="printed_term">Termo impresso apresentado</option>
            <option value="digital_link" disabled={!activeLinkId}>Link individual ativo apresentado</option>
          </select>
        </label>

        {outcome === "employee_refused" && <div className="discount-refusal-warning" role="note">Ao registrar uma recusa expressa, os links ativos desta autorização serão cancelados. Se houver uma nova tentativa depois, o RH poderá gerar outro link.</div>}

        <label>Relato do colaborador (opcional)<textarea maxLength={1000} rows={3} value={employeeStatement} onChange={(event) => setEmployeeStatement(event.target.value)} placeholder="Registre apenas as palavras ou justificativa informadas, sem concluir que houve admissão de culpa ou dívida." /></label>

        <div className="discount-refusal-witness-heading"><div><strong>Testemunha da empresa</strong><small>É obrigatório registrar uma testemunha. Uma segunda é opcional.</small></div>{witnesses.length === 1 && <button type="button" className="action-button" onClick={() => setWitnesses((current) => [...current, { employeeId: "", signatureDataUrl: "" }])}><Plus size={14} /> Adicionar testemunha</button>}</div>
        {loadingEmployees ? <p className="discount-refusal-helper" role="status">Carregando funcionários ativos...</p>
          : employeeLoadError ? <p className="discount-refusal-error" role="alert">{employeeLoadError}</p>
            : employees.length === 0 ? <p className="discount-refusal-error" role="alert">Não há funcionários ativos disponíveis para selecionar como testemunha.</p>
              : witnesses.map((witness, index) => <fieldset className="discount-witness-card" key={index}>
                <legend>{index === 0 ? "Testemunha obrigatória" : "Segunda testemunha (opcional)"}</legend>
                {index === 1 && <button type="button" className="discount-witness-remove" onClick={() => setWitnesses((current) => current.slice(0, 1))} aria-label="Remover segunda testemunha"><X size={16} /></button>}
                <label>Funcionário da empresa
                  <select value={witness.employeeId} required onChange={(event) => updateWitness(index, "employeeId", event.target.value)}>
                    <option value="">Selecione a testemunha</option>
                    {employees.filter((person) => person.id !== employeeId && (!selectedWitnessIds.has(person.id) || person.id === witness.employeeId)).map((person) => <option key={person.id} value={person.id}>{person.full_name} · matrícula {person.registration}{person.job_title || person.function_name ? ` · ${person.job_title || person.function_name}` : ""}</option>)}
                  </select>
                </label>
                <p className="discount-refusal-helper">Peça à própria testemunha para assinar no dispositivo. A declaração confirma apenas a apresentação e o fato presenciado.</p>
                <WitnessSignaturePad key={`${index}-${witness.employeeId}`} label={`Assinatura da ${index === 0 ? "testemunha" : "segunda testemunha"}`} value={witness.signatureDataUrl} onChange={(value) => updateWitness(index, "signatureDataUrl", value)} />
              </fieldset>)}

        <div className="discount-refusal-attestation">“Presenciei a apresentação do termo e o resultado registrado. Minha assinatura confirma somente esse relato, sem representar concordância com a ocorrência, reconhecimento de dívida ou autorização de desconto.”</div>
        {error && <p className="discount-refusal-error" role="alert">{error}</p>}
        <div className="signature-modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="primary-button" disabled={saving || loadingEmployees || Boolean(employeeLoadError) || employees.length === 0}>{saving ? <><LoaderCircle className="spin" size={15} /> Registrando...</> : "Registrar com testemunha"}</button></div>
      </form>
    </section>
  </div>;
}
