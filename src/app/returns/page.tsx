"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ClipboardCheck, X } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadTransactionPhotos } from "@/lib/transaction-attachments";
import { RecentReturns } from "@/components/recent-returns";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";
import { createReturnTermDocument, ReturnTermOrganization } from "@/lib/return-term-document";

type Employee = { id: string; full_name: string; registration: string; cpf?: string | null; job_title?: string | null; function_name?: string | null; department?: string | null; admission_date?: string | null; termination_date?: string | null; status?: string | null };
type DeliveredItem = { id: string; quantity: number; returned: number; pending_return: number; variant_id: string | null; variant: { name: string; size: string | null } | null; material: { name: string; internal_code: string; unit: string } | null; lot: { lot_number: string | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; test_expires_at: string | null; unit_cost: number | null } | null; units: Array<{ unit_identifier: string | null; valid_until: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; ca_number: string | null; ca_expires_at: string | null }> | null; delivery: { employee_id: string; delivered_at: string; employee: { full_name: string; registration: string } | null } | null };
type ReturnLine = { delivery_item_id: string; quantity: number; equipment_condition: string; destination: string; incident_type: string; incident_description: string; deduction_requested: boolean; deduction_amount: string };
const reasons = [["replacement", "Substituição"], ["termination", "Desligamento"], ["role_change", "Alteração de função"], ["damaged", "Equipamento danificado"], ["voluntary", "Devolução voluntária"], ["other", "Outro"]];
const incidentLabels: Record<string, string> = { normal: "Devolução normal", misuse: "Mau uso", loss: "Extravio", theft: "Furto", damage: "Dano", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const localDateValue = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
function isValidDateValue(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const parsed = new Date(year, month - 1, day); return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day; }
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function ReturnsPage() {
  const [retryKey, setRetryKey] = useState(0);
  const [organization, setOrganization] = useState<ReturnTermOrganization>({ name: "EPIS+" });
  const [employees, setEmployees] = useState<Employee[]>([]); const [items, setItems] = useState<DeliveredItem[]>([]); const [employeeId, setEmployeeId] = useState(""); const [employeeQuery, setEmployeeQuery] = useState(""); const [suggestionsOpen, setSuggestionsOpen] = useState(false); const [selectedIds, setSelectedIds] = useState<string[]>([]); const [lines, setLines] = useState<Record<string, ReturnLine>>({}); const [reason, setReason] = useState("replacement"); const [returnedAt, setReturnedAt] = useState(localDateValue()); const [signature, setSignature] = useState(""); const [notes, setNotes] = useState(""); const [photoFiles, setPhotoFiles] = useState<File[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const loadRequestRef = useRef(0);
  const submitLockRef = useRef(false);
  const mountedRef = useRef(true);
  async function loadData() {
    mountedRef.current = true;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: employeeData, error: employeeError }, { data: itemData, error: itemError }, { data: returnData, error: returnError }] = await Promise.all([
        supabase.from("employees").select("id,full_name,registration,cpf,job_title,function_name,department,admission_date,termination_date,status").order("full_name"),
        supabase.from("delivery_items").select("id,quantity,variant_id,variant:material_variants(name,size),material:materials(name,internal_code,unit),lot:material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at,unit_cost),units:material_units(unit_identifier,valid_until,test_number,test_report_number,test_performed_at,ca_number,ca_expires_at),delivery:deliveries(employee_id,delivered_at,employee:employees(full_name,registration))").order("created_at", { ascending: false }),
        supabase.from("return_items").select("delivery_item_id,quantity,destination,return:returns(term_signed_at)"),
      ]);
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      const firstError = employeeError ?? itemError ?? returnError;
      if (firstError) {
        setEmployees([]);
        setItems([]);
        setError(friendlyError(firstError, "Não foi possível carregar os dados."));
        return;
      }
      const returnedByItem = new Map<string, number>();
      const pendingReturnByItem = new Map<string, number>();
      (returnData ?? []).forEach((item) => {
        const quantity = Number(item.quantity);
        if (!item.delivery_item_id || !Number.isFinite(quantity)) return;
        const termSigned = Boolean((item.return as { term_signed_at?: string | null } | null)?.term_signed_at);
        const isPendingMissing = item.destination === "not_returned" && !termSigned;
        const map = isPendingMissing ? pendingReturnByItem : returnedByItem;
        map.set(item.delivery_item_id, (map.get(item.delivery_item_id) ?? 0) + quantity);
      });
      setEmployees((employeeData ?? []) as Employee[]);
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
        if (profile?.organization_id) {
          const { data: organizationData } = await supabase.from("organizations").select("name,logo_url,cnpj,address,phone").eq("id", profile.organization_id).maybeSingle();
          if (organizationData) setOrganization(organizationData as ReturnTermOrganization);
        }
      }
      setItems(((itemData ?? []) as unknown as DeliveredItem[]).map((item) => ({
        ...item,
        quantity: Number(item.quantity) || 0,
        returned: returnedByItem.get(item.id) ?? 0,
        pending_return: pendingReturnByItem.get(item.id) ?? 0,
      })));
    } catch (unexpectedError) {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setEmployees([]);
        setItems([]);
        setError(friendlyError(unexpectedError, "Não foi possível carregar os dados."));
      }
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) setLoading(false);
    }
  }
  useEffect(() => { void loadData(); return () => { mountedRef.current = false; loadRequestRef.current += 1; }; }, [retryKey]);
  useEffect(() => { const refresh = () => setRetryKey((current) => current + 1); const events = ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"]; events.forEach((eventName) => window.addEventListener(eventName, refresh)); return () => events.forEach((eventName) => window.removeEventListener(eventName, refresh)); }, []);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);
  function retryLoad() { setError(""); setEmployees([]); setItems([]); setRetryKey((current) => current + 1); }
  const employeeItems = useMemo(() => items.filter((item) => item.delivery?.employee_id === employeeId && item.quantity > item.returned), [items, employeeId]);
  const returnableItems = employeeItems.filter((item) => item.quantity > item.returned + item.pending_return);
  const filteredEmployees = employees.filter((employee) => `${employee.full_name} ${employee.registration}`.toLowerCase().includes(employeeQuery.toLowerCase())).slice(0, 8);
  if (error && !employees.length && !items.length && !employeeId && !saving) return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h1>Devoluções</h1><p className="module-subtitle">Selecione um ou vários materiais e registre a condição de cada devolução.</p></div></header><section className="panel runtime-error-card"><FeedbackMessage onRetry={retryLoad}>{error}</FeedbackMessage></section></main>;
  function defaultLine(item: DeliveredItem): ReturnLine { return { delivery_item_id: item.id, quantity: item.quantity - item.returned - item.pending_return, equipment_condition: "good", destination: "stock", incident_type: "normal", incident_description: "", deduction_requested: false, deduction_amount: "0" }; }
  function selectPhotos(event: ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files ?? []); event.target.value = ""; const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024); if (invalid) { setError(invalid.size > 10 * 1024 * 1024 ? "Cada foto deve ter no máximo 10 MB." : "As fotos devem estar em formato JPG, PNG ou WEBP."); return; } setError(""); setPhotoFiles((current) => [...current, ...files].slice(0, 5)); }
  function selectEmployee(employee: Employee) { setEmployeeId(employee.id); setEmployeeQuery(`${employee.registration} · ${employee.full_name}`); setSelectedIds([]); setLines({}); setSuggestionsOpen(false); }
  function toggleItem(item: DeliveredItem) { setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); setLines((current) => ({ ...current, [item.id]: current[item.id] ?? defaultLine(item) })); }
  function updateLine(id: string, field: keyof ReturnLine, value: string | number | boolean) {
    setLines((current) => {
      const previous = current[id];
      if (field === "equipment_condition") {
        const destination = previous.incident_type !== "normal" ? previous.destination : value === "damaged" || value === "unusable" ? "maintenance" : "stock";
        return { ...current, [id]: { ...previous, equipment_condition: String(value), destination } };
      }
      if (field !== "incident_type") return { ...current, [id]: { ...previous, [field]: value } };
      const incident = String(value);
      const destination = incident === "normal" ? "stock" : incident === "loss" || incident === "theft" ? "not_returned" : "maintenance";
      const condition = incident === "normal" ? "good" : incident === "misuse" || incident === "damage" ? "damaged" : "unusable";
      return { ...current, [id]: { ...previous, incident_type: incident, destination, equipment_condition: condition, deduction_requested: incident !== "normal" } };
    });
  }
  function selectAll() { if (selectedIds.length === returnableItems.length) { setSelectedIds([]); return; } setSelectedIds(returnableItems.map((item) => item.id)); setLines((current) => Object.fromEntries(returnableItems.map((item) => [item.id, current[item.id] ?? defaultLine(item)]))); }
  
  async function generateTerm(employee: Employee, selected: DeliveredItem[], selectedLines: ReturnLine[], returnId: string) {
    const selectedById = new Map(selectedLines.map((line) => [line.delivery_item_id, line]));
    const term = await createReturnTermDocument({
      organization,
      employee: { name: employee.full_name, registration: employee.registration, cpf: employee.cpf, job_title: employee.job_title || employee.function_name, department: employee.department, admission_date: employee.admission_date, termination_date: employee.status === "terminated" ? employee.termination_date : null },
      responsible_name: signature.trim(),
      return_id: returnId,
      returned_at: returnedAt,
      reason,
      notes: notes.trim() || null,
      items: selected.flatMap((item) => {
        const line = selectedById.get(item.id);
        if (!line) return [];
        const units = item.units ?? [];
        const uniqueValues = (key: "test_number" | "test_report_number" | "test_performed_at" | "valid_until") => [...new Set(units.map((unit) => unit[key]).filter(Boolean))].join(", ") || null;
        return [{
          material: item.material?.name || "Material", unit: item.material?.unit || "un.", quantity: Number(line.quantity), size: item.variant?.size || item.variant?.name,
          delivered_at: item.delivery?.delivered_at, lot_number: item.lot?.lot_number, ca_number: item.lot?.ca_number || units.find((unit) => unit.ca_number)?.ca_number,
          ca_expires_at: item.lot?.ca_expires_at || units.find((unit) => unit.ca_expires_at)?.ca_expires_at,
          test_number: item.lot?.test_number || uniqueValues("test_number"), test_report_number: item.lot?.test_report_number || uniqueValues("test_report_number"),
          test_performed_at: item.lot?.test_performed_at || uniqueValues("test_performed_at"), test_expires_at: item.lot?.test_expires_at || uniqueValues("valid_until"),
          condition: line.equipment_condition, destination: line.destination, incident_type: line.incident_type, incident_description: line.incident_description,
          deduction_amount: line.deduction_requested ? Number(line.deduction_amount) : null,
        }];
      }),
    });
    term.save(`termo-devolucao-${safeFileName(employee.full_name) || "colaborador"}.pdf`);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || submitLockRef.current) return;
    setError(""); setSuccess("");
    const selected = employeeItems.filter((item) => selectedIds.includes(item.id));
    if (!employeeId || !selected.length) { setError("Selecione o funcionário e pelo menos um material."); return; }
    if (!isValidDateValue(returnedAt)) { setError("Informe uma data de devolução válida."); return; }
    const selectedLines = selected.map((item) => lines[item.id]);
    if (selectedLines.some((line) => {
      const selectedItem = items.find((item) => item.id === line?.delivery_item_id);
      const available = selectedItem ? selectedItem.quantity - selectedItem.returned - selectedItem.pending_return : 0;
      const quantity = Number(line?.quantity);
      const deduction = Number(line?.deduction_amount);
      return !line || !Number.isInteger(quantity) || quantity <= 0 || quantity > available || (line.deduction_requested && (!Number.isFinite(deduction) || deduction <= 0));
    })) {
      setError("Confira as quantidades inteiras e os valores de desconto dos materiais selecionados.");
      return;
    }
    if (selectedLines.some((line) => line.incident_type !== "normal" && !signature.trim())) {
      setError("Informe o nome completo do responsável para registrar uma ocorrência.");
      return;
    }
    submitLockRef.current = true;
    setSaving(true);
    try {
      const supabase = createClient();
      const payload = selectedLines.map((line) => ({ ...line, quantity: Number(line.quantity), deduction_amount: line.deduction_requested ? Number(line.deduction_amount) || 0 : null }));
      const { data: returnId, error: returnError } = await supabase.rpc("register_return", { p_employee_id: employeeId, p_reason: reason, p_returned_at: returnedAt, p_items: payload, p_notes: notes.trim() || null });
      if (returnError || !returnId) throw returnError ?? new Error("Não foi possível registrar a devolução.");

      const incidentLines = selectedLines.filter((line) => line.incident_type !== "normal");
      let followUpError = "";
      if (incidentLines.length) {
        try {
          const incidentTypes = [...new Set(incidentLines.map((line) => line.incident_type))];
          const accountabilityDescription = incidentLines.map((line) => {
            const label = incidentLabels[line.incident_type] || line.incident_type;
            return line.incident_description ? `${label}: ${line.incident_description}` : label;
          }).join("; ");
          const { error: accountabilityError } = await supabase.rpc("record_return_accountability", {
            p_return_id: returnId,
            p_incident_type: incidentTypes.length === 1 ? incidentTypes[0] : "other",
            p_incident_description: accountabilityDescription || null,
            p_employee_signature_name: signature.trim() || null,
            p_deduction_requested: incidentLines.some((line) => line.deduction_requested),
            p_deduction_amount: incidentLines.reduce((total, line) => total + (Number(line.deduction_amount) || 0), 0) || null,
          });
          if (accountabilityError) followUpError = "o termo de responsabilidade não foi salvo";
        } catch {
          followUpError = "o termo de responsabilidade não foi salvo";
        }
      }
      try {
        const photoResult = photoFiles.length ? await uploadTransactionPhotos(supabase, { files: photoFiles, recordId: returnId, type: "return" }) : null;
        if (photoResult?.error) followUpError = followUpError ? `${followUpError}; as fotos não foram salvas` : "as fotos não foram salvas";
      } catch {
        followUpError = followUpError ? `${followUpError}; as fotos não foram salvas` : "as fotos não foram salvas";
      }
      const employee = employees.find((item) => item.id === employeeId);
      if (employee) await generateTerm(employee, selected, selectedLines, returnId);
      if (followUpError) setError(`Devolução registrada, mas ${followUpError}`);
      else setSuccess(incidentLines.length ? "Devolução registrada. Foram gerados os termos." : "Devolução registrada e termo gerado.");
      window.dispatchEvent(new Event("return-created"));
      setEmployeeId(""); setEmployeeQuery(""); setSuggestionsOpen(false); setSelectedIds([]); setLines({}); setSignature(""); setNotes(""); setPhotoFiles([]); setReturnedAt(localDateValue());
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível registrar a devolução."));
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="module-shell">
      <header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h1>Devoluções</h1><p className="module-subtitle">Confira os dados de entrega e registre a condição de cada material devolvido.</p></div><Link className="secondary-button" href="/deliveries"><ArrowLeft size={16} /> Entregas</Link></header>
      {success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}
      {error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}
      <section className="panel entry-card delivery-card">
        <div className="entry-intro"><div className="entry-icon"><ClipboardCheck size={22} /></div><div><h2>Ficha de devolução</h2><p>Os itens recebidos, pendentes de assinatura e com ocorrência ficam registrados individualmente.</p></div></div>
        <form className="material-form" onSubmit={submit}>
          <label className="employee-picker">Funcionário<div className="employee-picker-control"><input value={employeeQuery} onChange={(event) => { setEmployeeQuery(event.target.value); setEmployeeId(""); setSelectedIds([]); setSuggestionsOpen(true); }} onFocus={() => { if (!employeeId) setSuggestionsOpen(true); }} placeholder="Digite nome ou matrícula" required disabled={loading} autoComplete="off" />{suggestionsOpen && employeeQuery && <div className="employee-suggestions">{filteredEmployees.map((employee) => <button type="button" key={employee.id} onMouseDown={() => selectEmployee(employee)}><strong>{employee.full_name}</strong><small>{employee.registration}</small></button>)}{!filteredEmployees.length && <span>Nenhum funcionário encontrado.</span>}</div>}</div></label>
          {employeeId && <div className="returnable-materials">
            <div className="returnable-materials-heading"><strong>Materiais vinculados ao colaborador</strong><button type="button" className="action-button" onClick={selectAll} disabled={!returnableItems.length}>{selectedIds.length === returnableItems.length && returnableItems.length ? "Desmarcar todos" : "Selecionar todos"}</button></div>
            {employeeItems.length ? employeeItems.map((item) => {
              const line = lines[item.id] ?? defaultLine(item);
              const selected = selectedIds.includes(item.id);
              const lot = item.lot;
              const units = item.units ?? [];
              const caNumber = lot?.ca_number || units.find((unit) => unit.ca_number)?.ca_number;
              const caExpiresAt = lot?.ca_expires_at || units.find((unit) => unit.ca_expires_at)?.ca_expires_at;
              const testNumber = lot?.test_number || [...new Set(units.map((unit) => unit.test_number).filter(Boolean))].join(", ");
              const testReport = lot?.test_report_number || [...new Set(units.map((unit) => unit.test_report_number).filter(Boolean))].join(", ");
              const testDate = lot?.test_performed_at || units.find((unit) => unit.test_performed_at)?.test_performed_at;
              const testExpiry = lot?.test_expires_at || units.find((unit) => unit.valid_until)?.valid_until;
              const availableToReturn = item.quantity - item.returned - item.pending_return;
              const lockedMissing = line.incident_type === "loss" || line.incident_type === "theft";
              return <article className={`return-line ${selected ? "selected" : ""}`} key={item.id}>
                <label className="return-line-select"><input type="checkbox" checked={selected} disabled={availableToReturn <= 0} onChange={() => toggleItem(item)} /><span><strong>{item.material?.name || "Material"}{item.variant ? ` · ${item.variant.size || item.variant.name}` : ""}</strong><small>{availableToReturn > 0 ? `${availableToReturn} disponível(is) para devolução · ${item.material?.unit || "un."}` : `${item.pending_return} pendente(s) de assinatura · ${item.material?.unit || "un."}`}</small></span></label>
                <div className="return-material-details"><span>Entrega: {item.delivery?.delivered_at ? date(item.delivery.delivered_at) : "não informada"}</span>{lot?.lot_number && <span>Lote: {lot.lot_number}</span>}<span>CA: {caNumber || "não informado"}{caExpiresAt ? ` · válido até ${date(caExpiresAt)}` : ""}</span>{testNumber || testReport || testDate || testExpiry ? <span>Ensaio: {testNumber || "nº não informado"}{testReport ? ` · laudo ${testReport}` : ""}{testDate ? ` · realizado ${date(testDate)}` : ""}{testExpiry ? ` · válido até ${date(testExpiry)}` : ""}</span> : <span>Ensaio: sem registro para este lote</span>}</div>
                {selected && <div className="return-line-fields">
                  <label>Quantidade<input type="number" min="1" max={availableToReturn} value={line.quantity} onChange={(event) => updateLine(item.id, "quantity", Number(event.target.value))} /></label>
                  <label>Condição<select value={line.equipment_condition} onChange={(event) => updateLine(item.id, "equipment_condition", event.target.value)}><option value="good">Bom</option><option value="used">Usado</option><option value="damaged">Danificado</option><option value="unusable">Inutilizado</option></select></label>
                  <label>Destino<select value={line.destination} disabled={lockedMissing} onChange={(event) => updateLine(item.id, "destination", event.target.value)}>{lockedMissing ? <option value="not_returned">Não devolvido</option> : <>{line.incident_type === "normal" && line.equipment_condition !== "damaged" && line.equipment_condition !== "unusable" && <option value="stock">Estoque</option>}<option value="maintenance">Manutenção</option><option value="disposal">Descarte</option></>}</select></label>
                  <label>Ocorrência<select value={line.incident_type} onChange={(event) => updateLine(item.id, "incident_type", event.target.value)}>{Object.entries(incidentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  {line.incident_type !== "normal" && <><label>Valor estimado para análise (R$)<input type="number" min="0" step="0.01" value={line.deduction_amount} onChange={(event) => updateLine(item.id, "deduction_amount", event.target.value)} /></label><label className="return-line-description">Descrição da ocorrência<textarea value={line.incident_description} onChange={(event) => updateLine(item.id, "incident_description", event.target.value)} rows={2} /></label><p className="return-line-legal-note">O valor é uma estimativa para análise. A assinatura registra ciência; não realiza desconto automático.</p></>}
                </div>}
              </article>;
            }) : <span>Nenhum material pendente de devolução.</span>}
          </div>}
          <div className="form-grid two"><label>Data da devolução<input type="date" value={returnedAt} onChange={(event) => setReturnedAt(event.target.value)} required /></label><label>Motivo geral<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <div className="form-section-title"><h2>Termos e evidências</h2><p>Ocorrências geram termo específico para ciência e análise individual. A baixa por extravio/furto só ocorre após assinatura; nenhum desconto é aplicado automaticamente.</p></div>
          <label className="transaction-photo-picker">Fotos da devolução (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectPhotos} /></label>{photoFiles.length > 0 && <small className="muted-cell">{photoFiles.length} foto(s) selecionada(s).</small>}
          <label>Nome completo do responsável<input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Digite o nome completo do responsável pelo controle" /></label>
          <label>Observações gerais<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} /></label>
          <div className="modal-actions"><Link className="secondary-button" href="/stock">Consultar estoque</Link><button className="primary-button" disabled={saving || loading || !selectedIds.length}>{saving ? "Registrando..." : "Confirmar devolução"}<Check size={16} /></button></div>
        </form>
      </section>
      <RecentReturns organization={organization} />
    </main>
  );
}
