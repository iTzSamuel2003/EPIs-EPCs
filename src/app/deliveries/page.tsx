"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ClipboardCheck, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { RecentDeliveries } from "@/components/recent-deliveries";
import { uploadTransactionPhotos } from "@/lib/transaction-attachments";
import { FeedbackMessage } from "@/components/feedback-message";

type Employee = { id: string; full_name: string; registration: string; department: string | null; job_title?: string | null; function_name?: string | null };
type Material = { id: string; name: string; internal_code: string; unit: string; available_quantity: number; replacement_interval_days: number | null; test_required: boolean; report_required: boolean; ca_required: boolean };
type MaterialVariant = { id: string; material_id: string; name: string; size: string | null; active: boolean };
type TestLot = { material_id: string; variant_id: string | null; lot_number: string; entry_date: string; available_quantity: number; expires_at: string | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_performed_at: string | null; test_expires_at: string | null; test_report_number: string | null };
type CaCertificate = { ca_number: string; valid_until: string | null; status: string | null };
type DeliveryItem = { material_id: string; materialQuery: string; variant_id: string; quantity: string; expected_replacement_at: string };
type FunctionTemplate = { id: string; name: string; items: Array<{ material_name: string; material_id: string | null; quantity: number }> };
const newDeliveryItem = (): DeliveryItem => ({ material_id: "", materialQuery: "", variant_id: "", quantity: "1", expected_replacement_at: "" });
function calculateReplacementDate(deliveredAt: string, intervalDays: number | null) { if (!deliveredAt || !intervalDays) return ""; const date = new Date(`${deliveredAt}T00:00:00`); date.setDate(date.getDate() + intervalDays); return localDateValue(date); }
function localDateValue(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function isValidDateValue(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const date = new Date(year, month - 1, day); return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day; }
function functionKey(value: string) { return normalize(value).replace(/\s+(vi|v|iv|iii|ii|i)$/, "").replace(/\beletricista\s+lm\b/g, "eletricista de linha morta").replace(/\beletricista\s+lv\b/g, "eletricista de linha viva").replace(/\beletricista\s+linha\s+morta\b/g, "eletricista de linha morta").replace(/\beletricista\s+linha\s+viva\b/g, "eletricista de linha viva").replace(/\bmotorista\s+operador\s+munck\b/g, "motorista operador de munck"); }
const reasons = [["admission", "Admissão"], ["periodic_change", "Troca periódica"], ["damaged", "Equipamento danificado"], ["lost", "Equipamento perdido"], ["role_change", "Alteração de função"], ["replacement", "Substituição"], ["other", "Outro"]];

export default function DeliveriesPage() {
  const [variants, setVariants] = useState<MaterialVariant[]>([]); const [testLots, setTestLots] = useState<TestLot[]>([]); const [caCertificates, setCaCertificates] = useState<Record<string, CaCertificate>>({});
  const [employees, setEmployees] = useState<Employee[]>([]); const [materials, setMaterials] = useState<Material[]>([]); const [templates, setTemplates] = useState<FunctionTemplate[]>([]); const [employeeId, setEmployeeId] = useState(""); const [employeeFunction, setEmployeeFunction] = useState(""); const [employeeQuery, setEmployeeQuery] = useState(""); const [employeeSuggestionsOpen, setEmployeeSuggestionsOpen] = useState(false); const [materialSuggestionsOpen, setMaterialSuggestionsOpen] = useState<number | null>(null); const [reason, setReason] = useState("admission"); const [deliveredAt, setDeliveredAt] = useState(localDateValue()); const [notes, setNotes] = useState(""); const [items, setItems] = useState<DeliveryItem[]>([newDeliveryItem()]); const [photoFiles, setPhotoFiles] = useState<File[]>([]); const [loading, setLoading] = useState(true); const [variantsLoading, setVariantsLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState(""); const [canRetryLoad, setCanRetryLoad] = useState(true);
  const loadOptionsRequestRef = useRef(0);
  const submitLockRef = useRef(false);
  const mountedRef = useRef(true);
  function clearLoadedOptions() {
    setEmployees([]);
    setMaterials([]);
    setTemplates([]);
    setVariants([]); setTestLots([]); setCaCertificates({});
  }
  function selectPhotos(event: ChangeEvent<HTMLInputElement>) { setCanRetryLoad(false); const files = Array.from(event.target.files ?? []); event.target.value = ""; const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024); if (invalid) { setError(invalid.size > 10 * 1024 * 1024 ? "Cada foto deve ter no máximo 10 MB." : "As fotos devem estar em formato JPG, PNG ou WEBP."); return; } setPhotoFiles((current) => [...current, ...files].slice(0, 5)); }
  const loadOptions = useCallback(async () => {
    mountedRef.current = true;
    const requestId = ++loadOptionsRequestRef.current;
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: employeeData, error: employeeError }, { data: materialData, error: materialError }, { data: lotData, error: lotError }, { data: templateData, error: templateError }] = await Promise.all([
        supabase.from("employees").select("id, full_name, registration, department, job_title, function_name").eq("status", "active").order("full_name"),
        supabase.from("materials").select("id, name, internal_code, unit, replacement_interval_days, test_required, report_required, ca_required").eq("status", "active").order("name"),
        supabase.from("material_lots").select("material_id, variant_id, lot_number, entry_date, expires_at, available_quantity, ca_number, ca_expires_at, test_number, test_performed_at, test_expires_at, test_report_number"),
        supabase.from("function_templates").select("id, name, function_template_items(material_name, material_id, quantity)").order("name"),
      ]);
      if (!mountedRef.current || requestId !== loadOptionsRequestRef.current) return;
      const firstError = employeeError ?? materialError ?? lotError ?? templateError;
      if (firstError) {
        clearLoadedOptions();
        setCanRetryLoad(true);
        setError(friendlyError(firstError, "Não foi possível carregar os dados."));
        return;
      }
      const availableByMaterial = (lotData ?? []).reduce<Record<string, number>>((sum, lot) => {
        sum[lot.material_id] = (sum[lot.material_id] ?? 0) + Number(lot.available_quantity);
        return sum;
      }, {});
      const caNumbers = [...new Set((lotData ?? []).map((lot) => lot.ca_number?.trim()).filter((number): number is string => Boolean(number)))];
      if (caNumbers.length) {
        const { data: certificateData } = await supabase.from("ca_certificates").select("ca_number,valid_until,status").in("ca_number", caNumbers);
        if (!mountedRef.current || requestId !== loadOptionsRequestRef.current) return;
        setCaCertificates((certificateData ?? []).reduce<Record<string, CaCertificate>>((sum, certificate) => { sum[certificate.ca_number] = certificate as CaCertificate; return sum; }, {}));
      } else {
        setCaCertificates({});
      }
      setEmployees((employeeData ?? []) as Employee[]);
      setTestLots((lotData ?? []) as TestLot[]);
      setMaterials(((materialData ?? []) as Array<Omit<Material, "available_quantity">>).map((material) => ({ ...material, available_quantity: availableByMaterial[material.id] ?? 0 })));
      setTemplates(((templateData ?? []) as Array<{ id: string; name: string; function_template_items: Array<{ material_name: string; material_id: string | null; quantity: number }> }>).map((template) => ({ id: template.id, name: template.name, items: template.function_template_items })));
    } catch (unexpectedError) {
      if (mountedRef.current && requestId === loadOptionsRequestRef.current) {
        clearLoadedOptions();
        setCanRetryLoad(true);
        setError(friendlyError(unexpectedError, "Não foi possível carregar os dados."));
      }
    } finally {
      if (mountedRef.current && requestId === loadOptionsRequestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { const refresh = () => void loadOptions(); const events = ["delivery-created", "return-created", "stock-entry-created", "stock-entry-updated", "stock-entry-deleted"]; events.forEach((eventName) => window.addEventListener(eventName, refresh)); void loadOptions(); return () => { mountedRef.current = false; events.forEach((eventName) => window.removeEventListener(eventName, refresh)); }; }, [loadOptions]);
  useEffect(() => { if (!success) return; const timer = window.setTimeout(() => setSuccess(""), 4500); return () => window.clearTimeout(timer); }, [success]);
  function retryLoadOptions() { if (!canRetryLoad && !error) return; setLoading(true); setError(""); void loadOptions(); }
  useEffect(() => {
    let active = true;
    setVariantsLoading(true);
    async function loadVariants() {
      try {
        const { data, error: variantError } = await createClient().from("material_variants").select("id,material_id,name,size,active").eq("active", true).order("name");
        if (!active) return;
        if (variantError) {
          setVariants([]);
          setCanRetryLoad(true);
          setError(friendlyError(variantError, "Não foi possível carregar as variações."));
          return;
        }
        setVariants((data ?? []) as MaterialVariant[]);
      } catch (unexpectedError) {
        if (active) {
          setVariants([]);
          setCanRetryLoad(true);
          setError(friendlyError(unexpectedError, "Não foi possível carregar as variações."));
        }
      } finally {
        if (active) setVariantsLoading(false);
      }
    }
    void loadVariants();
    return () => { active = false; };
  }, []);
  useEffect(() => { if (materialSuggestionsOpen !== null && items[materialSuggestionsOpen]?.material_id) setMaterialSuggestionsOpen(null); }, [items, materialSuggestionsOpen]);
  const normalizedEmployeeQuery = normalize(employeeQuery);
  const filteredEmployees = employees.filter((employee) => normalize(`${employee.full_name} ${employee.registration} ${employee.department ?? ""} ${employee.function_name ?? ""} ${employee.job_title ?? ""}`).includes(normalizedEmployeeQuery)).slice(0, 8);
  function filteredMaterials(query: string) { const normalizedQuery = normalize(query); return materials.filter((material) => normalize(`${material.name} ${material.internal_code}`).includes(normalizedQuery)).slice(0, 8); }
  function isRubberBoot(material: Material | undefined) { return Boolean(material && normalize(material.name).includes("bota de borracha")); }
  function variantsFor(materialId: string) { return variants.filter((variant) => variant.material_id === materialId && variant.active); }
  function eligibleLotsFor(materialId: string, variantId: string | null = null) {
    const material = materials.find((candidate) => candidate.id === materialId);
    if (!material) return [];
    return testLots.filter((lot) => {
      if (lot.material_id !== materialId || lot.variant_id !== variantId || Number(lot.available_quantity) <= 0) return false;
      if (lot.expires_at && lot.expires_at < deliveredAt) return false;
      if (material.ca_required) {
        const caNumber = lot.ca_number?.trim() ?? "";
        const certificate = caCertificates[caNumber];
        const caExpiry = certificate?.valid_until || lot.ca_expires_at;
        const status = normalize(certificate?.status ?? "");
        if (!caNumber || ["PENDENTE", "N/A"].includes(caNumber.toUpperCase())) return false;
        if (caExpiry && caExpiry < deliveredAt) return false;
        if (["cancel", "suspens", "revog", "inativ", "inval", "vencid", "expir"].some((word) => status.includes(word))) return false;
      }
      if (material.test_required) {
        if (!lot.test_performed_at || !lot.test_expires_at || lot.test_performed_at > deliveredAt || lot.test_expires_at < deliveredAt) return false;
        if (material.report_required && !lot.test_report_number?.trim()) return false;
      }
      return true;
    });
  }
  function availableFor(item: DeliveryItem) { return eligibleLotsFor(item.material_id, item.variant_id || null).reduce((sum, lot) => sum + Number(lot.available_quantity), 0); }
  function availableForVariant(materialId: string, variantId: string) { return eligibleLotsFor(materialId, variantId).reduce((sum, lot) => sum + Number(lot.available_quantity), 0); }
  function selectEmployee(employee: Employee) {
    const employeeChanged = employee.id !== employeeId;
    setEmployeeId(employee.id);
    setEmployeeFunction(employee.function_name || employee.job_title || "");
    setEmployeeQuery(employee.full_name);
    setEmployeeSuggestionsOpen(false);
    if (employeeChanged) {
      setItems([newDeliveryItem()]);
      setMaterialSuggestionsOpen(null);
    }
  }
  const selectedTemplate = templates.find((template) => employeeFunction && functionKey(template.name) === functionKey(employeeFunction));
  function loadFunctionMaterials() { if (!selectedTemplate) return; const missing: string[] = []; const loaded = selectedTemplate.items.map((templateItem) => { const material = materials.find((candidate) => candidate.id === templateItem.material_id) ?? materials.find((candidate) => normalize(candidate.name) === normalize(templateItem.material_name)); if (!material) { missing.push(templateItem.material_name); return null; } return { ...newDeliveryItem(), material_id: material.id, materialQuery: material.name, quantity: String(templateItem.quantity), expected_replacement_at: calculateReplacementDate(deliveredAt, material.replacement_interval_days) }; }).filter((item): item is DeliveryItem => item !== null); setItems(loaded.length ? loaded : [newDeliveryItem()]); setError(missing.length ? `Alguns materiais da função não foram encontrados no catálogo: ${missing.join(", ")}.` : ""); }
  function selectMaterial(index: number, material: Material) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, material_id: material.id, materialQuery: material.name, variant_id: "", quantity: "1", expected_replacement_at: calculateReplacementDate(deliveredAt, material.replacement_interval_days) } : item)); setMaterialSuggestionsOpen(null); }
  function updateDeliveryDate(value: string) { setDeliveredAt(value); setItems((current) => current.map((item) => { const material = materials.find((candidate) => candidate.id === item.material_id); return { ...item, expected_replacement_at: calculateReplacementDate(value, material?.replacement_interval_days ?? null) }; })); }
  function updateItem(index: number, field: keyof DeliveryItem, value: string) { setItems((current) => current.map((item, itemIndex) => { if (itemIndex !== index) return item; const next = { ...item, [field]: value }; if (field === "variant_id" && value) { const variantStock = availableForVariant(item.material_id, value); next.quantity = variantStock > 0 ? String(Math.min(Math.max(Number(item.quantity) || 1, 1), variantStock)) : item.quantity; } return next; })); }
  const requestedByStockKey = items.reduce<Record<string, number>>((sum, item) => { const key = item.variant_id || item.material_id; const quantity = Number(item.quantity); if (key) sum[key] = (sum[key] ?? 0) + (Number.isFinite(quantity) ? quantity : 0); return sum; }, {});
  const formLoading = loading || variantsLoading;
  const hasInsufficientStock = items.some((item) => { const available = availableFor(item); const requested = requestedByStockKey[item.variant_id || item.material_id] ?? Number(item.quantity); return !item.material_id || !Number.isInteger(Number(item.quantity)) || available <= 0 || requested <= 0 || requested > available; });
  const hasMissingRequiredVariant = items.some((item) => variantsFor(item.material_id).length > 0 && !item.variant_id);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || submitLockRef.current) return;
    setError("");
    setSuccess("");
    setCanRetryLoad(false);
    if (formLoading) {
      setError("Aguarde o carregamento completo do catálogo e do estoque.");
      return;
    }
    if (!employeeId) {
      setError("Selecione o funcionário que receberá os equipamentos.");
      return;
    }
    if (!isValidDateValue(deliveredAt)) {
      setError("Informe uma data de entrega válida.");
      return;
    }
    if (hasInsufficientStock) {
      setError("Não é possível confirmar: informe quantidades inteiras e suficientes para o saldo disponível.");
      return;
    }
    if (hasMissingRequiredVariant) {
      setError("Informe a numeração da bota de borracha.");
      return;
    }
    if (items.some((item) => item.material_id && availableFor(item) <= 0)) {
      setError("Não há lote com CA e ensaio válidos para um dos materiais na data da entrega.");
      return;
    }
    submitLockRef.current = true;
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: deliveryId, error: deliveryError } = await supabase.rpc("register_delivery", {
        p_employee_id: employeeId,
        p_reason: reason,
        p_delivered_at: deliveredAt,
        p_items: items.map((item) => ({
          material_id: item.material_id,
          variant_id: item.variant_id || null,
          quantity: Number(item.quantity),
          expected_replacement_at: item.expected_replacement_at || null,
        })),
        p_notes: notes || null,
      });
      if (deliveryError) {
        setError(deliveryError.message.includes("Estoque insuficiente") ? "Estoque insuficiente para um dos materiais selecionados." : friendlyError(deliveryError, "Não foi possível registrar a entrega."));
        return;
      }
      const photoResult = deliveryId && photoFiles.length ? await uploadTransactionPhotos(supabase, { files: photoFiles, recordId: deliveryId, type: "delivery" }) : null;
      setSuccess(photoResult?.error ? "Entrega registrada. As fotos não foram anexadas; você pode anexá-las em Últimas entregas." : "Entrega registrada e o estoque foi atualizado pelo lote mais próximo do vencimento.");
      window.dispatchEvent(new Event("delivery-created"));
      setEmployeeId("");
      setEmployeeFunction("");
      setEmployeeQuery("");
      setItems([newDeliveryItem()]);
      setNotes("");
      setPhotoFiles([]);
    } catch (unexpectedError) {
      setError(friendlyError(unexpectedError, "Não foi possível registrar a entrega."));
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  }
  return <main className="module-shell">
    <header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h1>Nova entrega</h1><p className="module-subtitle">Registre vários EPIs/EPCs em uma única entrega para o funcionário.</p></div><Link className="secondary-button" href="/employees"><ArrowLeft size={16} /> Funcionários</Link></header>
    {success && <div className="feedback success-feedback" role="status"><Check size={17} /> {success}</div>}
    {error && <FeedbackMessage onRetry={canRetryLoad ? retryLoadOptions : undefined}>{error}</FeedbackMessage>}
    <section className="panel entry-card delivery-card">
      <div className="entry-intro"><div className="entry-icon"><ClipboardCheck size={22} /></div><div><h2>Ficha de entrega</h2><p>CA, validade e dados do ensaio são puxados automaticamente do lote que será baixado (FEFO).</p></div></div>
      <form className="material-form" onSubmit={submit}>
        <div className="form-grid three">
          <label className="employee-picker">Funcionário<div className="employee-picker-control"><input value={employeeQuery} onChange={(event) => { setEmployeeQuery(event.target.value); setEmployeeId(""); setEmployeeFunction(""); setEmployeeSuggestionsOpen(true); }} onFocus={() => { if (!employeeId) setEmployeeSuggestionsOpen(true); }} placeholder="Digite nome, matrícula ou setor" required disabled={loading} autoComplete="off" />{employeeSuggestionsOpen && employeeQuery && <div className="employee-suggestions">{filteredEmployees.map((employee) => <button type="button" key={employee.id} onMouseDown={() => selectEmployee(employee)}><strong>{employee.full_name}</strong><small>{employee.registration}{employee.department ? ` · ${employee.department}` : ""}</small></button>)}{!filteredEmployees.length && <span>Nenhum funcionário encontrado.</span>}</div>}</div>{employeeId && <><small className="employee-function-info">Matrícula: {employees.find((employee) => employee.id === employeeId)?.registration || "Não informada"}</small><small className="employee-function-info">Função: {employeeFunction || "Não informada"}</small></>}</label>
          <label>Data da entrega<input type="date" value={deliveredAt} onChange={(event) => updateDeliveryDate(event.target.value)} required /></label>
          <label>Motivo<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="delivery-items-header"><div><h3>Equipamentos entregues</h3><p>O sistema aplica FEFO e seleciona somente lotes com documentação válida.</p></div>{selectedTemplate && <button type="button" className="template-load-button" onClick={loadFunctionMaterials}>Carregar materiais da função</button>}<button type="button" className="secondary-button" onClick={() => setItems((current) => [...current, newDeliveryItem()])}><Plus size={15} /> Adicionar item</button></div>
        <div className="delivery-items">{items.map((item, index) => {
          const selectedMaterial = materials.find((material) => material.id === item.material_id);
          const eligibleLots = eligibleLotsFor(item.material_id, item.variant_id || null).slice().sort((a, b) => (a.expires_at || "9999-12-31").localeCompare(b.expires_at || "9999-12-31") || a.entry_date.localeCompare(b.entry_date));
          const available = eligibleLots.reduce((sum, lot) => sum + Number(lot.available_quantity), 0);
          const requested = Number(item.quantity) || 0;
          const isTestable = Boolean(selectedMaterial?.test_required);
          const firstLot = eligibleLots[0];
          const firstCertificate = firstLot?.ca_number ? caCertificates[firstLot.ca_number] : undefined;
          const caExpiry = firstCertificate?.valid_until || firstLot?.ca_expires_at;
          return <div className="delivery-item-row" key={`${index}-${item.material_id}`}>
            <span className="item-index">{index + 1}</span>
            <label className="material-picker">Material<div className="material-picker-control"><input value={item.materialQuery} onChange={(event) => { setItems((current) => current.map((currentItem, itemIndex) => itemIndex === index ? { ...currentItem, material_id: "", materialQuery: event.target.value, quantity: "1" } : currentItem)); setMaterialSuggestionsOpen(index); }} onFocus={() => { if (!item.material_id) setMaterialSuggestionsOpen(index); }} placeholder="Digite nome ou código" required disabled={loading} autoComplete="off" />{materialSuggestionsOpen === index && !item.material_id && item.materialQuery && <div className="employee-suggestions">{filteredMaterials(item.materialQuery).map((material) => <button type="button" key={material.id} onMouseDown={() => selectMaterial(index, material)}><strong>{material.name}</strong><small>{material.internal_code || "Código não informado"} · {eligibleLotsFor(material.id).reduce((sum, lot) => sum + Number(lot.available_quantity), 0)} disponíveis com documentação elegível</small></button>)}{!filteredMaterials(item.materialQuery).length && <span>Nenhum material encontrado.</span>}</div>}</div>
              {item.material_id && <span className={`stock-availability ${available <= requested ? "stock-availability-danger" : "stock-availability-warning"}`}>{available} disponíveis em lotes elegíveis</span>}
              {item.material_id && available <= 0 && <span className="stock-availability stock-availability-danger">Sem lote elegível. Confira o saldo, o CA e os dados/validade do ensaio no Estoque.</span>}
              {item.material_id && available > 0 && requested > available && <span className="stock-availability stock-availability-danger">Quantidade solicitada maior que o saldo elegível.</span>}
              {isTestable && <span className="material-test-badge">Material ensaiável — dados do lote</span>}
              {firstLot?.ca_number && <span className="material-compliance-info">CA {firstLot.ca_number}{caExpiry ? ` · validade oficial até ${new Date(`${caExpiry}T00:00:00`).toLocaleDateString("pt-BR")}` : " · validade não confirmada"}</span>}
              {isTestable && firstLot?.test_performed_at && <span className="material-compliance-info">{firstLot.test_number ? `Ensaio ${firstLot.test_number} · ` : "Ensaio em "}{new Date(`${firstLot.test_performed_at}T00:00:00`).toLocaleDateString("pt-BR")} · validade até {firstLot.test_expires_at ? new Date(`${firstLot.test_expires_at}T00:00:00`).toLocaleDateString("pt-BR") : "não informada"}{firstLot.test_report_number ? ` · Laudo ${firstLot.test_report_number}` : ""}</span>}
            </label>
            {variantsFor(item.material_id).length > 0 && <label>{isRubberBoot(selectedMaterial) ? "Número da bota" : "Tamanho"}<select value={item.variant_id} onChange={(event) => updateItem(index, "variant_id", event.target.value)} required><option value="">Selecione o tamanho</option>{variantsFor(item.material_id).map((variant) => { const label = variant.size || variant.name; const variantStock = availableForVariant(item.material_id, variant.id); return <option key={variant.id} value={variant.id} disabled={variantStock <= 0}>{label} · {variantStock} disponíveis</option>; })}</select></label>}
            <label>Quantidade<input type="number" min={item.material_id && available <= 0 ? undefined : 1} max={item.material_id ? available : undefined} value={item.quantity} onChange={(event) => updateItem(index, "quantity", item.material_id && available > 0 ? String(Math.min(Number(event.target.value) || 1, available)) : event.target.value)} required disabled={Boolean(item.material_id && available <= 0)} /></label>
            {!isTestable && <label>Troca prevista (automática)<input type="date" value={item.expected_replacement_at} onChange={(event) => updateItem(index, "expected_replacement_at", event.target.value)} readOnly placeholder="Configure no material" /></label>}
            {items.length > 1 && <button type="button" className="remove-item" aria-label={`Remover item ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>}
          </div>;
        })}</div>
        <div className="transaction-photo-field"><div><strong>Fotos da entrega</strong><span>Opcional: registre os materiais entregues.</span></div><label className="action-button upload-term-button">Adicionar fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectPhotos} /></label>{photoFiles.length > 0 && <div className="transaction-photo-list">{photoFiles.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" onClick={() => setPhotoFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button></span>)}</div>}</div>
        <label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Termo, condições ou observações da entrega" rows={3} /></label>
        <div className="modal-actions"><Link className="secondary-button" href="/stock">Consultar estoque</Link><button className="primary-button" disabled={saving || loading || !employees.length || !materials.length || hasInsufficientStock || hasMissingRequiredVariant}>{hasInsufficientStock ? "Indisponível: verifique o estoque" : saving ? "Registrando..." : "Confirmar entrega"}<Check size={16} /></button></div>
      </form>
    </section>
    <RecentDeliveries />
  </main>;
}
