"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ClipboardCheck, X } from "lucide-react";
import Link from "next/link";
import { jsPDF } from "jspdf";
import { createClient } from "@/lib/supabase/client";
import { uploadTransactionPhotos } from "@/lib/transaction-attachments";
import { RecentReturns } from "@/components/recent-returns";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Employee = { id: string; full_name: string; registration: string };
type DeliveredItem = { id: string; quantity: number; returned: number; variant_id: string | null; variant: { name: string; size: string | null } | null; material: { name: string; internal_code: string; unit: string } | null; delivery: { employee_id: string; delivered_at: string; employee: { full_name: string; registration: string } | null } | null };
type ReturnLine = { delivery_item_id: string; quantity: number; equipment_condition: string; destination: string; incident_type: string; incident_description: string; deduction_requested: boolean; deduction_amount: string };
const reasons = [["replacement", "Substituição"], ["termination", "Desligamento"], ["role_change", "Alteração de função"], ["damaged", "Equipamento danificado"], ["voluntary", "Devolução voluntária"], ["other", "Outro"]];
const incidentLabels: Record<string, string> = { normal: "Devolução normal", misuse: "Mau uso", loss: "Extravio", theft: "Furto", damage: "Dano", other: "Outro" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
const localDateValue = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
function isValidDateValue(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const parsed = new Date(year, month - 1, day); return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day; }
const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function ReturnsPage() {
  const [retryKey, setRetryKey] = useState(0);
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
        supabase.from("employees").select("id,full_name,registration").order("full_name"),
        supabase.from("delivery_items").select("id,quantity,variant_id,variant:material_variants(name,size),material:materials(name,internal_code,unit),delivery:deliveries(employee_id,delivered_at,employee:employees(full_name,registration))").order("created_at", { ascending: false }),
        supabase.from("return_items").select("delivery_item_id,quantity"),
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
      (returnData ?? []).forEach((item) => {
        const quantity = Number(item.quantity);
        if (item.delivery_item_id && Number.isFinite(quantity)) returnedByItem.set(item.delivery_item_id, (returnedByItem.get(item.delivery_item_id) ?? 0) + quantity);
      });
      setEmployees((employeeData ?? []) as Employee[]);
      setItems(((itemData ?? []) as unknown as DeliveredItem[]).map((item) => ({
        ...item,
        quantity: Number(item.quantity) || 0,
        material: item.variant && item.material ? { ...item.material, name: `${item.material.name} · Tamanho ${item.variant.size || item.variant.name}` } : item.material,
        returned: returnedByItem.get(item.id) ?? 0,
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
  const filteredEmployees = employees.filter((employee) => `${employee.full_name} ${employee.registration}`.toLowerCase().includes(employeeQuery.toLowerCase())).slice(0, 8);
  if (error && !employees.length && !items.length && !employeeId && !saving) return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h1>Devoluções</h1><p className="module-subtitle">Selecione um ou vários materiais e registre a condição de cada devolução.</p></div></header><section className="panel runtime-error-card"><FeedbackMessage onRetry={retryLoad}>{error}</FeedbackMessage></section></main>;
  function defaultLine(item: DeliveredItem): ReturnLine { return { delivery_item_id: item.id, quantity: item.quantity - item.returned, equipment_condition: "good", destination: "stock", incident_type: "normal", incident_description: "", deduction_requested: false, deduction_amount: "0" }; }
  function selectPhotos(event: ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files ?? []); event.target.value = ""; const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024); if (invalid) { setError(invalid.size > 10 * 1024 * 1024 ? "Cada foto deve ter no máximo 10 MB." : "As fotos devem estar em formato JPG, PNG ou WEBP."); return; } setError(""); setPhotoFiles((current) => [...current, ...files].slice(0, 5)); }
  function selectEmployee(employee: Employee) { setEmployeeId(employee.id); setEmployeeQuery(`${employee.registration} · ${employee.full_name}`); setSelectedIds([]); setLines({}); setSuggestionsOpen(false); }
  function toggleItem(item: DeliveredItem) { setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); setLines((current) => ({ ...current, [item.id]: current[item.id] ?? defaultLine(item) })); }
  function updateLine(id: string, field: keyof ReturnLine, value: string | number | boolean) { setLines((current) => ({ ...current, [id]: { ...current[id], [field]: value } })); }
  function selectAll() { if (selectedIds.length === employeeItems.length) { setSelectedIds([]); return; } setSelectedIds(employeeItems.map((item) => item.id)); setLines((current) => Object.fromEntries(employeeItems.map((item) => [item.id, current[item.id] ?? defaultLine(item)]))); }
  
  function generateTerm(employee: Employee, selected: DeliveredItem[], selectedLines: ReturnLine[], returnId: string, incidentsOnly: boolean) { const lineItems = selected.filter((item) => { const line = lines[item.id]; return !incidentsOnly || line.incident_type !== "normal"; }); if (incidentsOnly && !lineItems.length) return; const doc = new jsPDF({ unit: "mm", format: "a4" }); const margin = 18; const width = 210; const lineWidth = width - margin * 2; let y = 20; doc.setTextColor(23, 35, 60); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("EPIS+", margin, y); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 112, 135); doc.text(incidentsOnly ? "TERMO DE OCORRÊNCIA E RESPONSABILIDADE" : "TERMO DE DEVOLUÇÃO DE MATERIAIS", margin, y + 7); y += 15; doc.setDrawColor(210, 216, 227); doc.line(margin, y, width - margin, y); y += 10; doc.setFontSize(9); doc.setTextColor(52, 64, 87); doc.text(`Colaborador: ${employee.full_name}`, margin, y); doc.text(`Matrícula: ${employee.registration}`, margin + 95, y); y += 6; doc.text(`Data: ${date(returnedAt)}`, margin, y); doc.text(`Registro: ${returnId.slice(0, 8)}`, margin + 95, y); y += 12; doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(incidentsOnly ? "Materiais com ocorrência" : "Materiais devolvidos", margin, y); y += 8; doc.setFontSize(8); doc.text("Material", margin, y); doc.text("Qtd.", margin + 105, y); doc.text("Condição / ocorrência", margin + 130, y); y += 5; lineItems.forEach((item) => { const line = lines[item.id]; const text = `${item.material?.name || "Material"} · ${line.quantity} ${item.material?.unit || "un."}`; const detail = `${line.equipment_condition} · ${incidentLabels[line.incident_type]}`; doc.setFont("helvetica", "normal"); doc.setTextColor(52, 64, 87); doc.text(doc.splitTextToSize(text, 98), margin, y); doc.text(String(line.quantity), margin + 105, y); doc.text(doc.splitTextToSize(detail, 55), margin + 130, y); y += 10; }); y += 8; const paragraph = incidentsOnly ? "Declaro ciência da ocorrência registrada e autorizo a apuração conforme as políticas internas e a legislação aplicável. Qualquer desconto dependerá da análise e dos requisitos legais aplicáveis." : "Declaro que os materiais acima foram devolvidos e conferidos, encerrando a responsabilidade sobre os itens indicados neste termo."; doc.setFontSize(8.5); doc.setTextColor(79, 93, 115); doc.text(doc.splitTextToSize(paragraph, lineWidth), margin, y, { lineHeightFactor: 1.5 }); y += 30; doc.setDrawColor(70, 82, 103); doc.line(margin, y, margin + 72, y); doc.line(width - margin - 72, y, width - margin, y); doc.setFontSize(8); doc.text("Assinatura do colaborador", margin + 36, y + 5, { align: "center" }); doc.text("Responsável pela entrega", width - margin - 36, y + 5, { align: "center" }); doc.setFont("helvetica", "bold"); doc.text(signature || employee.full_name, margin + 36, y + 10, { align: "center" }); doc.save(`${incidentsOnly ? "termo-responsabilidade" : "termo-devolucao"}-${safeFileName(employee.full_name)}.pdf`); }
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
      const available = selectedItem ? selectedItem.quantity - selectedItem.returned : 0;
      const quantity = Number(line?.quantity);
      const deduction = Number(line?.deduction_amount);
      return !line || !Number.isInteger(quantity) || quantity <= 0 || quantity > available || (line.deduction_requested && (!Number.isFinite(deduction) || deduction <= 0));
    })) {
      setError("Confira as quantidades inteiras e os valores de desconto dos materiais selecionados.");
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
          const { error: accountabilityError } = await supabase.rpc("record_return_accountability", {
            p_return_id: returnId,
            p_incident_type: incidentLines[0].incident_type,
            p_incident_description: incidentLines.map((line) => line.incident_description).filter(Boolean).join("; ") || null,
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
      if (employee) {
        generateTerm(employee, selected, selectedLines, returnId, false);
        if (incidentLines.length) generateTerm(employee, selected, selectedLines, returnId, true);
      }
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

  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h1>Devoluções</h1><p className="module-subtitle">Selecione um ou vários materiais e registre a condição de cada devolução.</p></div><Link className="secondary-button" href="/deliveries"><ArrowLeft size={16} /> Entregas</Link></header>{success && <div className="feedback success-feedback"><Check size={17} /> {success}</div>}{error && <div className="feedback error-feedback"><X size={17} /> {error}</div>}<section className="panel entry-card delivery-card"><div className="entry-intro"><div className="entry-icon"><ClipboardCheck size={22} /></div><div><h2>Ficha de devolução</h2><p>Itens normais e itens com ocorrência podem ser processados na mesma operação.</p></div></div><form className="material-form" onSubmit={submit}><label className="employee-picker">Funcionário<div className="employee-picker-control"><input value={employeeQuery} onChange={(event) => { setEmployeeQuery(event.target.value); setEmployeeId(""); setSelectedIds([]); setSuggestionsOpen(true); }} onFocus={() => { if (!employeeId) setSuggestionsOpen(true); }} placeholder="Digite nome ou matrícula" required disabled={loading} autoComplete="off" />{suggestionsOpen && employeeQuery && <div className="employee-suggestions">{filteredEmployees.map((employee) => <button type="button" key={employee.id} onMouseDown={() => selectEmployee(employee)}><strong>{employee.full_name}</strong><small>{employee.registration}</small></button>)}{!filteredEmployees.length && <span>Nenhum funcionário encontrado.</span>}</div>}</div></label>{employeeId && <div className="returnable-materials"><div className="returnable-materials-heading"><strong>Materiais vinculados disponíveis</strong><button type="button" className="action-button" onClick={selectAll}>{selectedIds.length === employeeItems.length && employeeItems.length ? "Desmarcar todos" : "Selecionar todos"}</button></div>{employeeItems.length ? employeeItems.map((item) => { const line = lines[item.id] ?? defaultLine(item); const selected = selectedIds.includes(item.id); return <div className={`return-line ${selected ? "selected" : ""}`} key={item.id}><label className="return-line-select"><input type="checkbox" checked={selected} onChange={() => toggleItem(item)} /><span><strong>{item.material?.name || "Material"}</strong><small>{item.quantity - item.returned} disponível(is) · {item.material?.unit || "un."}</small></span></label>{selected && <div className="return-line-fields"><label>Quantidade<input type="number" min="1" max={item.quantity - item.returned} value={line.quantity} onChange={(event) => updateLine(item.id, "quantity", Number(event.target.value))} /></label><label>Condição<select value={line.equipment_condition} onChange={(event) => updateLine(item.id, "equipment_condition", event.target.value)}><option value="good">Bom</option><option value="used">Usado</option><option value="damaged">Danificado</option><option value="unusable">Inutilizado</option></select></label><label>Destino<select value={line.destination} onChange={(event) => updateLine(item.id, "destination", event.target.value)}><option value="stock">Estoque</option><option value="maintenance">Manutenção</option><option value="disposal">Descarte</option></select></label><label>Ocorrência<select value={line.incident_type} onChange={(event) => updateLine(item.id, "incident_type", event.target.value)}>{Object.entries(incidentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{line.incident_type !== "normal" && <><label>Valor do desconto<input type="number" min="0" step="0.01" value={line.deduction_amount} onChange={(event) => updateLine(item.id, "deduction_amount", event.target.value)} /></label><label className="return-line-description">Descrição<textarea value={line.incident_description} onChange={(event) => updateLine(item.id, "incident_description", event.target.value)} rows={2} /></label></>}</div>}</div>; }) : <span>Nenhum material pendente de devolução.</span>}</div>}<div className="form-grid two"><label>Data<input type="date" value={returnedAt} onChange={(event) => setReturnedAt(event.target.value)} required /></label><label>Motivo geral<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="form-section-title"><h2>Termos e evidências</h2><p>Itens com ocorrência geram também um termo separado de responsabilidade.</p></div><label className="transaction-photo-picker">Fotos da devolução (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectPhotos} /></label>{photoFiles.length > 0 && <small className="muted-cell">{photoFiles.length} foto(s) selecionada(s).</small>}<label>Nome completo do responsável<input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="Digite o nome completo do responsável" /></label><label>Observações gerais<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} /></label><div className="modal-actions"><Link className="secondary-button" href="/stock">Consultar estoque</Link><button className="primary-button" disabled={saving || loading || !selectedIds.length}>{saving ? "Registrando..." : "Confirmar devolução"}<Check size={16} /></button></div></form></section><RecentReturns /></main>;
}
