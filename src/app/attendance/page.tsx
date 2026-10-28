"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, LoaderCircle, Plus, Save, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Employee = {
  id: string;
  registration: string | null;
  full_name: string;
  job_title: string | null;
  function_name: string | null;
  function_classification: string | null;
  department: string | null;
  unit: string | null;
  admission_date: string | null;
  termination_date: string | null;
  status: "active" | "away" | "terminated";
};

type FunctionRule = {
  id: string;
  scope_name: string;
  function_name: string;
  source_note: string | null;
  receives_attendance: boolean;
  monthly_amount: number | string;
  active: boolean;
};

type OccurrenceType = "late" | "absence_justified" | "absence_unjustified" | "convocation_absence" | "medical_certificate" | "warning";
type Occurrence = { id: string; occurrence_type: OccurrenceType; occurred_on: string; occurred_at: string | null; days_count: number };
type OccurrenceDraft = { id: string; occurrence_type: OccurrenceType; occurred_on: string; occurred_at: string; days_count: string };
type ReductionRule = { id: string; function_rule_id: string; criterion_key: string; reduction_amount: number | string; active: boolean };
type CollectiveField = "quality_status" | "service_cancellation_status" | "safety_status";
type Collective = Record<CollectiveField, "not_evaluated" | "meets" | "does_not_meet">;
type SavedSnapshot = { scope_name_snapshot: string; receives_attendance_snapshot: boolean; monthly_amount_snapshot: number | string; reduction_amount_snapshot: number | string; estimated_amount_snapshot: number | string };

const occurrenceOptions: Array<[OccurrenceType, string]> = [
  ["late", "Atraso na jornada"],
  ["absence_justified", "Falta justificada"],
  ["absence_unjustified", "Falta injustificada"],
  ["convocation_absence", "Falta de convocação"],
  ["medical_certificate", "Atestado médico"],
  ["warning", "Advertência"],
];
const eventLabels = Object.fromEntries(occurrenceOptions) as Record<OccurrenceType, string>;
const statusLabels = { active: "Ativo", away: "Afastado", terminated: "Desligado" } as const;
const emptyCollective: Collective = { quality_status: "not_evaluated", service_cancellation_status: "not_evaluated", safety_status: "not_evaluated" };
const collectiveOptions = [["not_evaluated", "Não avaliado"], ["meets", "Atende"], ["does_not_meet", "Não atende"]] as const;
const reductionLabels: Record<string, string> = {
  late: "Atraso de jornada",
  absence_justified: "Falta justificada (por dia)",
  absence_unjustified: "Falta injustificada (por dia)",
  convocation_absence: "Falta de convocação (por dia)",
  medical_certificate: "Atestado médico (por dia)",
  warning: "Advertência (por registro)",
  quality: "Qualidade — não atende",
  service_cancellation: "Cancelamento de serviço — não atende",
  safety: "Segurança — não atende",
};

function isoDate(year: number, monthIndex: number, day: number) {
  const date = new Date(year, monthIndex, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function daysInPeriod(start: string, end: string) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}
function defaultAttendancePeriod(today = new Date()) {
  const day = today.getDate();
  const start = day >= 26
    ? isoDate(today.getFullYear(), today.getMonth(), 26)
    : isoDate(today.getFullYear(), today.getMonth() - 1, 26);
  const end = day >= 26
    ? isoDate(today.getFullYear(), today.getMonth() + 1, 25)
    : isoDate(today.getFullYear(), today.getMonth(), 25);
  return { start, end };
}
function displayDate(value: string | null) {
  return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Não informada";
}
function displayMoney(value: number | string | null | undefined) {
  return `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function toInputMoney(value: number | string) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseInputMoney(value: string) {
  const normalized = value.trim().includes(",") ? value.trim().replace(/\./g, "").replace(",", ".") : value.trim();
  return Number(normalized);
}
function ruleKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function functionMatchRank(ruleName: string, employeeFunction: string) {
  const rule = ruleKey(ruleName);
  const employee = ruleKey(employeeFunction);
  if (rule === employee) return 0;
  if (rule === "eletricista" && employee.startsWith("eletricista ") && !employee.startsWith("eletricista podador")) return 1;
  if (rule === "eletricista podador" && employee.startsWith("eletricista podador")) return 1;
  if (rule === "ajudante" && employee.startsWith("ajudante")) return 1;
  if (rule === "motorista" && employee.startsWith("motorista")) return 1;
  if (["encarregado", "encarregada"].includes(rule) && employee.startsWith("encarregad")) return 1;
  return null;
}
function findFunctionRule(rules: FunctionRule[], functionName: string, scopeName: string) {
  return rules
    .map((rule) => ({ rule, match: functionMatchRank(rule.function_name, functionName), scope: ruleKey(rule.scope_name) === ruleKey(scopeName) ? 0 : ruleKey(rule.scope_name) === "geral" ? 1 : 2 }))
    .filter((candidate) => candidate.match !== null && candidate.scope < 2)
    .sort((a, b) => a.scope - b.scope || a.match! - b.match! || ruleKey(b.rule.function_name).length - ruleKey(a.rule.function_name).length || ruleKey(a.rule.function_name).localeCompare(ruleKey(b.rule.function_name)))[0]?.rule ?? null;
}
function suggestedScopeForEmployee(employee: Employee, scopes: string[]) {
  const unitKey = ruleKey(employee.unit ?? "");
  if (!unitKey) return "Geral";
  const unitTokens = unitKey.split(" ");
  const matches = scopes.filter((scope) => {
    const scopeKey = ruleKey(scope);
    const scopeTokens = scopeKey.split(" ");
    return scopeKey !== "geral" && (scopeKey.includes(unitKey) || unitKey.includes(scopeKey) || unitTokens.some((token) => token.length >= 3 && scopeTokens.includes(token)));
  });
  return matches.length === 1 ? matches[0] : "Geral";
}
function employeeFunction(employee: Employee) {
  const name = (employee.function_name || employee.job_title || "Função não informada").trim();
  const classification = employee.function_classification?.trim();
  if (!classification || name.toLocaleUpperCase("pt-BR").endsWith(` ${classification}`.toLocaleUpperCase("pt-BR"))) return name;
  return `${name} ${classification}`;
}
function newOccurrence(periodStart: string): OccurrenceDraft {
  return { id: crypto.randomUUID(), occurrence_type: "late", occurred_on: periodStart, occurred_at: "", days_count: "1" };
}
function isMultiDay(type: OccurrenceType) {
  return ["absence_justified", "absence_unjustified", "convocation_absence", "medical_certificate"].includes(type);
}

export default function AttendancePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rules, setRules] = useState<FunctionRule[]>([]);
  const [reductionRules, setReductionRules] = useState<ReductionRule[]>([]);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [reductionDrafts, setReductionDrafts] = useState<Record<string, string>>({});
  const [reductionDirtyIds, setReductionDirtyIds] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [scopeName, setScopeName] = useState("Geral");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [occurrences, setOccurrences] = useState<OccurrenceDraft[]>([]);
  const [collective, setCollective] = useState<Collective>(emptyCollective);
  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot | null>(null);
  const [savedRecord, setSavedRecord] = useState(false);
  const [tab, setTab] = useState<"records" | "functions">("records");
  const [newFunctionName, setNewFunctionName] = useState("");
  const [newScopeName, setNewScopeName] = useState("Geral");
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [savingCollective, setSavingCollective] = useState(false);
  const [savingReductions, setSavingReductions] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState("");
  const [addingFunction, setAddingFunction] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedFunctionName = selectedEmployee ? employeeFunction(selectedEmployee) : "";
  const selectedRule = selectedEmployee ? findFunctionRule(rules, selectedFunctionName, scopeName) : null;
  const scopeOptions = useMemo(() => ["Geral", ...Array.from(new Map(rules.filter((rule) => ruleKey(rule.scope_name) !== "geral").map((rule) => [ruleKey(rule.scope_name), rule.scope_name])).values()).sort((a, b) => a.localeCompare(b, "pt-BR"))], [rules]);
  const validPeriod = Boolean(periodStart && periodEnd && periodEnd >= periodStart && daysInPeriod(periodStart, periodEnd) <= 31);
  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.toLocaleLowerCase("pt-BR").trim();
    if (!query) return employees;
    return employees.filter((employee) => `${employee.full_name} ${employee.registration ?? ""}`.toLocaleLowerCase("pt-BR").includes(query));
  }, [employeeSearch, employees]);

  const metrics = useMemo(() => {
    const count = (type: OccurrenceType) => occurrences.filter((item) => item.occurrence_type === type).length;
    const days = (type: OccurrenceType) => occurrences.filter((item) => item.occurrence_type === type).reduce((total, item) => total + Number(item.days_count || 0), 0);
    return {
      late: count("late"),
      justified: count("absence_justified"),
      unjustified: count("absence_unjustified"),
      callout: count("convocation_absence"),
      certificates: count("medical_certificate"),
      certificateDays: days("medical_certificate"),
      warnings: count("warning"),
    };
  }, [occurrences]);

  const attendanceEligible = savedRecord && savedSnapshot
    ? savedSnapshot.receives_attendance_snapshot
    : Boolean(selectedRule?.active && selectedRule.receives_attendance);
  const attendanceBaseAmount = attendanceEligible
    ? savedRecord && savedSnapshot ? Number(savedSnapshot.monthly_amount_snapshot) : Number(selectedRule?.monthly_amount ?? 0)
    : 0;
  const amountFor = (criterion: string) => selectedRule?.active && selectedRule.receives_attendance
    ? Number(reductionRules.find((rule) => rule.function_rule_id === selectedRule.id && rule.criterion_key === criterion && rule.active)?.reduction_amount ?? 0)
    : 0;
  const individualReduction = occurrences.reduce((total, item) => {
    const units = isMultiDay(item.occurrence_type) ? Number(item.days_count || 0) : 1;
    return total + amountFor(item.occurrence_type) * units;
  }, 0);
  const collectiveKeys: Array<[CollectiveField, string]> = [["quality_status", "quality"], ["service_cancellation_status", "service_cancellation"], ["safety_status", "safety"]];
  const collectiveReduction = collectiveKeys.reduce((total, [field, criterion]) => total + (collective[field] === "does_not_meet" ? amountFor(criterion) : 0), 0);
  const reductionBreakdown = {
    individual: Math.round(individualReduction * 100) / 100,
    collective: Math.round(collectiveReduction * 100) / 100,
    total: Math.min(attendanceBaseAmount, Math.round((individualReduction + collectiveReduction) * 100) / 100),
  };
  const reductionAmount = savedRecord && savedSnapshot ? Number(savedSnapshot.reduction_amount_snapshot) : reductionBreakdown.total;
  const estimatedAttendanceAmount = savedRecord && savedSnapshot
    ? Number(savedSnapshot.estimated_amount_snapshot)
    : Math.max(0, Math.round((attendanceBaseAmount - reductionAmount) * 100) / 100);

  useEffect(() => {
    const initial = defaultAttendancePeriod();
    setPeriodStart(initial.start);
    setPeriodEnd(initial.end);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadBase() {
      setLoading(true);
      setError("");
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!auth.user || authError) {
        if (active) { setError("Sua sessão expirou. Entre novamente para abrir o controle de assiduidade."); setLoading(false); }
        return;
      }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
      if (profileError || !profile?.organization_id) {
        if (active) { setError("Não foi possível identificar a organização do usuário."); setLoading(false); }
        return;
      }
      const [employeeResult, ruleResult, reductionResult] = await Promise.all([
        supabase.from("employees").select("id,registration,full_name,job_title,function_name,function_classification,department,unit,admission_date,termination_date,status").order("full_name"),
        supabase.from("attendance_function_rules").select("id,scope_name,function_name,source_note,receives_attendance,monthly_amount,active").order("scope_name").order("function_name"),
        supabase.from("attendance_reduction_rules").select("id,function_rule_id,criterion_key,reduction_amount,active").order("criterion_key"),
      ]);
      if (!active) return;
      if (employeeResult.error || ruleResult.error || reductionResult.error) {
        setError("Não foi possível carregar funcionários e regras. Confirme se a atualização do banco foi aplicada e se seu perfil tem acesso ao RH.");
      } else {
        setOrganizationId(profile.organization_id);
        setEmployees((employeeResult.data ?? []) as Employee[]);
        const loadedRules = (ruleResult.data ?? []) as FunctionRule[];
        setRules(loadedRules);
        setAmountDrafts(Object.fromEntries(loadedRules.map((rule) => [rule.id, toInputMoney(rule.monthly_amount)])));
        const loadedReductions = (reductionResult.data ?? []) as ReductionRule[];
        setReductionRules(loadedReductions);
        setReductionDrafts(Object.fromEntries(loadedReductions.map((rule) => [rule.id, String(rule.reduction_amount)])));
        setReductionDirtyIds([]);
      }
      setLoading(false);
    }
    void loadBase();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadPeriod() {
      if (!organizationId) return;
      if (!validPeriod) {
        setError("Informe datas válidas para um período de 1 a 31 dias.");
        setOccurrences([]);
        setSavedSnapshot(null);
        setSavedRecord(false);
        setCollective(emptyCollective);
        setPeriodLoading(false);
        return;
      }
      setPeriodLoading(true);
      setError("");
      setSuccess("");
      setOccurrences([]);
      setSavedSnapshot(null);
      setSavedRecord(false);
      const supabase = createClient();
      const recordPromise = selectedEmployeeId
        ? supabase.from("attendance_period_records").select("id,scope_name_snapshot,receives_attendance_snapshot,monthly_amount_snapshot,reduction_amount_snapshot,estimated_amount_snapshot").eq("employee_id", selectedEmployeeId).eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const collectivePromise = supabase.from("attendance_collective_assessments").select("quality_status,service_cancellation_status,safety_status").eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle();
      const [recordResult, collectiveResult] = await Promise.all([recordPromise, collectivePromise]);
      if (!active) return;
      if (recordResult.error || collectiveResult.error) {
        setError("Não foi possível carregar os registros deste período.");
        setPeriodLoading(false);
        return;
      }
      const saved = recordResult.data as SavedSnapshot & { id: string } | null;
      if (saved && selectedEmployeeId) {
        const { data, error: eventError } = await supabase.from("attendance_occurrences").select("id,occurrence_type,occurred_on,occurred_at,days_count").eq("attendance_record_id", saved.id).order("occurred_on").order("created_at");
        if (!active) return;
        if (eventError) {
          setError("Não foi possível carregar as ocorrências deste colaborador.");
          setPeriodLoading(false);
          return;
        }
        setOccurrences(((data ?? []) as Occurrence[]).map((item) => ({
          id: item.id,
          occurrence_type: item.occurrence_type,
          occurred_on: item.occurred_on,
          occurred_at: item.occurred_at?.slice(0, 5) ?? "",
          days_count: String(item.days_count),
        })));
        setSavedSnapshot(saved);
        setSavedRecord(true);
        setScopeName(saved.scope_name_snapshot || "Geral");
      }
      setCollective(collectiveResult.data ? collectiveResult.data as Collective : emptyCollective);
      setPeriodLoading(false);
    }
    void loadPeriod();
    return () => { active = false; };
  }, [organizationId, periodStart, periodEnd, selectedEmployeeId, validPeriod]);

  function updateOccurrence(id: string, field: keyof Omit<OccurrenceDraft, "id">, value: string) {
    setSavedRecord(false);
    setOccurrences((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (field === "occurrence_type") {
        const nextType = value as OccurrenceType;
        return { ...item, occurrence_type: nextType, occurred_at: nextType === "late" ? item.occurred_at : "", days_count: isMultiDay(nextType) ? (isMultiDay(item.occurrence_type) ? item.days_count : "1") : "1" };
      }
      return { ...item, [field]: value };
    }));
  }

  async function saveRecord() {
    if (!selectedEmployee || savingRecord || !validPeriod) return;
    setError("");
    setSuccess("");
    const invalid = occurrences.some((item) =>
      !item.occurred_on || item.occurred_on < periodStart || item.occurred_on > periodEnd ||
      (item.occurrence_type === "late" && !item.occurred_at) ||
      (isMultiDay(item.occurrence_type) && (!Number.isInteger(Number(item.days_count)) || Number(item.days_count) < 1 || Number(item.days_count) > 31))
    );
    if (invalid) { setError("Confira as datas, horários dos atrasos e quantidades de dias das ocorrências."); return; }
    setSavingRecord(true);
    const supabase = createClient();
    const { data, error: saveError } = await supabase.rpc("save_attendance_period_record_scoped", {
      p_employee_id: selectedEmployee.id,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_scope_name: scopeName,
      p_events: occurrences.map((item) => ({
        type: item.occurrence_type,
        date: item.occurred_on,
        time: item.occurrence_type === "late" ? item.occurred_at : null,
        days: isMultiDay(item.occurrence_type) ? Number(item.days_count) : 1,
      })),
    });
    if (saveError || !data) {
      setError(saveError?.message?.includes("RH") ? "Seu perfil não tem acesso para registrar assiduidade." : "Não foi possível salvar o registro. Confira o período e as ocorrências.");
    } else {
      setSavedRecord(true);
      setSavedSnapshot({ scope_name_snapshot: scopeName, receives_attendance_snapshot: Boolean(selectedRule?.active && selectedRule.receives_attendance), monthly_amount_snapshot: selectedRule?.active && selectedRule.receives_attendance ? selectedRule.monthly_amount : 0, reduction_amount_snapshot: reductionAmount, estimated_amount_snapshot: estimatedAttendanceAmount });
      setSuccess("Registro individual salvo para este período.");
    }
    setSavingRecord(false);
  }

  async function saveCollective() {
    if (!organizationId || savingCollective || !validPeriod) return;
    setSavingCollective(true);
    setError("");
    setSuccess("");
    const { data, error: saveError } = await createClient().from("attendance_collective_assessments").upsert({
      organization_id: organizationId,
      period_start: periodStart,
      period_end: periodEnd,
      ...collective,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,period_start,period_end" }).select("id").maybeSingle();
    if (saveError || !data) setError("Não foi possível salvar os requisitos coletivos deste período.");
    else setSuccess("Requisitos coletivos salvos para a organização neste período.");
    setSavingCollective(false);
  }

  async function addFunctionRule() {
    const name = newFunctionName.trim().replace(/\s+/g, " ");
    const scope = newScopeName.trim().replace(/\s+/g, " ");
    if (!name || !scope || addingFunction) return;
    if (rules.some((rule) => ruleKey(rule.function_name) === ruleKey(name) && ruleKey(rule.scope_name) === ruleKey(scope))) {
      setError("Essa função já está cadastrada para esse centro/unidade.");
      return;
    }
    setAddingFunction(true);
    setError("");
    const supabase = createClient();
    const { data, error: insertError } = await supabase.from("attendance_function_rules").insert({ organization_id: organizationId, scope_name: scope, function_name: name, receives_attendance: false, monthly_amount: 0, active: false }).select("id,scope_name,function_name,source_note,receives_attendance,monthly_amount,active").single();
    if (insertError || !data) setError("Não foi possível adicionar a regra. Confira se a combinação de centro/unidade e função já existe.");
    else {
      const added = data as FunctionRule;
      const { data: seededRules, error: seededRulesError } = await supabase.from("attendance_reduction_rules").select("id,function_rule_id,criterion_key,reduction_amount,active").eq("function_rule_id", added.id);
      setRules((current) => [...current, added].sort((a, b) => a.scope_name.localeCompare(b.scope_name, "pt-BR") || a.function_name.localeCompare(b.function_name, "pt-BR")));
      setAmountDrafts((current) => ({ ...current, [added.id]: toInputMoney(added.monthly_amount) }));
      if (seededRulesError) setError("Função adicionada, mas não foi possível carregar suas regras zeradas. Atualize a página para conferir.");
      else {
        const addedRules = (seededRules ?? []) as ReductionRule[];
        setReductionRules((current) => [...current, ...addedRules]);
        setReductionDrafts((current) => ({ ...current, ...Object.fromEntries(addedRules.map((rule) => [rule.id, String(rule.reduction_amount)])) }));
      }
      setNewFunctionName("");
      setNewScopeName("Geral");
      if (!seededRulesError) setSuccess("Regra adicionada inativa, sem assiduidade habilitada e com todas as reduções zeradas e desativadas.");
    }
    setAddingFunction(false);
  }

  async function saveFunctionRule(rule: FunctionRule) {
    if (savingRuleId) return;
    const amount = parseInputMoney(amountDrafts[rule.id] ?? toInputMoney(rule.monthly_amount));
    if (!Number.isFinite(amount) || amount < 0) { setError("Informe um valor mensal válido para a função."); return; }
    const scope = rule.scope_name.trim().replace(/\s+/g, " ");
    if (!scope || scope.length > 150) { setError("Informe um centro/unidade com até 150 caracteres."); return; }
    if (rules.some((item) => item.id !== rule.id && ruleKey(item.scope_name) === ruleKey(scope) && ruleKey(item.function_name) === ruleKey(rule.function_name))) {
      setError("Já existe essa função configurada para o centro/unidade informado.");
      return;
    }
    setSavingRuleId(rule.id);
    setError("");
    const { data, error: updateError } = await createClient().from("attendance_function_rules").update({
      scope_name: scope,
      receives_attendance: rule.receives_attendance,
      monthly_amount: amount,
      active: rule.active,
      updated_at: new Date().toISOString(),
    }).eq("id", rule.id).select("id").maybeSingle();
    if (updateError || !data) setError("Não foi possível salvar a regra da função.");
    else {
      setRules((current) => current.map((item) => item.id === rule.id ? { ...item, scope_name: scope, monthly_amount: amount } : item).sort((a, b) => a.scope_name.localeCompare(b.scope_name, "pt-BR") || a.function_name.localeCompare(b.function_name, "pt-BR")));
      setAmountDrafts((current) => ({ ...current, [rule.id]: toInputMoney(amount) }));
      setSuccess(`Regra de ${rule.function_name} salva.`);
    }
    setSavingRuleId("");
  }

  async function saveReductionRules() {
    if (!organizationId || savingReductions || reductionRules.length === 0) return;
    const values = reductionRules.map((rule) => {
      const parsed = parseInputMoney(reductionDrafts[rule.id] ?? String(rule.reduction_amount));
      return { ...rule, parsed };
    });
    if (values.some((rule) => !Number.isFinite(rule.parsed) || rule.parsed < 0 || rule.parsed > 9_999_999_999.99)) {
      setError("Informe valores válidos em reais, a partir de R$ 0,00.");
      return;
    }
    const dirtyIds = new Set(reductionDirtyIds);
    const changedValues = values.filter((rule) => dirtyIds.has(rule.id));
    if (changedValues.length === 0) {
      setSuccess("Não há alterações de redução para salvar.");
      return;
    }
    setSavingReductions(true);
    setError("");
    const payload = changedValues.map((rule) => ({
      organization_id: organizationId,
      function_rule_id: rule.function_rule_id,
      criterion_key: rule.criterion_key,
      reduction_amount: rule.parsed,
      active: rule.active,
      updated_at: new Date().toISOString(),
    }));
    const supabase = createClient();
    const { data, error: saveError } = await supabase.from("attendance_reduction_rules").upsert(payload, { onConflict: "organization_id,function_rule_id,criterion_key" }).select("id,function_rule_id,criterion_key,reduction_amount,active");
    if (saveError || !data || data.length !== payload.length) setError("Não foi possível salvar as regras de redução.");
    else {
      const saved = data as ReductionRule[];
      const savedById = new Map(saved.map((rule) => [rule.id, rule]));
      setReductionRules((current) => current.map((rule) => savedById.get(rule.id) ?? rule));
      setReductionDrafts((current) => ({ ...current, ...Object.fromEntries(saved.map((rule) => [rule.id, String(rule.reduction_amount)])) }));
      setReductionDirtyIds((current) => current.filter((id) => !savedById.has(id)));
      if (selectedEmployeeId) {
        const { data: refreshedSnapshot } = await supabase.from("attendance_period_records").select("scope_name_snapshot,receives_attendance_snapshot,monthly_amount_snapshot,reduction_amount_snapshot,estimated_amount_snapshot").eq("employee_id", selectedEmployeeId).eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle();
        if (refreshedSnapshot) {
          setSavedSnapshot(refreshedSnapshot as SavedSnapshot);
          setSavedRecord(true);
        } else {
          setSavedSnapshot(null);
          setSavedRecord(false);
        }
      }
      setSuccess("Regras de redução salvas. O cálculo é uma estimativa para conferência do RH.");
    }
    setSavingReductions(false);
  }

  function updateRule(id: string, field: "receives_attendance" | "active", value: boolean) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));
  }
  function updateReductionRule(id: string, field: "active", value: boolean) {
    setReductionRules((current) => current.map((rule) => rule.id === id ? { ...rule, [field]: value } : rule));
    setReductionDirtyIds((current) => current.includes(id) ? current : [...current, id]);
  }
  function updateReductionDraft(id: string, value: string) {
    setReductionDrafts((current) => ({ ...current, [id]: value }));
    setReductionDirtyIds((current) => current.includes(id) ? current : [...current, id]);
  }

  return <main className="page-content attendance-page">
    <header className="attendance-header">
      <div><p className="eyebrow">RECURSOS HUMANOS</p><h1>Controle de assiduidade</h1><p className="subtitle">Registre ocorrências individuais e acompanhe os critérios coletivos por período.</p></div>
      <div className="attendance-period" aria-label="Período de assiduidade">
        <div className="attendance-period-heading"><CalendarDays size={17} aria-hidden="true" /><span>Período</span></div>
        <div className="attendance-period-range">
          <label><span>De</span><input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
          <label><span>Até</span><input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
        </div>
        <small>Padrão mensal: dia 26 ao dia 25 do mês seguinte.</small>
      </div>
    </header>

    <div className="attendance-tabs" role="tablist" aria-label="Seções de assiduidade">
      <button type="button" role="tab" aria-selected={tab === "records"} className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}><UserRound size={16} /> Registros individuais</button>
      <button type="button" role="tab" aria-selected={tab === "functions"} className={tab === "functions" ? "active" : ""} onClick={() => setTab("functions")}><ShieldCheck size={16} /> Funções e valores</button>
    </div>

    {error && <div className="feedback error-feedback" role="alert"><X size={16} />{error}</div>}
    {success && <div className="feedback success-feedback" role="status"><Check size={16} />{success}</div>}

    {loading ? <div className="attendance-loading"><LoaderCircle className="spin" size={22} /> Carregando dados do RH...</div> : error && !organizationId ? <div className="panel attendance-empty">{error}</div> : tab === "records" ? <>
      <section className="panel attendance-employee-picker">
        <div className="attendance-section-heading"><div><h2>Colaborador</h2><p>Selecione a pessoa para consultar os dados e registrar o período.</p></div></div>
        <div className="attendance-picker-fields">
          <label><span>Buscar por nome ou matrícula</span><div className="attendance-search"><Search size={16} aria-hidden="true" /><input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Digite o nome ou a matrícula" /></div></label>
          <label><span>Funcionário</span><select value={selectedEmployeeId} onChange={(event) => {
            const employee = employees.find((item) => item.id === event.target.value);
            setSelectedEmployeeId(event.target.value);
            setScopeName(employee ? suggestedScopeForEmployee(employee, scopeOptions) : "Geral");
            setSavedRecord(false);
            setSavedSnapshot(null);
          }}><option value="">Selecione um colaborador</option>{filteredEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}{employee.registration ? ` · ${employee.registration}` : ""}</option>)}</select></label>
        </div>
        {selectedEmployee && <div className="attendance-employee-card">
          <div className="attendance-avatar">{selectedEmployee.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR")}</div>
          <div className="attendance-employee-main"><strong>{selectedEmployee.full_name}</strong><span>{selectedEmployee.registration ? `Matrícula ${selectedEmployee.registration}` : "Matrícula não informada"} · {employeeFunction(selectedEmployee)}</span></div>
          <span className={`attendance-status status-${selectedEmployee.status}`}>{statusLabels[selectedEmployee.status]}</span>
          <dl><div><dt>Setor</dt><dd>{selectedEmployee.department || "Não informado"}</dd></div><div><dt>Unidade</dt><dd>{selectedEmployee.unit || "Não informada"}</dd></div><div><dt>Admissão</dt><dd>{displayDate(selectedEmployee.admission_date)}</dd></div>{selectedEmployee.termination_date && <div><dt>Desligamento</dt><dd>{displayDate(selectedEmployee.termination_date)}</dd></div>}</dl>
        </div>}
        {selectedEmployee && <label className="attendance-scope-picker"><span>Centro / unidade considerado neste período</span><select value={scopeName} onChange={(event) => { setScopeName(event.target.value); setSavedRecord(false); setSavedSnapshot(null); }}><option value="Geral">Geral — sem centro/unidade específico</option>{scopeOptions.filter((scope) => ruleKey(scope) !== "geral").map((scope) => <option key={ruleKey(scope)} value={scope}>{scope}</option>)}</select><small>Quando possível, sugerimos com base na unidade do cadastro. Confirme o centro correto antes de salvar.</small></label>}
      </section>

      {!selectedEmployee ? <section className="panel attendance-empty"><UserRound size={25} /><strong>Selecione um colaborador</strong><span>Os dados funcionais e os registros do período aparecerão aqui.</span></section> : <>
        <section className="attendance-metrics" aria-label="Resumo das ocorrências individuais">
          <article><small>Atrasos na jornada</small><strong>{metrics.late ? `Sim · ${metrics.late}` : "Não"}</strong><span>Registros com data e horário</span></article>
          <article><small>Faltas justificadas</small><strong>{metrics.justified}</strong><span>Ocorrências registradas</span></article>
          <article><small>Faltas injustificadas</small><strong>{metrics.unjustified}</strong><span>Ocorrências registradas</span></article>
          <article><small>Falta de convocação</small><strong>{metrics.callout}</strong><span>Ocorrências registradas</span></article>
          <article><small>Atestados / dias</small><strong>{metrics.certificates} / {metrics.certificateDays}</strong><span>Quantidade e dias informados</span></article>
          <article><small>Advertências</small><strong>{metrics.warnings}</strong><span>Ocorrências registradas</span></article>
        </section>

        <section className="panel attendance-occurrences">
          <div className="attendance-section-heading"><div><h2>Requisitos individuais</h2><p>As datas devem pertencer ao período de {displayDate(periodStart)} a {displayDate(periodEnd)}. Cada linha representa uma ocorrência.</p></div><button type="button" className="secondary-button" onClick={() => { setSavedRecord(false); setOccurrences((current) => [...current, newOccurrence(periodStart)]); }} disabled={!validPeriod}><Plus size={15} /> Adicionar ocorrência</button></div>
          <label className="attendance-late-toggle"><span>Houve atraso na jornada neste período?</span><select value={metrics.late ? "yes" : "no"} disabled={periodLoading || !validPeriod} onChange={(event) => {
            const value = event.target.value;
            const draft = value === "yes" ? newOccurrence(periodStart) : null;
            setSavedRecord(false);
            setOccurrences((current) => {
              const hasLate = current.some((item) => item.occurrence_type === "late");
              if (value === "yes" && !hasLate && draft) return [...current, draft];
              if (value === "no") return current.filter((item) => item.occurrence_type !== "late");
              return current;
            });
          }}><option value="no">Não</option><option value="yes">Sim</option></select></label>
          {periodLoading ? <div className="attendance-inline-loading"><LoaderCircle className="spin" size={18} /> Carregando registros...</div> : occurrences.length === 0 ? <div className="attendance-no-events">Nenhuma ocorrência individual registrada neste período.</div> : <div className="attendance-event-list">
            {occurrences.map((item) => <div className="attendance-event-row" key={item.id}>
              <label><span>Ocorrência</span><select value={item.occurrence_type} onChange={(event) => updateOccurrence(item.id, "occurrence_type", event.target.value)}>{occurrenceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Data</span><input type="date" min={periodStart} max={periodEnd} value={item.occurred_on} onChange={(event) => updateOccurrence(item.id, "occurred_on", event.target.value)} /></label>
              {item.occurrence_type === "late" ? <label><span>Horário</span><input type="time" value={item.occurred_at} onChange={(event) => updateOccurrence(item.id, "occurred_at", event.target.value)} /></label> : isMultiDay(item.occurrence_type) ? <label><span>Quantidade de dias</span><input type="number" min="1" max="31" step="1" value={item.days_count} onChange={(event) => updateOccurrence(item.id, "days_count", event.target.value)} /></label> : <div className="attendance-event-kind"><Clock3 size={15} /><span>{eventLabels[item.occurrence_type]}</span></div>}
              <button type="button" className="attendance-remove-event" aria-label={`Remover ${eventLabels[item.occurrence_type]}`} onClick={() => { setSavedRecord(false); setOccurrences((current) => current.filter((event) => event.id !== item.id)); }}><X size={17} /></button>
            </div>)}
          </div>}
          <div className="attendance-value-summary"><ShieldCheck size={18} /><div><strong>Prévia estimada da assiduidade</strong><div className="attendance-estimate-grid"><div><small>Valor fixo da função</small><strong>{displayMoney(attendanceBaseAmount)}</strong></div><div><small>Redução estimada</small><strong>{displayMoney(reductionAmount)}</strong></div><div className="is-final"><small>Estimativa após critérios</small><strong>{displayMoney(estimatedAttendanceAmount)}</strong></div></div><small className="attendance-estimate-breakdown">{savedRecord ? `Redução registrada nesta gravação: ${displayMoney(reductionAmount)}` : `Individual: ${displayMoney(reductionBreakdown.individual)} · Coletivo: ${displayMoney(reductionBreakdown.collective)}${attendanceBaseAmount > 0 && reductionBreakdown.individual + reductionBreakdown.collective > attendanceBaseAmount ? " · limitado ao valor mensal" : ""}`}</small><span>{savedRecord ? "Exibindo os valores registrados nesta gravação. Ao alterar os dados, a prévia será recalculada com as regras atuais." : "Prévia para conferência do RH; não é cálculo de folha nem autoriza desconto automático."}</span></div></div>
          {!attendanceEligible && <div className="attendance-rule-warning">{selectedRule ? `A regra “${selectedRule.scope_name} · ${selectedRule.function_name}” está aguardando confirmação do RH ou não habilita o benefício; a base considerada é R$ 0,00.` : "Não há regra ativa para esta combinação de centro/unidade e função. Cadastre ou confirme em “Funções e valores”; a base considerada é R$ 0,00."}</div>}
          <div className="attendance-form-actions"><span>{savedRecord ? "Registro já salvo neste período; salvar novamente substitui suas ocorrências." : "O registro será salvo com a data e o horário do sistema no histórico de auditoria."}</span><button type="button" className="primary-button" onClick={() => void saveRecord()} disabled={periodLoading || savingRecord || !validPeriod}><Save size={15} />{savingRecord ? "Salvando..." : savedRecord ? "Salvar alterações" : "Salvar registro"}</button></div>
        </section>

      </>}
      <section className="panel attendance-collective">
        <div className="attendance-section-heading"><div><h2>Requisitos coletivos</h2><p>Uma avaliação compartilhada por toda a organização neste período.</p></div></div>
        <div className="attendance-collective-grid">
          {([["quality_status", "Qualidade"], ["service_cancellation_status", "Cancelamento de serviço"], ["safety_status", "Segurança"]] as Array<[CollectiveField, string]>).map(([field, label]) => <label key={field}><span>{label}</span><select value={collective[field]} onChange={(event) => { setSavedRecord(false); setCollective((current) => ({ ...current, [field]: event.target.value as Collective[CollectiveField] })); }}>{collectiveOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
        </div>
        <div className="attendance-form-actions"><span>Se configurada, a regra de redução coletiva será aplicada uma vez quando o critério estiver como “Não atende”.</span><button type="button" className="secondary-button" onClick={() => void saveCollective()} disabled={savingCollective || periodLoading || !validPeriod}><Save size={15} />{savingCollective ? "Salvando..." : "Salvar critérios coletivos"}</button></div>
      </section>
    </> : <section className="panel attendance-function-panel">
      <div className="attendance-section-heading"><div><h2>Elegibilidade e valor por função</h2><p>As funções são sugeridas pelos cadastros de funcionários. Valores são apenas referências configuradas, sem lançamento automático em folha.</p></div></div>
      <form className="attendance-add-function" onSubmit={(event) => { event.preventDefault(); void addFunctionRule(); }}>
        <label><span>Centro / unidade</span><input value={newScopeName} onChange={(event) => setNewScopeName(event.target.value)} maxLength={150} placeholder="Ex.: C&M - Dourados" /></label>
        <label><span>Função / grupo</span><input value={newFunctionName} onChange={(event) => setNewFunctionName(event.target.value)} maxLength={150} placeholder="Ex.: ELETRICISTA" /></label>
        <button type="submit" className="primary-button" disabled={addingFunction || !newFunctionName.trim() || !newScopeName.trim()}><Plus size={15} />{addingFunction ? "Adicionando..." : "Adicionar regra"}</button>
      </form>
      <div className="attendance-proposal-warning" role="note"><strong>Valores importados como propostas — ainda não aprovados pelo RH</strong><span>Os valores da planilha de setembro/2026 começam inativos e não entram na estimativa até a regra ser ativada e “Recebe assiduidade” ser confirmado. Em Dourados, há um valor divergente para ELETRICISTA (23 registros indicam R$ 210,00 e 1 indica R$ 472,50).</span></div>
      {rules.length === 0 ? <div className="attendance-empty"><strong>Nenhuma regra configurada</strong><span>Adicione uma combinação de centro/unidade e função ou confirme se a migração do banco já foi aplicada.</span></div> : <div className="attendance-scope-groups">
        {Array.from(new Set(rules.map((rule) => rule.scope_name))).sort((a, b) => a.localeCompare(b, "pt-BR")).map((scope, index) => {
          const scopedRules = rules.filter((rule) => rule.scope_name === scope);
          const pending = scopedRules.filter((rule) => !rule.active || !rule.receives_attendance).length;
          return <details className="attendance-scope-group" key={scope} open={index === 0 || ruleKey(scope) !== "geral"}>
            <summary><strong>{scope}</strong><span>{scopedRules.length} funções · {pending} aguardando confirmação</span></summary>
            <div className="attendance-rules-list">
              {scopedRules.map((rule) => <article className="attendance-rule-row" key={rule.id}>
                <div className="attendance-rule-name"><strong>{rule.function_name}</strong><small className="attendance-rule-scope">{rule.source_note || (!rule.active || !rule.receives_attendance ? "Aguardando confirmação do RH" : "Regra configurada")}</small></div>
                <label className="attendance-toggle"><input type="checkbox" checked={rule.active} onChange={(event) => updateRule(rule.id, "active", event.target.checked)} /><span>Regra ativa</span></label>
                <label className="attendance-toggle"><input type="checkbox" checked={rule.receives_attendance} onChange={(event) => updateRule(rule.id, "receives_attendance", event.target.checked)} /><span>Recebe assiduidade</span></label>
                <label className="attendance-amount"><span>Valor mensal proposto</span><div><span>R$</span><input inputMode="decimal" aria-label={`Valor mensal para ${scope} · ${rule.function_name}`} value={amountDrafts[rule.id] ?? toInputMoney(rule.monthly_amount)} onChange={(event) => setAmountDrafts((current) => ({ ...current, [rule.id]: event.target.value }))} /></div></label>
                <button type="button" className="secondary-button" onClick={() => void saveFunctionRule(rule)} disabled={savingRuleId === rule.id}><Save size={14} />{savingRuleId === rule.id ? "Salvando..." : "Salvar"}</button>
              </article>)}
            </div>
          </details>;
        })}
      </div>}
      <div className="attendance-reduction-panel">
        <div className="attendance-section-heading"><div><h2>Redução por ocorrência e critério coletivo</h2><p>Configure quanto cada evento reduz do valor fixo da função.</p></div></div>
        <p className="attendance-reduction-note">Configure um valor fixo em reais por ocorrência; faltas e atestados são calculados por dia, e cada critério coletivo “Não atende” conta uma vez. Cada regra começa zerada e desativada; somente regras marcadas “Aplicar na estimativa” entram no cálculo. A planilha não define regras consistentes de desconto e contém 10 linhas em que o desconto supera a assiduidade prevista, por isso nenhum desconto foi inferido. A estimativa não autoriza desconto automático em folha.</p>
        <div className="attendance-reduction-functions">
          {rules.map((functionRule, index) => {
            const functionReductions = reductionRules.filter((rule) => rule.function_rule_id === functionRule.id);
            return <details className="attendance-reduction-function" key={functionRule.id} open={index === 0}>
              <summary><strong>{functionRule.scope_name} · {functionRule.function_name}</strong><span>{functionReductions.filter((rule) => rule.active).length}/{functionReductions.length} critérios ativos</span></summary>
              <div className="attendance-reduction-list">
                {functionReductions.map((rule) => <label className="attendance-reduction-row" key={rule.id}>
                  <strong>{reductionLabels[rule.criterion_key] ?? rule.criterion_key}</strong>
                  <span className="attendance-reduction-input"><span>R$</span><input type="number" min="0" max="9999999999.99" step="0.01" inputMode="decimal" aria-label={`Valor fixo por evento para ${functionRule.function_name}: ${reductionLabels[rule.criterion_key] ?? rule.criterion_key}`} value={reductionDrafts[rule.id] ?? String(rule.reduction_amount)} onChange={(event) => updateReductionDraft(rule.id, event.target.value)} /></span>
                  <span className="attendance-reduction-activation"><input type="checkbox" checked={rule.active} onChange={(event) => updateReductionRule(rule.id, "active", event.target.checked)} /><span>Aplicar na estimativa (após confirmação do RH)</span></span>
                </label>)}
                {functionReductions.length === 0 && <p className="attendance-reduction-empty">Regras ainda não carregadas. Atualize a página para tentar novamente.</p>}
              </div>
            </details>;
          })}
        </div>
        <div className="attendance-form-actions"><span>Somente regras ativas são abatidas por ocorrência/dia e o total é limitado à assiduidade mensal. Isso é apenas uma estimativa para análise do RH.</span><button type="button" className="primary-button" onClick={() => void saveReductionRules()} disabled={savingReductions || reductionRules.length === 0}><Save size={15} />{savingReductions ? "Salvando..." : "Salvar regras de redução"}</button></div>
      </div>
    </section>}
  </main>;
}
