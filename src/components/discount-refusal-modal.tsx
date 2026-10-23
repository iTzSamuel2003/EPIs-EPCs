"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardCopy, FileText, Link2, LoaderCircle, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type RefusalOutcome = "employee_refused" | "employee_absent" | "unable_to_present";
export type PresentationChannel = "in_person" | "printed_term" | "digital_link";

type WitnessEmployee = {
  id: string;
  full_name: string;
  registration: string | null;
  job_title: string | null;
  function_name: string | null;
  department: string | null;
};

type WitnessDraft = { employeeId: string; search: string };
type WitnessRow = { id: string; employee_id: string; employee_name_snapshot: string };
type WitnessLink = WitnessRow & { url: string; expires_at: string };
type LinkResult = { url?: string; expires_at?: string; error?: string };

type DiscountRefusalModalProps = {
  caseId: string;
  employeeId: string;
  employeeName: string;
  returnDate: string;
  presentableLinkId: string | null;
  onClose: () => void;
  onSaved: (outcome: RefusalOutcome) => void;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "data não informada" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function DiscountRefusalModal({ caseId, employeeId, employeeName, returnDate, presentableLinkId, onClose, onSaved }: DiscountRefusalModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const [outcome, setOutcome] = useState<RefusalOutcome>("employee_refused");
  const [channel, setChannel] = useState<PresentationChannel>("in_person");
  const [employeeStatement, setEmployeeStatement] = useState("");
  const [witnesses, setWitnesses] = useState<WitnessDraft[]>([{ employeeId: "", search: "" }]);
  const [employees, setEmployees] = useState<WitnessEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [employeeLoadError, setEmployeeLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const [savedEventId, setSavedEventId] = useState("");
  const [witnessRows, setWitnessRows] = useState<WitnessRow[]>([]);
  const [witnessLinks, setWitnessLinks] = useState<Record<string, WitnessLink>>({});
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const [busyWitnessId, setBusyWitnessId] = useState("");

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
        if (queryError) setEmployeeLoadError(queryError.message || "Não foi possível carregar os funcionários ativos.");
        else setEmployees((data ?? []) as WitnessEmployee[]);
      } catch (caught) {
        if (active) setEmployeeLoadError(caught instanceof Error ? caught.message : "Não foi possível carregar os funcionários ativos.");
      } finally {
        if (active) setLoadingEmployees(false);
      }
    })();
    closeButtonRef.current?.focus();
    return () => { active = false; };
  }, [supabase]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !saving && !busyWitnessId) onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving, busyWitnessId]);

  const selectedWitnessIds = new Set(witnesses.map((witness) => witness.employeeId).filter(Boolean));

  function getWitnessOptions(index: number) {
    const search = witnesses[index]?.search.trim().toLocaleLowerCase("pt-BR") ?? "";
    if (!search) return [];
    return employees.filter((person) => {
      if (person.id === employeeId || (selectedWitnessIds.has(person.id) && person.id !== witnesses[index]?.employeeId)) return false;
      const haystack = [person.full_name, person.registration, person.job_title, person.function_name, person.department].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return haystack.includes(search);
    }).slice(0, 8);
  }

  function setWitnessSearch(index: number, value: string) {
    setWitnesses((current) => current.map((witness, witnessIndex) => witnessIndex === index ? { employeeId: "", search: value } : witness));
    setActiveSearchIndex(index);
    setActiveOptionIndex(-1);
  }

  function selectWitness(index: number, employee: WitnessEmployee) {
    setWitnesses((current) => current.map((witness, witnessIndex) => witnessIndex === index ? { employeeId: employee.id, search: employee.full_name } : witness));
    setActiveSearchIndex(null);
    setActiveOptionIndex(-1);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, index: number) {
    const options = getWitnessOptions(index);
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setActiveSearchIndex(index);
      setActiveOptionIndex((current) => current < 0 ? 0 : Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActiveOptionIndex((current) => current < 0 ? options.length - 1 : Math.max(current - 1, 0));
    } else if (event.key === "Enter" && activeSearchIndex === index && options[activeOptionIndex]) {
      event.preventDefault();
      selectWitness(index, options[activeOptionIndex]);
    } else if (event.key === "Escape") setActiveSearchIndex(null);
  }

  async function generateWitnessLink(witness: WitnessRow) {
    setBusyWitnessId(witness.employee_id);
    setLinkErrors((current) => { const next = { ...current }; delete next[witness.employee_id]; return next; });
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("create-term-signature-link", {
        body: { record_type: "witness", record_id: witness.id },
      });
      const result = data as LinkResult | null;
      if (invokeError || !result?.url || !result.expires_at) {
        setLinkErrors((current) => ({ ...current, [witness.employee_id]: result?.error || invokeError?.message || "Não foi possível gerar o link. Tente novamente." }));
        return;
      }
      setWitnessLinks((current) => ({ ...current, [witness.employee_id]: { ...witness, url: result.url!, expires_at: result.expires_at! } }));
    } catch (caught) {
      setLinkErrors((current) => ({ ...current, [witness.employee_id]: caught instanceof Error ? caught.message : "Não foi possível gerar o link. Tente novamente." }));
    } finally {
      setBusyWitnessId("");
    }
  }

  async function loadWitnessRows(eventId: string, createLinks = false) {
    const { data, error: queryError } = await supabase.from("return_deduction_refusal_witnesses")
      .select("id,employee_id,employee_name_snapshot")
      .eq("refusal_record_id", eventId)
      .order("employee_name_snapshot");
    if (queryError || !data?.length) {
      setError(queryError?.message || "O registro foi salvo, mas não foi possível carregar os links das testemunhas.");
      return;
    }
    const rows = data as WitnessRow[];
    setWitnessRows(rows);
    if (createLinks) {
      for (const row of rows) await generateWitnessLink(row);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || savedEventId) return;
    if (loadingEmployees || employeeLoadError) { setError("Aguarde o carregamento da lista de funcionários ativos."); return; }
    if (channel === "digital_link" && !presentableLinkId) { setError("Gere primeiro o link individual do colaborador para registrar que ele foi apresentado."); return; }
    if (witnesses.some((witness) => !witness.employeeId)) {
      setError("Selecione um funcionário para cada testemunha adicionada.");
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
      const { data, error: saveError } = await supabase.rpc("record_return_deduction_refusal", {
        p_case_id: caseId,
        p_outcome: outcome,
        p_presentation_channel: channel,
        p_employee_statement: employeeStatement.trim() || null,
        p_signature_link_id: channel === "digital_link" ? presentableLinkId : null,
        p_witnesses: witnesses.map((witness) => ({ employee_id: witness.employeeId })),
      });
      if (saveError || !data) { setError(saveError?.message || "Não foi possível registrar a apresentação."); return; }
      const eventId = String(data);
      setSavedEventId(eventId);
      onSaved(outcome);
      await loadWitnessRows(eventId, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar a apresentação.");
    } finally {
      setSaving(false);
    }
  }

  async function copyWitnessLink(witnessId: string) {
    const url = witnessLinks[witnessId]?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setError("");
      setLinkErrors((current) => ({ ...current, [witnessId]: "Link copiado. Envie-o à testemunha para assinatura." }));
    } catch {
      setLinkErrors((current) => ({ ...current, [witnessId]: "Não foi possível copiar automaticamente. Selecione o link e copie-o." }));
    }
  }

  return <div className="signature-modal-backdrop">
    <section className="signature-modal discount-refusal-modal" role="dialog" aria-modal="true" aria-labelledby="discount-refusal-title" aria-describedby="discount-refusal-description">
      <button ref={closeButtonRef} type="button" className="signature-modal-close" onClick={onClose} disabled={saving || Boolean(busyWitnessId)} aria-label="Fechar registro"><X size={18} /></button>
      <div className="signature-modal-icon"><FileText size={22} /></div>
      <h2 id="discount-refusal-title">Registrar apresentação e não assinatura</h2>
      <p id="discount-refusal-description">Este registro será anexado à devolução de {employeeName} ({returnDate}). A testemunha confirma somente o que presenciou; não assina pelo colaborador, não reconhece dívida e não autoriza desconto.</p>

      {savedEventId ? <div className="discount-refusal-link-results" role="status">
        <div className="discount-refusal-link-results-heading"><Check size={18} /><div><strong>Apresentação registrada</strong><small>O registro da ocorrência foi salvo. Cada testemunha assina no próprio link; até lá, o status permanece pendente.</small></div></div>
        {witnessRows.length ? witnessRows.map((witness) => {
          const link = witnessLinks[witness.employee_id];
          const isBusy = busyWitnessId === witness.employee_id;
          return <div className="discount-refusal-generated-link" key={witness.id}>
            <strong>{witness.employee_name_snapshot}</strong>
            {link ? <><input aria-label={`Link de assinatura de ${witness.employee_name_snapshot}`} readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} /><small>Pendente de assinatura · expira em {formatDateTime(link.expires_at)}</small><button type="button" className="secondary-button" onClick={() => void copyWitnessLink(witness.employee_id)}><ClipboardCopy size={14} /> Copiar link</button></>
              : <><small>Pendente de gerar o link de assinatura.</small><button type="button" className="secondary-button" onClick={() => void generateWitnessLink(witness)} disabled={Boolean(busyWitnessId)}>{isBusy ? <><LoaderCircle size={14} className="spin" /> Gerando...</> : <><Link2 size={14} /> Gerar link da testemunha</>}</button></>}
            {linkErrors[witness.employee_id] && <small className={link ? "discount-refusal-copy-feedback" : "discount-refusal-error"} role="status">{linkErrors[witness.employee_id]}</small>}
          </div>;
        }) : <div className="discount-refusal-generated-link"><p>O registro foi salvo, mas não foi possível carregar as testemunhas.</p><button type="button" className="secondary-button" onClick={() => void loadWitnessRows(savedEventId, true)} disabled={Boolean(busyWitnessId)}><Link2 size={14} /> Tentar carregar/gerar links</button></div>}
        {error && <p className="discount-refusal-error" role="alert">{error}</p>}
        <div className="signature-modal-actions"><button type="button" className="primary-button" onClick={onClose} disabled={Boolean(busyWitnessId)}>Concluir</button></div>
      </div> : <form onSubmit={submit} className="discount-refusal-form">
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
            <option value="digital_link" disabled={!presentableLinkId}>Link individual apresentado</option>
          </select>
        </label>
        {channel === "digital_link" && presentableLinkId && <p className="discount-refusal-helper">Será registrado o link individual do colaborador que foi gerado para esta autorização, mesmo que já tenha expirado ou sido cancelado, desde que não tenha sido assinado.</p>}

        {outcome === "employee_refused" && <div className="discount-refusal-warning" role="note">Ao registrar uma recusa expressa, os links ativos desta autorização serão cancelados. Se houver uma nova tentativa depois, o RH poderá gerar outro link.</div>}
        <label>Relato do colaborador (opcional)<textarea maxLength={1000} rows={3} value={employeeStatement} onChange={(event) => setEmployeeStatement(event.target.value)} placeholder="Registre apenas as palavras ou justificativa informadas, sem concluir que houve admissão de culpa ou dívida." /></label>

        <div className="discount-refusal-witness-heading"><div><strong>Testemunha da empresa</strong><small>Selecione a pessoa; depois de registrar, será gerado um link individual para ela assinar. Uma segunda testemunha é opcional.</small></div>{witnesses.length === 1 && <button type="button" className="action-button" onClick={() => setWitnesses((current) => [...current, { employeeId: "", search: "" }])}><Plus size={14} /> Adicionar testemunha</button>}</div>
        {loadingEmployees ? <p className="discount-refusal-helper" role="status">Carregando funcionários ativos...</p>
          : employeeLoadError ? <p className="discount-refusal-error" role="alert">{employeeLoadError}</p>
            : employees.length === 0 ? <p className="discount-refusal-error" role="alert">Não há funcionários ativos disponíveis para selecionar como testemunha.</p>
              : witnesses.map((witness, index) => {
                const options = getWitnessOptions(index);
                const showOptions = activeSearchIndex === index && Boolean(witness.search.trim());
                const selectedEmployee = employees.find((person) => person.id === witness.employeeId);
                return <fieldset className="discount-witness-card" key={index}>
                  <legend>{index === 0 ? "Testemunha obrigatória" : "Segunda testemunha (opcional)"}</legend>
                  {index === 1 && <button type="button" className="discount-witness-remove" onClick={() => setWitnesses((current) => current.slice(0, 1))} aria-label="Remover segunda testemunha"><X size={16} /></button>}
                  <label htmlFor={`discount-witness-search-${index}`}>Funcionário da empresa</label>
                  <div className="discount-witness-combobox">
                    <input id={`discount-witness-search-${index}`} role="combobox" aria-autocomplete="list" aria-expanded={showOptions} aria-controls={`discount-witness-options-${index}`} aria-activedescendant={showOptions && options[activeOptionIndex] ? `discount-witness-option-${index}-${options[activeOptionIndex].id}` : undefined} autoComplete="off" value={witness.search} placeholder="Digite o nome ou matrícula" onFocus={() => setActiveSearchIndex(index)} onBlur={() => window.setTimeout(() => setActiveSearchIndex((current) => current === index ? null : current), 120)} onChange={(event) => setWitnessSearch(index, event.target.value)} onKeyDown={(event) => handleSearchKeyDown(event, index)} required aria-required="true" />
                    {showOptions && <div className="discount-witness-options" id={`discount-witness-options-${index}`} role="listbox" aria-label="Funcionários encontrados">{options.length ? options.map((person, optionIndex) => <button type="button" role="option" id={`discount-witness-option-${index}-${person.id}`} aria-selected={optionIndex === activeOptionIndex} key={person.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveOptionIndex(optionIndex)} onClick={() => selectWitness(index, person)}><strong>{person.full_name}</strong><small>{person.registration ? `Matrícula ${person.registration}` : "Matrícula não informada"}{person.job_title || person.function_name ? ` · ${person.job_title || person.function_name}` : ""}{person.department ? ` · ${person.department}` : ""}</small></button>) : <small className="discount-witness-no-results">Nenhum funcionário encontrado com esse texto.</small>}</div>}
                  </div>
                  {selectedEmployee && <p className="discount-refusal-helper">Testemunha selecionada: {selectedEmployee.full_name}{selectedEmployee.registration ? ` · matrícula ${selectedEmployee.registration}` : ""}</p>}
                </fieldset>;
              })}

        <div className="discount-refusal-attestation">“Presenciei a apresentação do termo e o resultado registrado. Minha assinatura confirma somente esse relato, sem representar concordância com a ocorrência, reconhecimento de dívida ou autorização de desconto.”</div>
        {error && <p className="discount-refusal-error" role="alert">{error}</p>}
        <div className="signature-modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="primary-button" disabled={saving || loadingEmployees || Boolean(employeeLoadError) || employees.length === 0}>{saving ? <><LoaderCircle className="spin" size={15} /> Registrando e gerando links...</> : "Registrar e gerar link(s) da testemunha"}</button></div>
      </form>}
    </section>
  </div>;
}
