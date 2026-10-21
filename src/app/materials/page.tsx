"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Check, LoaderCircle, Pencil, Plus, Search, ShieldCheck, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { CONTRACT_ANNEX_LABELS, contractAnnexLabel, getContractAnnexNumbers, type ContractAnnexAssociation } from "@/lib/contract-annex";
import type { MaterialType } from "@/types/domain";
import { FeedbackMessage } from "@/components/feedback-message";

type MaterialRow = {
  id: string; internal_code: string | null; name: string; type: MaterialType; unit: string; size: string | null;
  contract_item_code: string | null; contract_source: string | null;
  description: string | null; brand: string | null; manufacturer: string | null; model: string | null;
  useful_life_months: number | null; replacement_interval_days: number | null;
  ca_required: boolean; test_required: boolean; test_type: string | null; test_interval_months: number | null; report_required: boolean; art_required: boolean;
  minimum_stock: number; location: string | null; notes: string | null; status: "active" | "inactive";
};
type VariationType = "none" | "size" | "number" | "custom";
type MaterialVariant = { id: string; material_id: string; name: string; size: string | null; active: boolean };
type AnnexSetting = { annex_number: string; active: boolean };
type MaterialContractAnnex = ContractAnnexAssociation & { organization_id: string; material_id: string };
type MaterialForm = {
  name: string; type: MaterialType; unit: string; size: string; legacySize: string; description: string;
  variationType: VariationType; selectedVariations: string[];
  brand: string; manufacturer: string; model: string;
  ca_required: boolean; test_required: boolean; test_type: string; test_interval_months: string; report_required: boolean; art_required: boolean;
  useful_life_months: string; replacement_interval_days: string; minimum_stock: string; location: string; notes: string; status: "active" | "inactive";
};

function materialOriginLabel(material: Pick<MaterialRow, "contract_source" | "contract_item_code">, associations: MaterialContractAnnex[]) {
  if (associations.length) {
    const orderedAssociations = [...associations].sort((a, b) =>
      Number(a.annex_number) - Number(b.annex_number)
      || a.contract_item_code.localeCompare(b.contract_item_code),
    );
    const annexes = getContractAnnexNumbers(material, orderedAssociations);
    const annexLabels = annexes.map((annex) =>
      `${CONTRACT_ANNEX_LABELS[annex] ?? `Anexo ${annex}`} (Anexo ${annex})`,
    );
    const codes = [...new Set(orderedAssociations.map((association) => association.contract_item_code))];
    return `${annexLabels.join(", ")} · Códigos: ${codes.join(", ")}`;
  }

  const source = material.contract_source?.replace(/^Contrato WS 93000\s*-\s*/i, "").trim();
  const code = material.contract_item_code?.trim();
  const annexNumber = code?.match(/^A(\d{2})-/i)?.[1];
  const origin = source || (annexNumber ? `Anexo ${annexNumber}` : null);
  return origin ? `${origin}${code ? ` · ${code}` : ""}` : "Cadastro manual";
}

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
  number: "Numeração",
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
  model: "", useful_life_months: "", replacement_interval_days: "", minimum_stock: "0",
  location: "", notes: "", status: "active", ca_required: true, test_required: false, test_type: "inspection", test_interval_months: "12", report_required: false, art_required: false,
};

function formFromMaterial(material: MaterialRow, variants: MaterialVariant[]): MaterialForm {
  const activeVariants = variants.filter((variant) => variant.active);
  const variationType = variationTypeForMaterial(material, variants);
  const selectedVariations = variationType === "none" ? []
    : activeVariants.length ? activeVariants.map(variationValue)
    : variationType === "size" ? [...SIZE_VARIATION_OPTIONS]
    : variationType === "number" ? [...NUMBER_VARIATION_OPTIONS]
    : [];
  return {
    name: material.name, type: material.type, unit: material.unit, size: VARIATION_TYPE_LABELS[variationType], legacySize: material.size ?? "",
    variationType,
    selectedVariations,
    description: material.description ?? "", brand: material.brand ?? "", manufacturer: material.manufacturer ?? "",
    model: material.model ?? "",
    ca_required: material.ca_required, test_required: material.test_required, test_type: material.test_type ?? "inspection", test_interval_months: material.test_interval_months?.toString() ?? "12", report_required: material.report_required, art_required: material.art_required,
    useful_life_months: material.useful_life_months?.toString() ?? "", replacement_interval_days: material.replacement_interval_days?.toString() ?? "", minimum_stock: material.minimum_stock.toString(),
    location: material.location ?? "", notes: material.notes ?? "", status: material.status,
  };
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
  const [materialAnnexes, setMaterialAnnexes] = useState<MaterialContractAnnex[]>([]);
  const [annexSettings, setAnnexSettings] = useState<AnnexSetting[]>([]);
  const [annexSettingsLoaded, setAnnexSettingsLoaded] = useState(false);
  const [annexSettingsError, setAnnexSettingsError] = useState("");
  const [savingAnnex, setSavingAnnex] = useState<string | null>(null);
  const [form, setForm] = useState<MaterialForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [annexFilter, setAnnexFilter] = useState("all");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const loadVersion = useRef(0);
  const mountedRef = useRef(true);
  const saveLockRef = useRef(false);

  useEffect(() => {
    const initialSearch = searchParams.get("search");
    if (initialSearch) setQuery(initialSearch);
  }, [searchParams]);


  async function loadMaterials() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    setAnnexSettingsError("");
    setAnnexSettingsLoaded(false);
    setMaterials([]);
    setMaterialVariants([]);
      setMaterialAnnexes([]);
    try {
      const supabase = createClient();
      const [
        { data, error: materialsError },
        { data: variants, error: variantsError },
        { data: settings, error: settingsError },
        { data: annexes, error: annexesError },
      ] = await Promise.all([
        supabase.from("materials").select("id,internal_code,name,type,unit,size,contract_item_code,contract_source,description,brand,manufacturer,model,useful_life_months,replacement_interval_days,minimum_stock,location,notes,status,ca_required,test_required,test_type,test_interval_months,report_required,art_required").is("merged_into_material_id", null).order("name"),
        supabase.from("material_variants").select("id,material_id,name,size,active"),
        supabase.from("organization_annex_settings").select("annex_number,active"),
        supabase.from("material_contract_annexes").select("organization_id,material_id,annex_number,contract_item_code,contract_source"),
      ]);
      if (!mountedRef.current || version !== loadVersion.current) return;
      if (materialsError || variantsError || annexesError) {
        setAnnexSettingsError("Falha ao carregar o catálogo e os anexos. Tente novamente.");
        setError(friendlyError(materialsError ?? variantsError ?? annexesError, "Falha ao carregar materiais e variações."));
        return;
      }
      setMaterials((data ?? []) as MaterialRow[]);
      setMaterialVariants((variants ?? []) as MaterialVariant[]);
      setMaterialAnnexes((annexes ?? []) as MaterialContractAnnex[]);
      if (settingsError) {
        setAnnexSettings([]);
        setAnnexSettingsError(friendlyError(settingsError, "Não foi possível carregar a situação dos anexos."));
      } else {
        setAnnexSettings((settings ?? []) as AnnexSetting[]);
        setAnnexSettingsLoaded(true);
      }
    } catch (caught) {
      if (mountedRef.current && version === loadVersion.current) {
        setError(friendlyError(caught, "Falha ao carregar materiais."));
        setAnnexSettingsError(friendlyError(caught, "Não foi possível carregar a situação dos anexos."));
      }
    } finally {
      if (mountedRef.current && version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    mountedRef.current = true;
    void loadMaterials();
    return () => { mountedRef.current = false; loadVersion.current += 1; };
  }, []);

  const materialAnnexesById = useMemo(() => {
    const result = new Map<string, MaterialContractAnnex[]>();
    for (const association of materialAnnexes) {
      const existing = result.get(association.material_id) ?? [];
      existing.push(association);
      result.set(association.material_id, existing);
    }
    return result;
  }, [materialAnnexes]);

  const annexOptions = useMemo(() => [...new Set([
    ...Object.keys(CONTRACT_ANNEX_LABELS),
    ...materialAnnexes.map((association) => association.annex_number),
    ...annexSettings.map((setting) => setting.annex_number),
  ])].sort((a, b) => Number(a) - Number(b)), [materialAnnexes, annexSettings]);

  const enabledAnnexes = useMemo(() => new Set(annexOptions.filter((annex) =>
    annexSettings.find((setting) => setting.annex_number === annex)?.active ?? true
  )), [annexOptions, annexSettings]);

  const entryEligibleMaterialIds = useMemo(() => {
    if (!annexSettingsLoaded) return new Set<string>();
    return new Set(materials.filter((material) => {
      const annexes = getContractAnnexNumbers(material, materialAnnexesById.get(material.id));
      return !annexes.length || annexes.some((annex) => enabledAnnexes.has(annex));
    }).map((material) => material.id));
  }, [materials, materialAnnexesById, enabledAnnexes, annexSettingsLoaded]);

  const filtered = useMemo(() => materials
    .filter((material) => {
      const availableForEntry = material.status === "active" && entryEligibleMaterialIds.has(material.id);
      return `${material.name} ${material.internal_code}`.toLowerCase().includes(query.toLowerCase())
        && (typeFilter === "all" || (typeFilter === "EPI_EPC" ? material.type === "EPI" || material.type === "EPC" : material.type === typeFilter))
        && (statusFilter === "all" || (statusFilter === "active" ? availableForEntry : !availableForEntry))
        && (annexFilter === "all" || getContractAnnexNumbers(material, materialAnnexesById.get(material.id)).includes(annexFilter));
    })
    .sort((a, b) => ascending ? a.name.localeCompare(b.name, "pt-BR") : b.name.localeCompare(a.name, "pt-BR")), [materials, query, typeFilter, statusFilter, annexFilter, ascending, entryEligibleMaterialIds, materialAnnexesById]);

  const entryEligibleActiveMaterials = useMemo(() => materials.filter((material) =>
    material.status === "active" && entryEligibleMaterialIds.has(material.id)
  ), [materials, entryEligibleMaterialIds]);

  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedMaterials = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [query, typeFilter, statusFilter, annexFilter, ascending]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  async function updateAnnexStatus(annexNumber: string, active: boolean) {
    if (savingAnnex || !annexSettingsLoaded) return;
    setSavingAnnex(annexNumber);
    setAnnexSettingsError("");
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error("Sessão expirada. Entre novamente.");
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();
      if (profileError || !profile?.organization_id) throw profileError ?? new Error("Usuário sem organização vinculada.");

      const { error: saveError } = await supabase
        .from("organization_annex_settings")
        .upsert({ organization_id: profile.organization_id, annex_number: annexNumber, active, updated_at: new Date().toISOString() }, { onConflict: "organization_id,annex_number" });
      if (saveError) throw saveError;

      setAnnexSettings((current) => [
        ...current.filter((setting) => setting.annex_number !== annexNumber),
        { annex_number: annexNumber, active },
      ]);
      setSuccess(`${contractAnnexLabel(annexNumber)} ${active ? "ativado" : "desativado"}.`);
    } catch (caught) {
      setAnnexSettingsError(friendlyError(caught, "Não foi possível atualizar este anexo."));
    } finally {
      setSavingAnnex(null);
    }
  }

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
  function openNew() {
    setForm(emptyForm); setEditingId(null); setError(""); setSuccess(""); setShowForm(true);
  }
  function openEdit(material: MaterialRow) {
    setForm(formFromMaterial(material, materialVariants.filter((variant) => variant.material_id === material.id))); setEditingId(material.id); setError(""); setSuccess(""); setShowForm(true);
  }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault();
    if (saving || saveLockRef.current) return;
    setError(""); setSuccess("");
    if (!form.name.trim()) { setError("Informe o nome do material."); return; }
    if (!form.unit.trim()) { setError("Informe a unidade do material."); return; }
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
      model: form.model.trim() || null,
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
    <section className="panel annex-settings-panel" aria-labelledby="annex-settings-title">
      <div className="panel-header"><div><h2 id="annex-settings-title">Anexos contratuais</h2><p>Desative um anexo para impedir que seus materiais sejam selecionados em Entrada de materiais.</p></div><span className="annex-settings-count">{annexOptions.length} anexos</span></div>
      {annexSettingsError && <FeedbackMessage onRetry={() => void loadMaterials()}>{annexSettingsError}</FeedbackMessage>}
      {!annexSettingsLoaded && !annexSettingsError ? <p className="annex-settings-loading">Carregando situação dos anexos...</p> : null}
      {annexSettingsLoaded && <div className="annex-settings-grid">{annexOptions.map((annex) => {
        const active = annexSettings.find((setting) => setting.annex_number === annex)?.active ?? true;
        const count = materials.filter((material) => getContractAnnexNumbers(material, materialAnnexesById.get(material.id)).includes(annex)).length;
        const saving = savingAnnex === annex;
        return <label className={`annex-setting-card ${active ? "is-active" : "is-inactive"}`} key={annex}>
          <input type="checkbox" checked={active} disabled={Boolean(savingAnnex)} onChange={(event) => void updateAnnexStatus(annex, event.target.checked)} aria-label={`${active ? "Desativar" : "Ativar"} ${contractAnnexLabel(annex)}`} />
          <span className="annex-setting-copy"><strong>{contractAnnexLabel(annex)}</strong><small>{count} material(is) no catálogo</small></span>
          <span className={`status-pill ${active ? "success" : "danger"}`}>{saving ? "Salvando..." : active ? "Ativo" : "Desativado"}</span>
        </label>;
      })}</div>}
    </section>
    <section className="module-toolbar"><div className="module-search"><Search size={17} /><input aria-label="Buscar material por nome" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar material por nome" /></div><select aria-label="Filtrar por grupo de materiais" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Todos os tipos</option><option value="EPI_EPC">EPIs e EPCs</option><option value="FERRAMENTAL">Ferramentais</option></select><select aria-label="Filtrar disponibilidade para entrada" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos os materiais</option><option value="active">Ativos para entrada</option><option value="inactive">Inativos ou anexo desativado</option></select><select aria-label="Filtrar materiais por anexo" value={annexFilter} onChange={(event) => setAnnexFilter(event.target.value)}><option value="all">Todos os anexos</option>{annexOptions.map((annex) => <option key={annex} value={annex}>{CONTRACT_ANNEX_LABELS[annex] ? `${CONTRACT_ANNEX_LABELS[annex]} · Anexo ${annex}` : `Anexo ${annex}`}</option>)}</select></section>
    <section className="module-summary"><div><strong>{annexSettingsLoaded ? entryEligibleActiveMaterials.length : "—"}</strong><span>materiais ativos para entrada</span></div><div><strong>{annexSettingsLoaded ? entryEligibleActiveMaterials.filter((item) => item.type === "EPI").length : "—"}</strong><span>EPIs ativos para entrada</span></div><div><strong>{annexSettingsLoaded ? entryEligibleActiveMaterials.filter((item) => item.type === "EPC").length : "—"}</strong><span>EPCs ativos para entrada</span></div><div><strong>{annexSettingsLoaded ? entryEligibleActiveMaterials.filter((item) => item.type === "FERRAMENTAL").length : "—"}</strong><span>ferramentais ativos para entrada</span></div></section>
    {!showForm && <>
      <section className="panel module-table-card"><div className="panel-header"><div><h2>Catálogo de materiais</h2><p>{filtered.length} resultado(s) encontrados</p></div><button className="select-button" onClick={() => setAscending((current) => !current)}>{ascending ? "Nome: A–Z" : "Nome: Z–A"} {ascending ? <ArrowUpAZ size={15} /> : <ArrowDownAZ size={15} />}</button></div>{loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando materiais...</div> : <div className="table-wrap"><table className="materials-catalog-table" aria-label="Catálogo de materiais"><thead><tr><th>MATERIAL</th><th>TIPO</th><th>AÇÕES</th></tr></thead><tbody>{paginatedMaterials.map((material) => {
        return <tr key={material.id}>
          <td><div className="material-cell material-catalog-cell"><div><strong>{material.name}</strong><small>{material.unit}</small><small>Origem: {materialOriginLabel(material, materialAnnexesById.get(material.id) ?? [])}</small></div></div></td>
          <td><span className={`type-badge ${material.type.toLowerCase()}`}>{material.type}</span></td>
          <td><button className="action-button" onClick={() => openEdit(material)}><Pencil size={14} /> Editar</button></td>
        </tr>;
      })}</tbody></table>{!filtered.length && <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum material encontrado</strong><span>Ajuste os filtros ou cadastre o primeiro material.</span></div>}</div>}</section>
      {filtered.length > pageSize && <nav className="pagination-controls" aria-label="Paginação"><button className="secondary-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Anterior</button><span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} de {filtered.length} · Página {page} de {pageCount}</span><button className="secondary-button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>Próxima</button></nav>}
    </>}
    {showForm && <div className="modal-backdrop"><section className="modal-card material-edit-modal" role="dialog" aria-modal="true" aria-label="Cadastro de material"><div className="modal-header"><div><p className="eyebrow">{editingId ? "ATUALIZAR CADASTRO" : "NOVO CADASTRO"}</p><h2>{editingId ? "Editar material" : "Cadastrar material"}</h2></div><button type="button" className="close-modal" onClick={() => setShowForm(false)} aria-label="Fechar"><X size={19} /></button></div><form className="material-form" onSubmit={saveMaterial}><div className="form-grid"><label>Nome do material<input value={form.name} onChange={(event) => updateMaterialName(event.target.value)} placeholder="Ex.: Capacete Classe B" required /></label></div><div className="form-grid three"><label>Tipo<select value={form.type} onChange={(event) => updateField("type", event.target.value)}><option value="EPI">EPI</option><option value="EPC">EPC</option><option value="FERRAMENTAL">Ferramental</option></select></label><label>Unidade<select value={form.unit} onChange={(event) => updateField("unit", event.target.value)} required>{form.unit && !STANDARD_UNITS.some((unit) => unit.value === form.unit) && <option value={form.unit}>{form.unit} (cadastro atual)</option>}{STANDARD_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label><label>Tamanho / numeração<select value={form.size} onChange={(event) => updateField("size", event.target.value)}>{sizeOptions.map((size) => <option key={size || "not-applicable"} value={size}>{size || "N/A"}{size && !getMaterialSizeOptions(form.name).includes(size) ? " (cadastro atual)" : ""}</option>)}</select></label><label>Estoque mínimo<input type="number" min="0" value={form.minimum_stock} onChange={(event) => updateField("minimum_stock", event.target.value)} required /></label></div><div className="form-grid two"><label>Vida útil (meses)<input type="number" min="0" value={form.useful_life_months} onChange={(event) => updateField("useful_life_months", event.target.value)} /></label><label>Troca prevista<select value={form.replacement_interval_days} onChange={(event) => updateField("replacement_interval_days", event.target.value)}><option value="">Não definida</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></label></div>
<div className="material-compliance-fields"><label className="checkbox-field"><input type="checkbox" checked={form.ca_required} onChange={(event) => updateField("ca_required", event.target.checked)} disabled={form.type !== "EPI"} /> Controle de CA obrigatório</label><label className="checkbox-field"><input type="checkbox" checked={form.test_required} onChange={(event) => updateField("test_required", event.target.checked)} /> Material ensaiável</label>{form.test_required && <><label>Tipo de ensaio<select value={form.test_type} onChange={(event) => updateField("test_type", event.target.value)}><option value="dielectric">Elétrico/dielétrico</option><option value="calibration">Calibração</option><option value="operational">Operacional</option><option value="inspection">Inspeção</option><option value="other">Outro</option></select></label><label>Periodicidade<select value={form.test_interval_months} onChange={(event) => updateField("test_interval_months", event.target.value)}><option value="6">A cada 6 meses</option><option value="12">A cada 12 meses</option></select></label><label className="checkbox-field"><input type="checkbox" checked={form.report_required} onChange={(event) => updateField("report_required", event.target.checked)} /> Exigir número do laudo</label><label className="checkbox-field"><input type="checkbox" checked={form.art_required} onChange={(event) => updateField("art_required", event.target.checked)} /> Exigir ART</label></>}</div><p className="muted-cell">Número e validade do CA são registrados por lote na Entrada de materiais.</p><div className="form-grid three"><label>Marca<input value={form.brand} onChange={(event) => updateField("brand", event.target.value)} /></label><label>Fabricante<input value={form.manufacturer} onChange={(event) => updateField("manufacturer", event.target.value)} /></label><label>Modelo<input value={form.model} onChange={(event) => updateField("model", event.target.value)} /></label></div><label>Localização no estoque<input value={form.location} onChange={(event) => updateField("location", event.target.value)} placeholder="Ex.: Almoxarifado A" /></label><label>Descrição<textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} rows={2} /></label><label>Observações<textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} rows={2} /></label>{editingId && <label>Status<select value={form.status} onChange={(event) => updateField("status", event.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>}{error && <p className="login-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar material"}<Check size={16} /></button></div></form></section></div>}
  </main>;
}
