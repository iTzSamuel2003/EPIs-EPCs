"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Check, ExternalLink, LoaderCircle, Pencil, Plus, Search, ShieldCheck, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import type { MaterialType } from "@/types/domain";
import { FeedbackMessage } from "@/components/feedback-message";

type MaterialRow = {
  id: string; internal_code: string | null; name: string; type: MaterialType; unit: string; size: string | null;
  description: string | null; brand: string | null; manufacturer: string | null; model: string | null;
  ca_number: string | null; ca_expires_at: string | null; useful_life_months: number | null; replacement_interval_days: number | null;
  ca_required: boolean; test_required: boolean; test_type: string | null; test_interval_months: number | null; report_required: boolean; art_required: boolean;
  minimum_stock: number; location: string | null; notes: string | null; status: "active" | "inactive";
};
type VariationType = "none" | "size" | "number" | "custom";
type MaterialVariant = { id: string; material_id: string; name: string; size: string | null; active: boolean };
type MaterialForm = {
  name: string; type: MaterialType; unit: string; size: string; legacySize: string; description: string;
  variationType: VariationType; selectedVariations: string[];
  brand: string; manufacturer: string; model: string; ca_number: string; ca_expires_at: string;
  ca_required: boolean; test_required: boolean; test_type: string; test_interval_months: string; report_required: boolean; art_required: boolean;
  useful_life_months: string; replacement_interval_days: string; minimum_stock: string; location: string; notes: string; status: "active" | "inactive";
};

type CaCertificate = {
  ca_number: string; status: string | null; valid_until: string | null; process_number: string | null;
  manufacturer_name: string | null; manufacturer_document: string | null; equipment_name: string | null;
  equipment_description: string | null; brand: string | null; reference: string | null; standard: string | null;
};

type CaLookupState = { status: "idle" | "loading" | "found" | "not-found" | "error"; certificate?: CaCertificate };
type AutoFilledCaFields = { caNumber: string; values: Partial<Pick<MaterialForm, "ca_expires_at" | "manufacturer" | "brand" | "model" | "description">> };

const STANDARD_UNITS = [
  { value: "un.", label: "Unidade (un.)" },
  { value: "PAR", label: "Par" },
  { value: "m", label: "Metro (m)" },
];

const SIZE_VARIATION_OPTIONS = ["P", "M", "G", "GG", "XGG"];
const NUMBER_VARIATION_OPTIONS = ["36", "37", "38", "39", "40", "41", "42"];
const VARIATION_TYPE_LABELS: Record<VariationType, string> = {
  none: "N/A — não se aplica",
  size: "Tamanho — P, M, G, GG, XGG",
  number: "Numeração — 36, 37, 38, 39, 40, 41, 42",
  custom: "Personalizada",
};

function getMaterialSizeOptions(_materialName?: string) {
  void _materialName;
  return [VARIATION_TYPE_LABELS.none, VARIATION_TYPE_LABELS.size, VARIATION_TYPE_LABELS.number];
}

function variationTypeFromLabel(label: string): VariationType {
  return (Object.entries(VARIATION_TYPE_LABELS).find(([, value]) => value === label)?.[0] as VariationType | undefined) ?? "none";
}

function variationValue(variant: Pick<MaterialVariant, "name" | "size">) {
  return (variant.size || variant.name).trim();
}

function variationTypeFor(values: string[]): VariationType {
  if (!values.length) return "none";
  if (values.every((value) => SIZE_VARIATION_OPTIONS.includes(value.toUpperCase()))) return "size";
  if (values.every((value) => /^\d+$/.test(value))) return "number";
  return "custom";
}

function variationTypeForMaterial(material: MaterialRow, variants: MaterialVariant[]): VariationType {
  const activeValues = variants.filter((variant) => variant.active).map(variationValue).filter(Boolean);
  return variationTypeFor(activeValues.length ? activeValues : material.size ? [material.size.trim()] : []);
}

const emptyForm: MaterialForm = {
  name: "", type: "EPI", unit: "un.", size: VARIATION_TYPE_LABELS.none, legacySize: "", description: "", brand: "", manufacturer: "",
  variationType: "none", selectedVariations: [],
  model: "", ca_number: "", ca_expires_at: "", useful_life_months: "", replacement_interval_days: "", minimum_stock: "0",
  location: "", notes: "", status: "active", ca_required: true, test_required: false, test_type: "inspection", test_interval_months: "12", report_required: false, art_required: false,
};

function formFromMaterial(material: MaterialRow, variants: MaterialVariant[]): MaterialForm {
  const activeVariants = variants.filter((variant) => variant.active);
  const variationType = variationTypeForMaterial(material, variants);
  const selectedVariations = variationType === "size" ? [...SIZE_VARIATION_OPTIONS]
    : variationType === "number" ? [...NUMBER_VARIATION_OPTIONS]
    : variationType === "custom" ? activeVariants.map(variationValue)
    : [];
  return {
    name: material.name, type: material.type, unit: material.unit, size: VARIATION_TYPE_LABELS[variationType], legacySize: material.size ?? "",
    variationType,
    selectedVariations,
    description: material.description ?? "", brand: material.brand ?? "", manufacturer: material.manufacturer ?? "",
    model: material.model ?? "", ca_number: material.ca_number ?? "", ca_expires_at: material.ca_expires_at ?? "",
    ca_required: material.ca_required, test_required: material.test_required, test_type: material.test_type ?? "inspection", test_interval_months: material.test_interval_months?.toString() ?? "12", report_required: material.report_required, art_required: material.art_required,
    useful_life_months: material.useful_life_months?.toString() ?? "", replacement_interval_days: material.replacement_interval_days?.toString() ?? "", minimum_stock: material.minimum_stock.toString(),
    location: material.location ?? "", notes: material.notes ?? "", status: material.status,
  };
}

function isValidDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isNonNegativeNumber(value: string, integer = false) {
  if (!value.trim()) return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && (!integer || Number.isInteger(parsed));
}

export default function MaterialsPage() {
  const searchParams = useSearchParams();
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [materialVariants, setMaterialVariants] = useState<MaterialVariant[]>([]);
  const [form, setForm] = useState<MaterialForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [caLookup, setCaLookup] = useState<CaLookupState>({ status: "idle" });
  const loadVersion = useRef(0);
  const caLookupVersion = useRef(0);
  const autoFilledCaRef = useRef<AutoFilledCaFields | null>(null);
  const mountedRef = useRef(true);
  const saveLockRef = useRef(false);

  useEffect(() => {
    const initialSearch = searchParams.get("search");
    if (initialSearch) setQuery(initialSearch);
  }, [searchParams]);

  useEffect(() => {
    const caNumber = showForm && form.type === "EPI" ? form.ca_number.trim() : "";
    const version = ++caLookupVersion.current;
    if (!caNumber) {
      setCaLookup({ status: "idle" });
      return;
    }

    setCaLookup({ status: "loading" });
    const timer = window.setTimeout(async () => {
      try {
        const supabase = createClient();
        const { data, error: lookupError } = await supabase.from("ca_certificates")
          .select("ca_number,status,valid_until,process_number,manufacturer_name,manufacturer_document,equipment_name,equipment_description,brand,reference,standard")
          .eq("ca_number", caNumber)
          .maybeSingle();
        if (version !== caLookupVersion.current) return;
        if (lookupError) throw lookupError;
        if (!data) {
          setCaLookup({ status: "not-found" });
          return;
        }

        const certificate = data as CaCertificate;
        const values: AutoFilledCaFields["values"] = {
          ca_expires_at: certificate.valid_until ?? "",
          manufacturer: certificate.manufacturer_name ?? "",
          brand: certificate.brand ?? "",
          model: certificate.reference ?? "",
          description: certificate.equipment_description ?? "",
        };
        const previousAutoFill = autoFilledCaRef.current;
        autoFilledCaRef.current = { caNumber, values };
        setForm((current) => {
          if (current.type !== "EPI" || current.ca_number.trim() !== caNumber) return current;
          const canReplace = (field: keyof AutoFilledCaFields["values"]) =>
            !current[field].trim() || Boolean(previousAutoFill?.values[field] && current[field] === previousAutoFill.values[field]);
          return {
            ...current,
            ca_expires_at: values.ca_expires_at || current.ca_expires_at,
            manufacturer: values.manufacturer && canReplace("manufacturer") ? values.manufacturer : current.manufacturer,
            brand: values.brand && canReplace("brand") ? values.brand : current.brand,
            model: values.model && canReplace("model") ? values.model : current.model,
            description: values.description && canReplace("description") ? values.description : current.description,
          };
        });
        setCaLookup({ status: "found", certificate });
      } catch {
        if (version === caLookupVersion.current) setCaLookup({ status: "error" });
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      if (caLookupVersion.current === version) caLookupVersion.current += 1;
    };
  }, [form.ca_number, form.type, showForm, editingId]);

  async function loadMaterials() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    setMaterials([]);
    setMaterialVariants([]);
    try {
    const supabase = createClient();
    const [{ data, error: materialsError }, { data: variants, error: variantsError }] = await Promise.all([
      supabase.from("materials").select("id,internal_code,name,type,unit,size,description,brand,manufacturer,model,ca_number,ca_expires_at,useful_life_months,replacement_interval_days,minimum_stock,location,notes,status,ca_required,test_required,test_type,test_interval_months,report_required,art_required").order("name"),
      supabase.from("material_variants").select("id,material_id,name,size,active"),
    ]);
    if (!mountedRef.current || version !== loadVersion.current) return;
    if (materialsError || variantsError) setError(friendlyError(materialsError ?? variantsError, "Falha ao carregar materiais e variações."));
    else {
      setMaterials((data ?? []) as MaterialRow[]);
      setMaterialVariants((variants ?? []) as MaterialVariant[]);
    }
    } catch (caught) {
      if (mountedRef.current && version === loadVersion.current) setError(friendlyError(caught, "Falha ao carregar materiais."));
    } finally {
      if (mountedRef.current && version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadMaterials();
    return () => { mountedRef.current = false; loadVersion.current += 1; };
  }, []);

  const filtered = useMemo(() => materials
    .filter((material) => {
      return `${material.name} ${material.internal_code} ${material.ca_number ?? ""}`.toLowerCase().includes(query.toLowerCase())
        && (typeFilter === "all" || (typeFilter === "EPI_EPC" ? material.type === "EPI" || material.type === "EPC" : material.type === typeFilter))
        && (statusFilter === "all" || material.status === statusFilter);
    })
    .sort((a, b) => ascending ? a.name.localeCompare(b.name, "pt-BR") : b.name.localeCompare(a.name, "pt-BR")), [materials, query, typeFilter, statusFilter, ascending]);

  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedMaterials = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [query, typeFilter, statusFilter, ascending]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const sizeOptions = useMemo(() => form.variationType === "custom"
    ? [...getMaterialSizeOptions(), VARIATION_TYPE_LABELS.custom]
    : getMaterialSizeOptions(), [form.variationType]);

  function updateField(field: keyof MaterialForm, value: string | boolean) {
    if (field === "size" && typeof value === "string") {
      const variationType = variationTypeFromLabel(value);
      const selectedVariations = variationType === "size" ? [...SIZE_VARIATION_OPTIONS]
        : variationType === "number" ? [...NUMBER_VARIATION_OPTIONS]
        : variationType === "custom" ? form.selectedVariations : [];
      setForm((current) => ({ ...current, size: value, variationType, selectedVariations }));
      return;
    }
    setForm((current) => ({ ...current, [field]: value }));
  }
  function updateMaterialName(value: string) { updateField("name", value); }
  function updateCaNumber(value: string) {
    const previous = autoFilledCaRef.current;
    if (!previous || previous.caNumber === value.trim()) {
      updateField("ca_number", value);
      return;
    }
    autoFilledCaRef.current = null;
    setForm((current) => ({
      ...current,
      ca_number: value,
      ca_expires_at: previous.values.ca_expires_at && current.ca_expires_at === previous.values.ca_expires_at ? "" : current.ca_expires_at,
      manufacturer: previous.values.manufacturer && current.manufacturer === previous.values.manufacturer ? "" : current.manufacturer,
      brand: previous.values.brand && current.brand === previous.values.brand ? "" : current.brand,
      model: previous.values.model && current.model === previous.values.model ? "" : current.model,
      description: previous.values.description && current.description === previous.values.description ? "" : current.description,
    }));
  }
  function openNew() {
    autoFilledCaRef.current = null;
    setCaLookup({ status: "idle" });
    setForm(emptyForm); setEditingId(null); setError(""); setSuccess(""); setShowForm(true);
  }
  function openEdit(material: MaterialRow) {
    autoFilledCaRef.current = null;
    setCaLookup({ status: "idle" });
    setForm(formFromMaterial(material, materialVariants.filter((variant) => variant.material_id === material.id))); setEditingId(material.id); setError(""); setSuccess(""); setShowForm(true);
  }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault();
    if (saving || saveLockRef.current) return;
    setError(""); setSuccess("");
    if (!form.name.trim()) { setError("Informe o nome do material."); return; }
    if (!form.unit.trim()) { setError("Informe a unidade do material."); return; }
    if (form.type === "EPI" && !form.ca_number.trim()) { setError("O número do CA é obrigatório para materiais do tipo EPI."); return; }
    if (!isValidDateValue(form.ca_expires_at) && form.ca_expires_at) { setError("Informe uma validade de CA válida."); return; }
    if (!isNonNegativeNumber(form.minimum_stock, true) || !isNonNegativeNumber(form.useful_life_months, true) || !isNonNegativeNumber(form.replacement_interval_days, true)) {
      setError("Estoque mínimo, vida útil e troca prevista devem ser números inteiros iguais ou maiores que zero.");
      return;
    }
    if (form.variationType !== "none" && form.selectedVariations.length === 0) {
      setError("Selecione ao menos uma opção de tamanho ou numeração, ou escolha N/A.");
      return;
    }
    saveLockRef.current = true;
    setSaving(true);
    try {
    const supabase = createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError) { setError(friendlyError(authError, "Não foi possível concluir a operação.")); setSaving(false); return; }
    if (!auth.user) { setError("Sua sessão expirou. Entre novamente."); setSaving(false); return; }
    const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).single();
    if (profileError) { setError(friendlyError(profileError, "Não foi possível concluir a operação.")); setSaving(false); return; }
    if (!profile?.organization_id) { setError("Não foi possível identificar a organização do usuário."); setSaving(false); return; }
    let currentVariants: MaterialVariant[] = [];
    if (editingId) {
      const { data: existingVariants, error: variantsError } = await supabase.from("material_variants").select("id,material_id,name,size,active").eq("material_id", editingId);
      if (variantsError) { setError(friendlyError(variantsError, "Não foi possível conferir as variações atuais.")); return; }
      currentVariants = (existingVariants ?? []) as MaterialVariant[];
      const desiredValues = new Set(form.variationType === "none" ? [] : form.selectedVariations);
      const variantsToDeactivate = currentVariants.filter((variant) => variant.active && !desiredValues.has(variationValue(variant)));
      if (variantsToDeactivate.length) {
        const variantIds = variantsToDeactivate.map((variant) => variant.id);
        const [{ data: lotReferences, error: lotReferenceError }, { data: deliveryReferences, error: deliveryReferenceError }] = await Promise.all([
          supabase.from("material_lots").select("variant_id").in("variant_id", variantIds).limit(1),
          supabase.from("delivery_items").select("variant_id").in("variant_id", variantIds).limit(1),
        ]);
        if (lotReferenceError || deliveryReferenceError) {
          setError(friendlyError(lotReferenceError ?? deliveryReferenceError, "Não foi possível verificar o histórico das variações."));
          return;
        }
        if (lotReferences?.length || deliveryReferences?.length) {
          setError("Não é possível remover opções de tamanho já vinculadas ao estoque ou a entregas. Mantenha essas opções selecionadas para preservar o histórico.");
          return;
        }
      }
    }
    const existingInternalCode = editingId ? materials.find((material) => material.id === editingId)?.internal_code ?? null : null;
    const payload = {
      internal_code: existingInternalCode, name: form.name.trim().toLocaleUpperCase("pt-BR"), type: form.type, unit: form.unit, size: form.variationType === "none" ? null : form.legacySize.trim() || null,
      description: form.description.trim() || null, brand: form.brand.trim() || null, manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null, ca_number: form.type === "EPI" ? form.ca_number.trim() : null,
      ca_expires_at: form.type === "EPI" ? form.ca_expires_at || null : null,
      ca_required: form.type === "EPI" ? form.ca_required : false, test_required: form.test_required,
      test_type: form.test_required ? form.test_type : null, test_interval_months: form.test_required && form.test_interval_months ? Number(form.test_interval_months) : null,
      report_required: form.test_required ? form.report_required : false, art_required: form.test_required ? form.art_required : false,
      useful_life_months: form.useful_life_months ? Number(form.useful_life_months) : null,
      replacement_interval_days: form.replacement_interval_days ? Number(form.replacement_interval_days) : null,
      minimum_stock: Number(form.minimum_stock) || 0, location: form.location.trim() || null,
      notes: form.notes.trim() || null, status: form.status,
    };
    let saveError: { code?: string; message?: string } | null = null;
    let savedId: string | null = null;
    if (editingId) {
      const result = await supabase.from("materials").update(payload).eq("id", editingId).select("id").maybeSingle();
      saveError = result.error;
      savedId = result.data?.id ?? null;
    } else {
      const result = await supabase.from("materials").insert({ ...payload, organization_id: profile.organization_id }).select("id").single();
      saveError = result.error;
      savedId = result.data?.id ?? null;
    }
    if (saveError || !savedId) setError(saveError?.code === "23505" ? "Já existe um cadastro conflitante para este material." : friendlyError(saveError, "Não foi possível salvar as alterações. Verifique suas permissões."));
    else {
      try {
        const desiredValues = form.variationType === "none" ? [] : form.selectedVariations;
        for (const value of desiredValues) {
          const existingVariant = currentVariants.find((variant) => variationValue(variant) === value);
          if (existingVariant) {
            if (!existingVariant.active) {
              const { error: activateError } = await supabase.from("material_variants").update({ active: true }).eq("id", existingVariant.id);
              if (activateError) throw activateError;
            }
          } else {
            const { error: insertVariantError } = await supabase.from("material_variants").insert({ organization_id: profile.organization_id, material_id: savedId, name: value, size: value, active: true });
            if (insertVariantError) throw insertVariantError;
          }
        }
        const desiredSet = new Set(desiredValues);
        const variantsToDeactivate = currentVariants.filter((variant) => variant.active && !desiredSet.has(variationValue(variant)));
        if (variantsToDeactivate.length) {
          const { error: deactivateError } = await supabase.from("material_variants").update({ active: false }).in("id", variantsToDeactivate.map((variant) => variant.id));
          if (deactivateError) throw deactivateError;
        }
      } catch (variantSaveError) {
        setEditingId(savedId);
        setError(`Material salvo, mas não foi possível atualizar as opções de tamanho. Reabra o cadastro e tente novamente. ${friendlyError(variantSaveError, "Falha ao salvar as variações.")}`);
        await loadMaterials();
        return;
      }
      setSuccess(editingId ? "Material atualizado com sucesso." : "Material cadastrado com sucesso.");
      setShowForm(false);
      await loadMaterials();
    }
    } catch (caught) {
      setError(friendlyError(caught, "Falha ao salvar o material."));
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  return <main className="module-shell materials-page">
    <header className="module-header"><div><p className="eyebrow">CADASTRO E CONTROLE</p><h1>Materiais</h1><p className="module-subtitle">Cadastre EPIs, EPCs e ferramentais. Quantidade, localização e situação atual ficam em Estoque.</p></div><button type="button" className="primary-button" onClick={openNew}><Plus size={17} /> Novo material</button></header>
    {success && <div className="feedback success-feedback" role="status"><Check size={17} /> {success}</div>}
    {error && !showForm && <FeedbackMessage onRetry={() => void loadMaterials()}>{error}</FeedbackMessage>}
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar por nome ou CA" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou CA" /></div><select aria-label="Filtrar por grupo de materiais" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos os tipos</option><option value="EPI_EPC">EPIs e EPCs</option><option value="FERRAMENTAL">Ferramentais</option></select><select aria-label="Filtrar situação do cadastro" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos os cadastros</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></section>
    <section className="module-summary"><div><strong>{materials.filter((item) => item.status === "active").length}</strong><span>materiais ativos</span></div><div><strong>{materials.filter((item) => item.status === "active" && item.type === "EPI").length}</strong><span>EPIs ativos</span></div><div><strong>{materials.filter((item) => item.status === "active" && item.type === "EPC").length}</strong><span>EPCs ativos</span></div><div><strong>{materials.filter((item) => item.status === "active" && item.type === "FERRAMENTAL").length}</strong><span>ferramentais ativos</span></div></section>
    {!showForm && <>
      <section className="panel module-table-card"><div className="panel-header"><div><h2>Catálogo de materiais</h2><p>{filtered.length} resultado(s) encontrados</p></div><button className="select-button" onClick={() => setAscending((current) => !current)}>{ascending ? "Nome: A–Z" : "Nome: Z–A"} {ascending ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}</button></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando materiais...</div> : <div className="table-wrap"><table className="materials-catalog-table" aria-label="Catálogo de materiais"><thead><tr><th>MATERIAL</th><th>TIPO</th><th>CA</th><th>AÇÕES</th></tr></thead><tbody>{paginatedMaterials.map((material) => <tr key={material.id}><td><div className="material-cell material-catalog-cell"><div><strong>{material.name}</strong><small>{material.unit}</small></div></div></td><td><span className={`type-badge ${material.type.toLowerCase()}`}>{material.type}</span></td><td>{material.ca_number || <span className="muted-cell">Não se aplica</span>}</td><td><button className="action-button" onClick={() => openEdit(material)}><Pencil size={14} /> Editar</button></td></tr>)}</tbody></table>{!filtered.length && <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum material encontrado</strong><span>Ajuste os filtros ou cadastre o primeiro material.</span></div>}</div>}</section>
      {filtered.length > pageSize && <nav className="pagination-controls" aria-label="Paginação"><button className="secondary-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Anterior</button><span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} de {filtered.length} · Página {page} de {pageCount}</span><button className="secondary-button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Próxima</button></nav>}
    </>}
    {showForm && <div className="modal-backdrop"><section className="modal-card material-edit-modal" role="dialog" aria-modal="true" aria-label="Cadastro de material"><div className="modal-header"><div><p className="eyebrow">{editingId ? "ATUALIZAR CADASTRO" : "NOVO CADASTRO"}</p><h2>{editingId ? "Editar material" : "Cadastrar material"}</h2></div><button type="button" className="close-modal" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveMaterial}><div className="form-grid"><label>Nome do material<input value={form.name} onChange={(event) => updateMaterialName(event.target.value)} placeholder="Ex.: Capacete Classe B" required /></label></div><div className="form-grid three"><label>Tipo<select value={form.type} onChange={(event) => updateField("type", event.target.value)}><option value="EPI">EPI</option><option value="EPC">EPC</option><option value="FERRAMENTAL">Ferramental</option></select></label><label>Unidade<select value={form.unit} onChange={(event) => updateField("unit", event.target.value)} required>{form.unit && !STANDARD_UNITS.some((unit) => unit.value === form.unit) && <option value={form.unit}>{form.unit} (cadastro atual)</option>}{STANDARD_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label><label>Tamanho / numeração<select value={form.size} onChange={(event) => updateField("size", event.target.value)}>{sizeOptions.map((size) => <option key={size || "not-applicable"} value={size}>{size || "N/A"}{size && !getMaterialSizeOptions(form.name).includes(size) ? " (cadastro atual)" : ""}</option>)}</select></label><label>Estoque mínimo<input type="number" min="0" value={form.minimum_stock} onChange={(event) => updateField("minimum_stock", event.target.value)} required /></label></div><div className="form-grid three"><label>Número do CA {form.type === "EPI" && <em>obrigatório</em>}<input value={form.ca_number} onChange={(event) => updateCaNumber(event.target.value)} disabled={form.type !== "EPI"} required={form.type === "EPI"} /></label><label>Validade do CA<input type="date" value={form.ca_expires_at} onChange={(event) => updateField("ca_expires_at", event.target.value)} disabled={form.type !== "EPI"} /></label><label>Vida útil (meses)<input type="number" min="0" value={form.useful_life_months} onChange={(event) => updateField("useful_life_months", event.target.value)} /></label><label>Troca prevista<select value={form.replacement_interval_days} onChange={(event) => updateField("replacement_interval_days", event.target.value)}><option value="">Não definida</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></label></div>
      {form.type === "EPI" && form.ca_number.trim() && <section className={"material-ca-lookup " + caLookup.status} aria-live="polite">
        <div className="material-ca-lookup-heading">
          <ShieldCheck size={17} />
          <strong>{caLookup.status === "loading" ? "Consultando CA..." : caLookup.status === "found" ? "CA localizado na base sincronizada" : caLookup.status === "not-found" ? "CA não localizado na base sincronizada" : "Consulta de CA indisponível"}</strong>
          {caLookup.status === "found" && caLookup.certificate?.status && <span className="material-ca-status">{caLookup.certificate.status}</span>}
        </div>
        {caLookup.certificate && <dl className="material-ca-lookup-grid">
          <div><dt>Equipamento</dt><dd>{caLookup.certificate.equipment_name || "Não informado"}</dd></div>
          <div><dt>Fabricante / CNPJ</dt><dd>{caLookup.certificate.manufacturer_name || "Não informado"}{caLookup.certificate.manufacturer_document ? " · " + caLookup.certificate.manufacturer_document : ""}</dd></div>
          <div><dt>Marca</dt><dd>{caLookup.certificate.brand || "Não informada"}</dd></div>
          <div><dt>Referência</dt><dd>{caLookup.certificate.reference || "Não informada"}</dd></div>
          <div><dt>Norma</dt><dd>{caLookup.certificate.standard || "Não informada"}</dd></div>
          <div><dt>Processo</dt><dd>{caLookup.certificate.process_number || "Não informado"}</dd></div>
          <div><dt>Validade oficial do CA</dt><dd>{caLookup.certificate.valid_until ? new Date(caLookup.certificate.valid_until + "T00:00:00").toLocaleDateString("pt-BR") : "Não informada"}</dd></div>
          {caLookup.certificate.equipment_description && <div className="material-ca-description"><dt>Descrição do CA</dt><dd>{caLookup.certificate.equipment_description}</dd></div>}
        </dl>}
        {caLookup.status === "not-found" && <p>Confira o número ou consulte o <a href="https://caepi.trabalho.gov.br/internet/ConsultaCAInternet.aspx" target="_blank" rel="noreferrer">portal oficial do MTE <ExternalLink size={12} /></a>.</p>}
        {caLookup.status === "error" && <p>Não foi possível consultar a base agora. Você ainda pode preencher os dados manualmente e tentar novamente mais tarde.</p>}
      </section>}
<div className="material-compliance-fields"><label className="checkbox-field"><input type="checkbox" checked={form.ca_required} onChange={(event) => updateField("ca_required", event.target.checked)} disabled={form.type !== "EPI"} /> Controle de CA obrigatório</label><label className="checkbox-field"><input type="checkbox" checked={form.test_required} onChange={(event) => updateField("test_required", event.target.checked)} /> Material ensaiável</label>{form.test_required && <><label>Tipo de ensaio<select value={form.test_type} onChange={(event) => updateField("test_type", event.target.value)}><option value="dielectric">Elétrico/dielétrico</option><option value="calibration">Calibração</option><option value="operational">Operacional</option><option value="inspection">Inspeção</option><option value="other">Outro</option></select></label><label>Periodicidade<select value={form.test_interval_months} onChange={(event) => updateField("test_interval_months", event.target.value)}><option value="6">A cada 6 meses</option><option value="12">A cada 12 meses</option></select></label><label className="checkbox-field"><input type="checkbox" checked={form.report_required} onChange={(event) => updateField("report_required", event.target.checked)} /> Exigir número do laudo</label><label className="checkbox-field"><input type="checkbox" checked={form.art_required} onChange={(event) => updateField("art_required", event.target.checked)} /> Exigir ART</label></>}</div><div className="form-grid three"><label>Marca<input value={form.brand} onChange={(event) => updateField("brand", event.target.value)} /></label><label>Fabricante<input value={form.manufacturer} onChange={(event) => updateField("manufacturer", event.target.value)} /></label><label>Modelo<input value={form.model} onChange={(event) => updateField("model", event.target.value)} /></label></div><label>Localização no estoque<input value={form.location} onChange={(event) => updateField("location", event.target.value)} placeholder="Ex.: Almoxarifado A" /></label><label>Descrição<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} rows={2} /></label><label>Observações<textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} rows={2} /></label>{editingId && <label>Status<select value={form.status} onChange={(event) => updateField("status", event.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>}{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar material"}<Check size={16} /></button></div></form></section></div>}
  </main>;
}
