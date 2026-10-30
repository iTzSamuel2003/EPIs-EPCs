"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, Check, Clock3, LoaderCircle, Plus, Save, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { EmployeeAutocomplete } from "@/components/employee-autocomplete";
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
type FunctionRuleView = FunctionRule & {
  memberIds: string[];
  displayName: string;
  hasConfigurationConflict: boolean;
};

type OccurrenceType = "late" | "absence_justified" | "absence_unjustified" | "convocation_absence" | "medical_certificate" | "warning";
type Occurrence = { id: string; occurrence_type: OccurrenceType; occurred_on: string; occurred_at: string | null; days_count: number; is_unjustified: boolean; missing_time_record: boolean; convocation_notice_hours: number | null };
type OccurrenceDraft = { id: string; occurrence_type: OccurrenceType; occurred_on: string; occurred_at: string; days_count: string; is_unjustified: boolean; missing_time_record: boolean; convocation_notice_hours: string };
type Collective = { quality_occurrence_count: string; service_cancellation_occurrence_count: string; safety_status: "not_evaluated" | "meets" | "does_not_meet" };
type SavedSnapshot = { scope_name_snapshot: string; receives_attendance_snapshot: boolean; monthly_amount_snapshot: number | string; reduction_amount_snapshot: number | string; estimated_amount_snapshot: number | string; quality_occurrence_count: number | string; service_cancellation_occurrence_count: number | string; safety_status: Collective["safety_status"] };
type PeriodSummaryRecord = {
  id: string;
  employee_id: string;
  function_name_snapshot: string;
  scope_name_snapshot: string;
  receives_attendance_snapshot: boolean;
  monthly_amount_snapshot: number | string;
  reduction_amount_snapshot: number | string;
  estimated_amount_snapshot: number | string;
  quality_occurrence_count: number;
  service_cancellation_occurrence_count: number;
  safety_status: Collective["safety_status"];
  updated_at: string;
  occurrences: PeriodSummaryOccurrence[];
};
type PeriodSummaryOccurrence = {
  attendance_record_id: string;
  occurrence_type: OccurrenceType;
  days_count: number;
  is_unjustified: boolean;
  missing_time_record: boolean;
  convocation_notice_hours: number | null;
};
type PeriodSummaryRow = {
  id: string;
  employee_id: string;
  employee: Employee;
  function_name_snapshot: string;
  scope_name_snapshot: string;
  receives_attendance_snapshot: boolean;
  fullAmount: number | null;
  reductionAmount: number;
  estimatedAmount: number | null;
  reductionCriteria: string;
  registered: boolean;
  scopeAmbiguous: boolean;
};

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
const emptyCollective: Collective = { quality_occurrence_count: "0", service_cancellation_occurrence_count: "0", safety_status: "not_evaluated" };
const collectiveOptions = [["not_evaluated", "Não avaliado"], ["meets", "Atende"], ["does_not_meet", "Não atende"]] as const;

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
function describeReductionCriteria(record: PeriodSummaryRecord) {
  const criteria: string[] = [];
  const occurrences = record.occurrences ?? [];
  if (occurrences.some((item) => item.occurrence_type === "absence_unjustified")) criteria.push("falta injustificada");
  if (occurrences.some((item) => item.occurrence_type === "late" && (item.is_unjustified || item.missing_time_record))) criteria.push("jornada/ponto");
  if (occurrences.some((item) => item.occurrence_type === "convocation_absence" && item.is_unjustified && Number(item.convocation_notice_hours ?? 0) >= 24)) criteria.push("falta à convocação");
  const justifiedDays = occurrences.filter((item) => item.occurrence_type === "absence_justified" || item.occurrence_type === "medical_certificate").reduce((total, item) => total + Number(item.days_count || 0), 0);
  if (justifiedDays > 1) criteria.push(`${justifiedDays} dias de ausência justificada/atestado`);
  if (record.quality_occurrence_count > 0) criteria.push(`qualidade: ${record.quality_occurrence_count}`);
  if (record.service_cancellation_occurrence_count > 0) criteria.push(`cancelamento/atraso: ${record.service_cancellation_occurrence_count}`);
  if (record.safety_status === "does_not_meet") criteria.push("segurança apurada");
  return criteria.length ? criteria.join(" · ") : record.reduction_amount_snapshot && Number(record.reduction_amount_snapshot) > 0 ? "Confira os critérios no registro individual" : "Nenhum critério de redução";
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
function isElectricalOperationsSupervisor(value: string) {
  return /^supervisor(?: de)? op(?:eracoes)? eletric/.test(ruleKey(value));
}
function generalAttendanceFunctionName(value: string) {
  const key = ruleKey(value);
  if (/^eletricista (?:(?:de )?linha morta|lm)(?: |$)/.test(key)) return "ELETRICISTA LINHA MORTA";
  if (/^eletricista (?:(?:de )?linha viva|lv)(?: |$)/.test(key)) return "ELETRICISTA LINHA VIVA";
  if (key.startsWith("eletricista podador")) return "ELETRICISTA PODADOR";
  if (/^encarregado (?:linha morta|lm)(?: |$)/.test(key)) return "ENCARREGADO LINHA MORTA";
  if (/^encarregado (?:linha viva|lv)(?: |$)/.test(key)) return "ENCARREGADO LINHA VIVA";
  if (key.startsWith("encarregado de poda")) return "ENCARREGADO DE PODA";
  if (isElectricalOperationsSupervisor(key) || key.startsWith("lider de op eletric")) return "SUPERVISOR DE OPERAÇÕES ELÉTRICAS";
  return null;
}
function buildFunctionRuleViews(rules: FunctionRule[]): FunctionRuleView[] {
  const visible: FunctionRuleView[] = [];
  const generalGroups = new Map<string, FunctionRule[]>();
  for (const rule of rules) {
    if (ruleKey(rule.scope_name) !== "geral") {
      visible.push({ ...rule, memberIds: [rule.id], displayName: rule.function_name, hasConfigurationConflict: false });
      continue;
    }
    const displayName = generalAttendanceFunctionName(rule.function_name);
    if (!displayName) continue;
    const group = generalGroups.get(displayName) ?? [];
    group.push(rule);
    generalGroups.set(displayName, group);
  }
  for (const [displayName, members] of generalGroups) {
    const sortedMembers = [...members].sort((a, b) => Number(ruleKey(a.function_name) !== ruleKey(displayName)) - Number(ruleKey(b.function_name) !== ruleKey(displayName)) || a.function_name.localeCompare(b.function_name, "pt-BR"));
    const representative = sortedMembers[0];
    const configurationKeys = new Set(members.map((rule) => `${rule.active}|${rule.receives_attendance}|${Number(rule.monthly_amount)}`));
    visible.push({
      ...representative,
      function_name: displayName,
      displayName,
      memberIds: members.map((rule) => rule.id),
      active: members.some((rule) => rule.active),
      receives_attendance: members.some((rule) => rule.receives_attendance),
      hasConfigurationConflict: configurationKeys.size > 1,
    });
  }
  return visible.sort((a, b) => a.scope_name.localeCompare(b.scope_name, "pt-BR") || a.displayName.localeCompare(b.displayName, "pt-BR"));
}
function functionMatchRank(ruleName: string, employeeFunction: string) {
  const rule = ruleKey(ruleName);
  const employee = ruleKey(employeeFunction);
  if (rule === employee) return 0;
  if (isElectricalOperationsSupervisor(rule) && isElectricalOperationsSupervisor(employee)) return 1;
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
  const departmentKey = ruleKey(employee.department ?? "");
  const exactDepartmentScope = scopes.find((scope) => ruleKey(scope) === departmentKey);
  if (exactDepartmentScope) return exactDepartmentScope;
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
  return { id: crypto.randomUUID(), occurrence_type: "late", occurred_on: periodStart, occurred_at: "", days_count: "1", is_unjustified: false, missing_time_record: false, convocation_notice_hours: "" };
}
function isMultiDay(type: OccurrenceType) {
  return ["absence_justified", "absence_unjustified", "convocation_absence", "medical_certificate"].includes(type);
}
function countValue(value: string) {
  const parsed = Number(value || "0");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
function officialReductionPercentages(occurrences: OccurrenceDraft[], collective: Collective) {
  const fullIndividualReduction = occurrences.some((item) =>
    item.occurrence_type === "absence_unjustified" ||
    (item.occurrence_type === "late" && (item.missing_time_record || item.is_unjustified)) ||
    (item.occurrence_type === "convocation_absence" && item.is_unjustified && countValue(item.convocation_notice_hours) >= 24)
  );
  const justifiedAbsenceDays = occurrences
    .filter((item) => item.occurrence_type === "absence_justified" || item.occurrence_type === "medical_certificate")
    .reduce((total, item) => total + countValue(item.days_count), 0);
  const individual = fullIndividualReduction ? 100 : justifiedAbsenceDays > 1 ? 50 : 0;
  const qualityCount = countValue(collective.quality_occurrence_count);
  const serviceCount = countValue(collective.service_cancellation_occurrence_count);
  const quality = qualityCount > 3 ? 100 : qualityCount * 10;
  const service = serviceCount > 2 ? 100 : serviceCount * 20;
  const safety = collective.safety_status === "does_not_meet" ? 100 : 0;
  return { individual, collective: Math.min(100, quality + service + safety) };
}
function isAttendanceTargetFunction(functionName: string) {
  const key = ruleKey(functionName);
  return /^eletricista(?: |$)/.test(key) ||
    /^encarregad[oa](?:$| (?:lm|lv|linha morta|linha viva|de poda|i{1,3}|iv|v|vi)(?: |$))/.test(key) ||
    isElectricalOperationsSupervisor(key);
}
function attendanceRuleGroup(employee: Employee) {
  const role = ruleKey(employeeFunction(employee));
  const department = ruleKey(employee.department ?? "");
  if (department.includes("poda") || role.includes("podador") || role.includes("de poda")) return "poda";
  if (department.includes("construcao") || /(?:^| )(?:lm|lv|linha morta|linha viva)(?: |$)/.test(role)) return "cm";
  return null;
}
function resolveAttendanceRule(employee: Employee, rules: FunctionRule[], scopes: string[], scopeOverride?: string | null) {
  if (!isAttendanceTargetFunction(employeeFunction(employee))) return { rule: null, ambiguous: false };
  const functionName = employeeFunction(employee);
  const matchingRules = rules.filter((rule) => functionMatchRank(rule.function_name, functionName) !== null);
  const group = attendanceRuleGroup(employee);
  const groupMatches = group === "poda"
    ? matchingRules.filter((rule) => ruleKey(rule.scope_name).startsWith("poda "))
    : group === "cm"
      ? matchingRules.filter((rule) => ruleKey(rule.scope_name).startsWith("c m "))
      : matchingRules;
  const preferredScope = scopeOverride || suggestedScopeForEmployee(employee, scopes);
  const preferredMatches = preferredScope && ruleKey(preferredScope) !== "geral"
    ? groupMatches.filter((rule) => ruleKey(rule.scope_name) === ruleKey(preferredScope))
    : [];
  if (preferredMatches.length) {
    const best = [...preferredMatches].sort((a, b) => functionMatchRank(a.function_name, functionName)! - functionMatchRank(b.function_name, functionName)! || ruleKey(b.function_name).length - ruleKey(a.function_name).length)[0];
    return { rule: best.active && best.receives_attendance ? best : null, ambiguous: false };
  }

  const sourceMatches = groupMatches.length
    ? groupMatches
    : matchingRules.filter((rule) => ruleKey(rule.scope_name) === "geral");
  const bestPerScope = new Map<string, FunctionRule>();
  for (const rule of sourceMatches) {
    const scopeKey = ruleKey(rule.scope_name);
    const current = bestPerScope.get(scopeKey);
    if (!current || functionMatchRank(rule.function_name, functionName)! < functionMatchRank(current.function_name, functionName)! || (functionMatchRank(rule.function_name, functionName) === functionMatchRank(current.function_name, functionName) && ruleKey(rule.function_name).length > ruleKey(current.function_name).length)) {
      bestPerScope.set(scopeKey, rule);
    }
  }
  const eligibleRules = Array.from(bestPerScope.values()).filter((rule) => rule.active && rule.receives_attendance);
  if (!eligibleRules.length) return { rule: null, ambiguous: false };
  const amounts = new Set(eligibleRules.map((rule) => Number(rule.monthly_amount)));
  if (amounts.size > 1) return { rule: null, ambiguous: true };
  const selected = [...eligibleRules].sort((a, b) => ruleKey(a.scope_name).localeCompare(ruleKey(b.scope_name), "pt-BR"))[0];
  return { rule: selected, ambiguous: false };
}

export default function AttendancePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rules, setRules] = useState<FunctionRule[]>([]);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [organizationId, setOrganizationId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [scopeName, setScopeName] = useState("Geral");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [occurrences, setOccurrences] = useState<OccurrenceDraft[]>([]);
  const [collective, setCollective] = useState<Collective>(emptyCollective);
  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot | null>(null);
  const [savedRecord, setSavedRecord] = useState(false);
  const [periodSummaryRecords, setPeriodSummaryRecords] = useState<PeriodSummaryRecord[]>([]);
  const [periodSummaryLoading, setPeriodSummaryLoading] = useState(false);
  const [periodSummaryError, setPeriodSummaryError] = useState("");
  const [periodSummaryRefresh, setPeriodSummaryRefresh] = useState(0);
  const [periodSummarySearch, setPeriodSummarySearch] = useState("");
  const [tab, setTab] = useState<"records" | "summary" | "functions">("records");
  const [newFunctionName, setNewFunctionName] = useState("");
  const [newScopeName, setNewScopeName] = useState("Geral");
  const [loading, setLoading] = useState(true);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState("");
  const [addingFunction, setAddingFunction] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedFunctionName = selectedEmployee ? employeeFunction(selectedEmployee) : "";
  const selectedRule = selectedEmployee ? findFunctionRule(rules, selectedFunctionName, scopeName) : null;
  const scopeOptions = useMemo(() => ["Geral", ...Array.from(new Map(rules.filter((rule) => ruleKey(rule.scope_name) !== "geral").map((rule) => [ruleKey(rule.scope_name), rule.scope_name])).values()).sort((a, b) => a.localeCompare(b, "pt-BR"))], [rules]);
  const functionRuleViews = useMemo(() => buildFunctionRuleViews(rules), [rules]);
  const validPeriod = Boolean(periodStart && periodEnd && periodEnd >= periodStart && daysInPeriod(periodStart, periodEnd) <= 31);
  const periodSummary = useMemo(() => {
    const savedByEmployee = new Map(periodSummaryRecords.map((record) => [record.employee_id, record]));
    const rows = employees.filter((employee) => employee.status === "active" && isAttendanceTargetFunction(employeeFunction(employee))).map((employee): PeriodSummaryRow | null => {
      const saved = savedByEmployee.get(employee.id) ?? null;
      const resolution = resolveAttendanceRule(employee, rules, scopeOptions, saved?.scope_name_snapshot);
      const hasSavedEligibility = Boolean(saved?.receives_attendance_snapshot);
      if (!hasSavedEligibility && !resolution.rule && !resolution.ambiguous) return null;
      const fullAmount = hasSavedEligibility
        ? Number(saved?.monthly_amount_snapshot ?? 0)
        : resolution.rule ? Number(resolution.rule.monthly_amount) : null;
      const calculatedReduction = saved && fullAmount !== null && !hasSavedEligibility
        ? (() => {
          const percentages = officialReductionPercentages(saved.occurrences.map((item) => ({
            id: `${saved.id}-${item.attendance_record_id}-${item.occurrence_type}-${item.days_count}`,
            occurrence_type: item.occurrence_type,
            occurred_on: "",
            occurred_at: "",
            days_count: String(item.days_count),
            is_unjustified: item.is_unjustified,
            missing_time_record: item.missing_time_record,
            convocation_notice_hours: item.convocation_notice_hours == null ? "" : String(item.convocation_notice_hours),
          })), {
            quality_occurrence_count: String(saved.quality_occurrence_count),
            service_cancellation_occurrence_count: String(saved.service_cancellation_occurrence_count),
            safety_status: saved.safety_status,
          });
          const individual = Math.round(fullAmount * percentages.individual) / 100;
          const collectiveAmount = Math.round(fullAmount * percentages.collective) / 100;
          return Math.min(fullAmount, Math.round((individual + collectiveAmount) * 100) / 100);
        })()
        : 0;
      const reductionAmount = fullAmount === null ? 0 : Math.min(fullAmount, hasSavedEligibility ? Number(saved?.reduction_amount_snapshot ?? 0) : calculatedReduction);
      const estimatedAmount = fullAmount === null
        ? null
        : hasSavedEligibility ? Number(saved?.estimated_amount_snapshot ?? 0) : Math.max(0, Math.round((fullAmount - reductionAmount) * 100) / 100);
      return {
        id: saved?.id ?? employee.id,
        employee_id: employee.id,
        employee,
        function_name_snapshot: saved?.function_name_snapshot || employeeFunction(employee),
        scope_name_snapshot: hasSavedEligibility ? saved?.scope_name_snapshot ?? "Regra salva" : resolution.rule?.scope_name ?? "Centro pendente",
        receives_attendance_snapshot: true,
        fullAmount,
        reductionAmount,
        estimatedAmount,
        reductionCriteria: saved ? describeReductionCriteria(saved) : resolution.ambiguous ? "Valor depende da definição do centro (EMS/ESS)." : "Aguardando lançamento; considerado sem redução.",
        registered: Boolean(saved),
        scopeAmbiguous: !hasSavedEligibility && resolution.ambiguous,
      };
    }).filter((row): row is PeriodSummaryRow => row !== null).sort((a, b) => a.employee.full_name.localeCompare(b.employee.full_name, "pt-BR"));
    const pendingEmployees = rows.filter((row) => !row.registered).map((row) => row.employee);
    const includedEmployeeIds = new Set(rows.map((row) => row.employee_id));
    const withoutEnabledRule = employees.filter((employee) => employee.status === "active" && isAttendanceTargetFunction(employeeFunction(employee)) && !includedEmployeeIds.has(employee.id));
    const sumAmount = (amount: (row: PeriodSummaryRow) => number | null) => rows.reduce((total, row) => {
      const value = amount(row);
      return total + (value === null ? 0 : Math.round(value * 100));
    }, 0) / 100;
    const unresolvedScopes = rows.filter((row) => row.scopeAmbiguous);
    return {
      rows,
      pendingEmployees,
      unresolvedScopes,
      withoutEnabledRule,
      fullAmount: sumAmount((row) => row.fullAmount),
      reductionAmount: sumAmount((row) => row.fullAmount === null ? null : row.reductionAmount),
      estimatedAmount: sumAmount((row) => row.estimatedAmount),
      beneficiaries: rows.length,
      recordsWithReduction: rows.filter((row) => row.reductionAmount > 0).length,
    };
  }, [employees, periodSummaryRecords, rules, scopeOptions]);
  const filteredPeriodSummaryRows = useMemo(() => {
    const query = ruleKey(periodSummarySearch);
    if (!query) return periodSummary.rows;
    return periodSummary.rows.filter((row) => ruleKey([
      row.employee?.full_name ?? "",
      row.employee?.registration ?? "",
      row.function_name_snapshot,
      row.scope_name_snapshot,
    ].join(" ")).includes(query));
  }, [periodSummary.rows, periodSummarySearch]);
  const metrics = useMemo(() => {
    const count = (type: OccurrenceType) => occurrences.filter((item) => item.occurrence_type === type).length;
    const days = (type: OccurrenceType) => occurrences.filter((item) => item.occurrence_type === type).reduce((total, item) => total + Number(item.days_count || 0), 0);
    return {
      late: count("late"),
      justified: count("absence_justified"),
      justifiedDays: days("absence_justified"),
      unjustified: count("absence_unjustified"),
      unjustifiedDays: days("absence_unjustified"),
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
  const reductionPercentages = officialReductionPercentages(occurrences, collective);
  const individualReduction = Math.round(attendanceBaseAmount * reductionPercentages.individual) / 100;
  const collectiveReduction = Math.round(attendanceBaseAmount * reductionPercentages.collective) / 100;
  const reductionBreakdown = {
    individual: individualReduction,
    collective: collectiveReduction,
    total: Math.min(attendanceBaseAmount, Math.round((individualReduction + collectiveReduction) * 100) / 100),
  };
  const reductionAmount = reductionBreakdown.total;
  const estimatedAttendanceAmount = Math.max(0, Math.round((attendanceBaseAmount - reductionAmount) * 100) / 100);

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
      const [employeeResult, ruleResult] = await Promise.all([
        supabase.from("employees").select("id,registration,full_name,job_title,function_name,function_classification,department,unit,admission_date,termination_date,status").order("full_name"),
        supabase.from("attendance_function_rules").select("id,scope_name,function_name,source_note,receives_attendance,monthly_amount,active").order("scope_name").order("function_name"),
      ]);
      if (!active) return;
      if (employeeResult.error || ruleResult.error) {
        setError("Não foi possível carregar funcionários e regras. Confirme se a atualização do banco foi aplicada e se seu perfil tem acesso ao RH.");
      } else {
        setOrganizationId(profile.organization_id);
        setEmployees((employeeResult.data ?? []) as Employee[]);
        const loadedRules = (ruleResult.data ?? []) as FunctionRule[];
        setRules(loadedRules);
        setAmountDrafts(Object.fromEntries(loadedRules.map((rule) => [rule.id, toInputMoney(rule.monthly_amount)])));
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
      setCollective(emptyCollective);
      setSavedSnapshot(null);
      setSavedRecord(false);
      const supabase = createClient();
      const recordPromise = selectedEmployeeId
        ? supabase.from("attendance_period_records").select("id,scope_name_snapshot,receives_attendance_snapshot,monthly_amount_snapshot,reduction_amount_snapshot,estimated_amount_snapshot,quality_occurrence_count,service_cancellation_occurrence_count,safety_status").eq("employee_id", selectedEmployeeId).eq("period_start", periodStart).eq("period_end", periodEnd).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const recordResult = await recordPromise;
      if (!active) return;
      if (recordResult.error) {
        setError("Não foi possível carregar os registros deste período.");
        setPeriodLoading(false);
        return;
      }
      const saved = recordResult.data as SavedSnapshot & { id: string } | null;
      if (saved && selectedEmployeeId) {
        const { data, error: eventError } = await supabase.from("attendance_occurrences").select("id,occurrence_type,occurred_on,occurred_at,days_count,is_unjustified,missing_time_record,convocation_notice_hours").eq("attendance_record_id", saved.id).order("occurred_on").order("created_at");
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
          is_unjustified: Boolean(item.is_unjustified),
          missing_time_record: Boolean(item.missing_time_record),
          convocation_notice_hours: item.convocation_notice_hours == null ? "" : String(item.convocation_notice_hours),
        })));
        setSavedSnapshot(saved);
        setSavedRecord(true);
        setScopeName(saved.scope_name_snapshot || "Geral");
        setCollective({
          quality_occurrence_count: String(saved.quality_occurrence_count ?? 0),
          service_cancellation_occurrence_count: String(saved.service_cancellation_occurrence_count ?? 0),
          safety_status: saved.safety_status ?? "not_evaluated",
        });
      }
      setPeriodLoading(false);
    }
    void loadPeriod();
    return () => { active = false; };
  }, [organizationId, periodStart, periodEnd, selectedEmployeeId, validPeriod]);

  useEffect(() => {
    let active = true;
    async function loadPeriodSummary() {
      if (tab !== "summary" || !organizationId) return;
      if (!validPeriod) {
        setPeriodSummaryRecords([]);
        setPeriodSummaryError("Informe datas válidas para um período de 1 a 31 dias.");
        setPeriodSummaryLoading(false);
        return;
      }
      setPeriodSummaryLoading(true);
      setPeriodSummaryError("");
      const supabase = createClient();
      const { data, error: queryError } = await supabase
        .from("attendance_period_records")
        .select("id,employee_id,function_name_snapshot,scope_name_snapshot,receives_attendance_snapshot,monthly_amount_snapshot,reduction_amount_snapshot,estimated_amount_snapshot,quality_occurrence_count,service_cancellation_occurrence_count,safety_status,updated_at")
        .eq("organization_id", organizationId)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .order("updated_at", { ascending: false });
      if (!active) return;
      if (queryError) {
        setPeriodSummaryError("Não foi possível carregar o resumo deste período.");
        setPeriodSummaryRecords([]);
      } else {
        const records = (data ?? []) as Omit<PeriodSummaryRecord, "occurrences">[];
        const recordIds = records.map((record) => record.id);
        const { data: occurrenceData, error: occurrenceError } = recordIds.length
          ? await supabase.from("attendance_occurrences")
            .select("attendance_record_id,occurrence_type,days_count,is_unjustified,missing_time_record,convocation_notice_hours")
            .eq("organization_id", organizationId)
            .in("attendance_record_id", recordIds)
          : { data: [], error: null };
        if (!active) return;
        if (occurrenceError) {
          setPeriodSummaryError("Não foi possível carregar os critérios registrados neste período.");
          setPeriodSummaryRecords([]);
        } else {
          const occurrencesByRecord = new Map<string, PeriodSummaryOccurrence[]>();
          for (const occurrence of (occurrenceData ?? []) as PeriodSummaryOccurrence[]) {
            const events = occurrencesByRecord.get(occurrence.attendance_record_id) ?? [];
            events.push(occurrence);
            occurrencesByRecord.set(occurrence.attendance_record_id, events);
          }
          setPeriodSummaryRecords(records.map((record) => ({ ...record, occurrences: occurrencesByRecord.get(record.id) ?? [] })));
        }
      }
      setPeriodSummaryLoading(false);
    }
    void loadPeriodSummary();
    return () => { active = false; };
  }, [organizationId, periodStart, periodEnd, validPeriod, tab, periodSummaryRefresh]);

  function updateOccurrence(id: string, field: keyof Omit<OccurrenceDraft, "id">, value: string | boolean) {
    setSavedRecord(false);
    setOccurrences((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (field === "occurrence_type") {
        const nextType = value as OccurrenceType;
        return {
          ...item,
          occurrence_type: nextType,
          occurred_at: nextType === "late" ? item.occurred_at : "",
          days_count: isMultiDay(nextType) ? (isMultiDay(item.occurrence_type) ? item.days_count : "1") : "1",
          is_unjustified: nextType === "late" || nextType === "convocation_absence" ? item.is_unjustified : false,
          missing_time_record: nextType === "late" ? item.missing_time_record : false,
          convocation_notice_hours: nextType === "convocation_absence" ? item.convocation_notice_hours : "",
        };
      }
      if (field === "missing_time_record" && value) return { ...item, missing_time_record: true, occurred_at: "" };
      return { ...item, [field]: value };
    }));
  }

  async function saveRecord() {
    if (!selectedEmployee || savingRecord || !validPeriod) return;
    setError("");
    setSuccess("");
    const invalid = occurrences.some((item) =>
      !item.occurred_on || item.occurred_on < periodStart || item.occurred_on > periodEnd ||
      (item.occurrence_type === "late" && ((item.missing_time_record && Boolean(item.occurred_at)) || (!item.missing_time_record && !item.occurred_at))) ||
      (item.occurrence_type === "convocation_absence" && item.convocation_notice_hours !== "" && (!Number.isInteger(Number(item.convocation_notice_hours)) || Number(item.convocation_notice_hours) < 0 || Number(item.convocation_notice_hours) > 720)) ||
      (isMultiDay(item.occurrence_type) && (!Number.isInteger(Number(item.days_count)) || Number(item.days_count) < 1 || Number(item.days_count) > 31))
    );
    const invalidCollectiveCount = [collective.quality_occurrence_count, collective.service_cancellation_occurrence_count]
      .some((value) => value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 100000));
    if (invalid || invalidCollectiveCount) { setError("Confira datas, horários, quantidades de dias e critérios coletivos deste registro."); return; }
    setSavingRecord(true);
    const supabase = createClient();
    const { data, error: saveError } = await supabase.rpc("save_attendance_period_record_scoped", {
      p_employee_id: selectedEmployee.id,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_scope_name: scopeName,
      p_events: {
        events: occurrences.map((item) => ({
          type: item.occurrence_type,
          date: item.occurred_on,
          time: item.occurrence_type === "late" ? item.occurred_at : null,
          days: isMultiDay(item.occurrence_type) ? Number(item.days_count) : 1,
          unjustified: (item.occurrence_type === "late" || item.occurrence_type === "convocation_absence") && item.is_unjustified,
          missing_time_record: item.occurrence_type === "late" && item.missing_time_record,
          notice_hours: item.occurrence_type === "convocation_absence" && item.convocation_notice_hours !== "" ? Number(item.convocation_notice_hours) : null,
        })),
        collective: {
          quality_occurrence_count: countValue(collective.quality_occurrence_count),
          service_cancellation_occurrence_count: countValue(collective.service_cancellation_occurrence_count),
          safety_status: collective.safety_status,
        },
      },
    });
    if (saveError || !data) {
      setError(saveError?.message?.includes("RH") ? "Seu perfil não tem acesso para registrar assiduidade." : "Não foi possível salvar o registro. Confira o período e as ocorrências.");
    } else {
      setSavedRecord(true);
      setSavedSnapshot({ scope_name_snapshot: scopeName, receives_attendance_snapshot: Boolean(selectedRule?.active && selectedRule.receives_attendance), monthly_amount_snapshot: selectedRule?.active && selectedRule.receives_attendance ? selectedRule.monthly_amount : 0, reduction_amount_snapshot: reductionAmount, estimated_amount_snapshot: estimatedAttendanceAmount, quality_occurrence_count: countValue(collective.quality_occurrence_count), service_cancellation_occurrence_count: countValue(collective.service_cancellation_occurrence_count), safety_status: collective.safety_status });
      setPeriodSummaryRefresh((current) => current + 1);
      setSuccess("Registro individual salvo para este período.");
    }
    setSavingRecord(false);
  }

  async function addFunctionRule() {
    const scope = newScopeName.trim().replace(/\s+/g, " ");
    const requestedName = newFunctionName.trim().replace(/\s+/g, " ");
    const generalName = ruleKey(scope) === "geral" ? generalAttendanceFunctionName(requestedName) : null;
    if (ruleKey(scope) === "geral" && !generalName) {
      setError("Em Geral, use uma das funções operacionais padronizadas. Para outras funções, selecione o centro/unidade correspondente.");
      return;
    }
    const name = generalName ?? requestedName;
    if (!name || !scope || addingFunction) return;
    if (rules.some((rule) => ruleKey(rule.scope_name) === ruleKey(scope) && (ruleKey(rule.function_name) === ruleKey(name) || (generalName && generalAttendanceFunctionName(rule.function_name) === generalName)))) {
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
      setRules((current) => [...current, added].sort((a, b) => a.scope_name.localeCompare(b.scope_name, "pt-BR") || a.function_name.localeCompare(b.function_name, "pt-BR")));
      setAmountDrafts((current) => ({ ...current, [added.id]: toInputMoney(added.monthly_amount) }));
      setNewFunctionName("");
      setNewScopeName("Geral");
      setSuccess("Regra adicionada inativa e sem assiduidade habilitada. Confirme a elegibilidade e o valor com o RH.");
    }
    setAddingFunction(false);
  }

  async function saveFunctionRule(rule: FunctionRuleView) {
    if (savingRuleId) return;
    const amount = parseInputMoney(amountDrafts[rule.id] ?? toInputMoney(rule.monthly_amount));
    if (!Number.isFinite(amount) || amount < 0) { setError("Informe um valor mensal válido para a função."); return; }
    const scope = rule.scope_name.trim().replace(/\s+/g, " ");
    if (!scope || scope.length > 150) { setError("Informe um centro/unidade com até 150 caracteres."); return; }
    if (rules.some((item) => !rule.memberIds.includes(item.id) && ruleKey(item.scope_name) === ruleKey(scope) && ruleKey(item.function_name) === ruleKey(rule.function_name))) {
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
    }).in("id", rule.memberIds).select("id");
    if (updateError || !data || data.length !== rule.memberIds.length) setError("Não foi possível salvar a regra consolidada da função.");
    else {
      const memberIds = new Set(rule.memberIds);
      setRules((current) => current.map((item) => memberIds.has(item.id) ? { ...item, scope_name: scope, receives_attendance: rule.receives_attendance, monthly_amount: amount, active: rule.active } : item).sort((a, b) => a.scope_name.localeCompare(b.scope_name, "pt-BR") || a.function_name.localeCompare(b.function_name, "pt-BR")));
      setAmountDrafts((current) => ({ ...current, ...Object.fromEntries(rule.memberIds.map((id) => [id, toInputMoney(amount)])) }));
      setSuccess(`Regra consolidada de ${rule.displayName} salva para todas as classificações.`);
    }
    setSavingRuleId("");
  }

  function updateRule(ids: string[], field: "receives_attendance" | "active", value: boolean) {
    const memberIds = new Set(ids);
    setRules((current) => current.map((rule) => memberIds.has(rule.id) ? { ...rule, [field]: value } : rule));
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
      <button type="button" role="tab" aria-selected={tab === "summary"} className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}><Banknote size={16} /> Prévia de valores</button>
      <button type="button" role="tab" aria-selected={tab === "functions"} className={tab === "functions" ? "active" : ""} onClick={() => setTab("functions")}><ShieldCheck size={16} /> Funções e valores</button>
    </div>

    {error && <div className="feedback error-feedback" role="alert"><X size={16} />{error}</div>}
    {success && <div className="feedback success-feedback" role="status"><Check size={16} />{success}</div>}

    {loading ? <div className="attendance-loading"><LoaderCircle className="spin" size={22} /> Carregando dados do RH...</div> : error && !organizationId ? <div className="panel attendance-empty">{error}</div> : tab === "records" ? <>
      <section className="panel attendance-employee-picker">
        <div className="attendance-section-heading"><div><h2>Colaborador</h2><p>Selecione a pessoa para consultar os dados e registrar o período.</p></div></div>
        <div className="attendance-picker-fields">
          <EmployeeAutocomplete label="Funcionário" employees={employees} value={selectedEmployeeId} placeholder="Digite o nome ou a matrícula" onChange={(employeeId) => {
            const employee = employees.find((item) => item.id === employeeId);
            setSelectedEmployeeId(employeeId);
            setScopeName(employee ? suggestedScopeForEmployee(employee, scopeOptions) : "Geral");
            setSavedRecord(false);
            setSavedSnapshot(null);
          }} />
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
          <article><small>Atrasos / falta de ponto</small><strong>{metrics.late ? `Sim · ${metrics.late}` : "Não"}</strong><span>Ocorrências registradas</span></article>
          <article><small>Faltas justificadas</small><strong>{metrics.justified} · {metrics.justifiedDays} dia(s)</strong><span>Base da regra de redução de 50%</span></article>
          <article><small>Faltas injustificadas</small><strong>{metrics.unjustified} · {metrics.unjustifiedDays} dia(s)</strong><span>Uma ocorrência elimina a parcela</span></article>
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
              <div className="attendance-event-fields">
                <label><span>Ocorrência</span><select value={item.occurrence_type} onChange={(event) => updateOccurrence(item.id, "occurrence_type", event.target.value)}>{occurrenceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>Data</span><input type="date" min={periodStart} max={periodEnd} value={item.occurred_on} onChange={(event) => updateOccurrence(item.id, "occurred_on", event.target.value)} /></label>
                {item.occurrence_type === "late" ? <>
                  <label><span>Horário de início</span><input type="time" value={item.occurred_at} disabled={item.missing_time_record} onChange={(event) => updateOccurrence(item.id, "occurred_at", event.target.value)} /></label>
                  <div className="attendance-event-flags">
                    <label className="attendance-event-flag"><input type="checkbox" checked={item.is_unjustified} onChange={(event) => updateOccurrence(item.id, "is_unjustified", event.target.checked)} /><span>Atraso injustificado</span></label>
                    <label className="attendance-event-flag"><input type="checkbox" checked={item.missing_time_record} onChange={(event) => updateOccurrence(item.id, "missing_time_record", event.target.checked)} /><span>Sem registro de ponto</span></label>
                  </div>
                </> : isMultiDay(item.occurrence_type) ? <>
                  <label><span>Quantidade de dias</span><input type="number" min="1" max="31" step="1" value={item.days_count} onChange={(event) => updateOccurrence(item.id, "days_count", event.target.value)} /></label>
                  {item.occurrence_type === "convocation_absence" && <>
                    <label><span>Antecedência da convocação (horas)</span><input type="number" min="0" max="720" step="1" value={item.convocation_notice_hours} onChange={(event) => updateOccurrence(item.id, "convocation_notice_hours", event.target.value)} /></label>
                    <div className="attendance-event-flags"><label className="attendance-event-flag"><input type="checkbox" checked={item.is_unjustified} onChange={(event) => updateOccurrence(item.id, "is_unjustified", event.target.checked)} /><span>Ausência injustificada</span></label></div>
                  </>}
                </> : <div className="attendance-event-kind"><Clock3 size={15} /><span>{eventLabels[item.occurrence_type]}</span></div>}
              </div>
              <button type="button" className="attendance-remove-event" aria-label={`Remover ${eventLabels[item.occurrence_type]}`} onClick={() => { setSavedRecord(false); setOccurrences((current) => current.filter((event) => event.id !== item.id)); }}><X size={17} /></button>
            </div>)}
          </div>}
          <div className="attendance-value-summary"><ShieldCheck size={18} /><div><strong>Prévia estimada da assiduidade</strong><div className="attendance-estimate-grid"><div><small>Valor fixo da função</small><strong>{displayMoney(attendanceBaseAmount)}</strong></div><div><small>Redução estimada</small><strong>{displayMoney(reductionAmount)}</strong></div><div className="is-final"><small>Estimativa após critérios</small><strong>{displayMoney(estimatedAttendanceAmount)}</strong></div></div><small className="attendance-estimate-breakdown">Individual: {displayMoney(reductionBreakdown.individual)} · Coletivo: {displayMoney(reductionBreakdown.collective)}{attendanceBaseAmount > 0 && reductionBreakdown.individual + reductionBreakdown.collective > attendanceBaseAmount ? " · limitado ao valor mensal" : ""}</small><span>{savedRecord ? "Prévia recalculada pelas regras oficiais com os dados registrados. Salve para atualizar o valor gravado no período." : "Prévia para conferência do RH; não é cálculo de folha nem autoriza desconto automático."}</span></div></div>
          {!attendanceEligible && <div className="attendance-rule-warning">{selectedRule ? `A regra “${selectedRule.scope_name} · ${selectedRule.function_name}” está aguardando confirmação do RH ou não habilita o benefício; a base considerada é R$ 0,00.` : "Não há regra ativa para esta combinação de centro/unidade e função. Cadastre ou confirme em “Funções e valores”; a base considerada é R$ 0,00."}</div>}
          <div className="attendance-form-actions"><span>{savedRecord ? "Registro já salvo neste período; salvar novamente substitui suas ocorrências." : "O registro será salvo com a data e o horário do sistema no histórico de auditoria."}</span><button type="button" className="primary-button" onClick={() => void saveRecord()} disabled={periodLoading || savingRecord || !validPeriod}><Save size={15} />{savingRecord ? "Salvando..." : savedRecord ? "Salvar alterações" : "Salvar registro"}</button></div>
        </section>
        <section className="panel attendance-collective">
          <div className="attendance-section-heading"><div><h2>Requisitos coletivos</h2><p>Registre aqui os critérios aplicáveis individualmente a {selectedEmployee.full_name}. O lançamento fica vinculado somente a este colaborador e período.</p></div></div>
          <div className="attendance-collective-grid">
            <label><span>Ocorrências de qualidade</span><input type="number" min="0" max="100000" step="1" value={collective.quality_occurrence_count} onChange={(event) => { setSavedRecord(false); setCollective((current) => ({ ...current, quality_occurrence_count: event.target.value })); }} /><small>Notificações do cliente com responsabilidade apurada.</small></label>
            <label><span>Cancelamentos / atrasos sem aviso</span><input type="number" min="0" max="100000" step="1" value={collective.service_cancellation_occurrence_count} onChange={(event) => { setSavedRecord(false); setCollective((current) => ({ ...current, service_cancellation_occurrence_count: event.target.value })); }} /><small>Serviços programados não comunicados previamente.</small></label>
            <label><span>Segurança</span><select value={collective.safety_status} onChange={(event) => { setSavedRecord(false); setCollective((current) => ({ ...current, safety_status: event.target.value as Collective["safety_status"] })); }}>{collectiveOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select><small>Marque “Não atende” somente após apuração de responsabilidade direta.</small></label>
          </div>
          <div className="attendance-form-actions"><span>Qualidade: 10% por ocorrência até 3; acima de 3, zera. Cancelamento/atraso sem aviso: 20% até 2; acima de 2, zera. Segurança apurada: zera. Salve junto ao registro individual.</span></div>
        </section>
      </>}
    </> : tab === "functions" ? <section className="panel attendance-function-panel">
      <div className="attendance-section-heading"><div><h2>Elegibilidade e valor por função</h2><p>As funções são sugeridas pelos cadastros de funcionários. Valores são apenas referências configuradas, sem lançamento automático em folha.</p></div></div>
      <form className="attendance-add-function" onSubmit={(event) => { event.preventDefault(); void addFunctionRule(); }}>
        <label><span>Centro / unidade</span><input value={newScopeName} onChange={(event) => setNewScopeName(event.target.value)} maxLength={150} placeholder="Ex.: C&M - Dourados" /></label>
        <label><span>Função / grupo</span><input value={newFunctionName} onChange={(event) => setNewFunctionName(event.target.value)} maxLength={150} placeholder="Ex.: ELETRICISTA" /></label>
        <button type="submit" className="primary-button" disabled={addingFunction || !newFunctionName.trim() || !newScopeName.trim()}><Plus size={15} />{addingFunction ? "Adicionando..." : "Adicionar regra"}</button>
      </form>
      <div className="attendance-proposal-warning" role="note"><strong>Valores importados como propostas — ainda não aprovados pelo RH</strong><span>Os valores da planilha de setembro/2026 começam inativos e não entram na estimativa até a regra ser ativada e “Recebe assiduidade” ser confirmado. Em Dourados, há um valor divergente para ELETRICISTA (23 registros indicam R$ 210,00 e 1 indica R$ 472,50).</span></div>
      <p className="attendance-reduction-note">Em “Geral”, os níveis e classificações da mesma função ficam consolidados em uma única regra. As configurações por centro/unidade continuam separadas, e o cargo oficial cadastrado para cada colaborador não é alterado.</p>
      {functionRuleViews.length === 0 ? <div className="attendance-empty"><strong>Nenhuma regra configurada</strong><span>Adicione uma combinação de centro/unidade e função ou confirme se a migração do banco já foi aplicada.</span></div> : <div className="attendance-scope-groups">
        {Array.from(new Set(functionRuleViews.map((rule) => rule.scope_name))).sort((a, b) => a.localeCompare(b, "pt-BR")).map((scope, index) => {
          const scopedRules = functionRuleViews.filter((rule) => rule.scope_name === scope);
          const pending = scopedRules.filter((rule) => !rule.active || !rule.receives_attendance).length;
          return <details className="attendance-scope-group" key={scope} open={index === 0 || ruleKey(scope) !== "geral"}>
            <summary><strong>{scope}</strong><span>{scopedRules.length} funções padronizadas · {pending} aguardando confirmação</span></summary>
            <div className="attendance-rules-list">
              {scopedRules.map((rule) => <article className="attendance-rule-row" key={rule.id}>
                <div className="attendance-rule-name"><strong>{rule.displayName}</strong><small className="attendance-rule-scope">{rule.hasConfigurationConflict ? "Classificações com valores diferentes; ao salvar, todos os níveis serão padronizados." : rule.source_note || (!rule.active || !rule.receives_attendance ? "Aguardando confirmação do RH" : "Regra configurada")}</small>{rule.memberIds.length > 1 && <small className="attendance-rule-scope">{rule.memberIds.length} cargos/níveis agrupados</small>}</div>
                <label className="attendance-toggle"><input type="checkbox" checked={rule.active} onChange={(event) => updateRule(rule.memberIds, "active", event.target.checked)} /><span>Regra ativa</span></label>
                <label className="attendance-toggle"><input type="checkbox" checked={rule.receives_attendance} onChange={(event) => updateRule(rule.memberIds, "receives_attendance", event.target.checked)} /><span>Recebe assiduidade</span></label>
                <label className="attendance-amount"><span>Valor mensal proposto</span><div><span>R$</span><input inputMode="decimal" aria-label={`Valor mensal para ${scope} · ${rule.displayName}`} value={amountDrafts[rule.id] ?? toInputMoney(rule.monthly_amount)} onChange={(event) => setAmountDrafts((current) => ({ ...current, [rule.id]: event.target.value }))} /></div></label>
                <button type="button" className="secondary-button" onClick={() => void saveFunctionRule(rule)} disabled={savingRuleId === rule.id}><Save size={14} />{savingRuleId === rule.id ? "Salvando..." : "Salvar"}</button>
              </article>)}
            </div>
          </details>;
        })}
      </div>}
      <section className="attendance-official-rules" aria-labelledby="attendance-official-rules-title">
        <div className="attendance-section-heading"><div><h2 id="attendance-official-rules-title">Regras oficiais de desconto da assiduidade</h2><p>Resumo para consulta do RH — período de apuração configurado no topo da página.</p></div><span className="attendance-rules-badge">Documento oficial</span></div>
        <div className="attendance-official-rule-grid">
          <article><h3>Requisitos individuais</h3><ul>
            <li><strong>Falta injustificada:</strong> 1 ocorrência elimina 100% da parcela.</li>
            <li><strong>Ausência justificada:</strong> até 1 dia não reduz; mais de 1 dia no período reduz 50%.</li>
            <li><strong>Convocação:</strong> falta injustificada após convocação com pelo menos 24 horas de antecedência elimina 100%.</li>
            <li><strong>Jornada e ponto:</strong> atraso injustificado no início da jornada ou falta de registro de ponto elimina 100%.</li>
          </ul></article>
          <article><h3>Requisitos coletivos</h3><ul>
            <li><strong>Qualidade:</strong> 10% por notificação apurada, até 3 ocorrências (30%); acima de 3, elimina 100%.</li>
            <li><strong>Cancelamento ou atraso sem aviso:</strong> 20% por ocorrência, até 2 (40%); acima de 2, elimina 100%.</li>
            <li><strong>Segurança:</strong> responsabilidade direta apurada elimina 100% da parcela da equipe responsável. Nesta etapa, o lançamento é feito no registro individual de cada colaborador afetado.</li>
          </ul></article>
        </div>
        <p className="attendance-official-rules-note">Advertência não consta como fator de redução no trecho do documento oficial recebido. A prévia é informativa para conferência do RH, limitada ao valor mensal da parcela; não calcula a folha nem autoriza desconto automático.</p>
      </section>
    </section> : <section className="attendance-summary-panel" role="tabpanel" aria-label="Prévia de valores da assiduidade">
      <div className="attendance-section-heading"><div><h2>Prévia de valores do período</h2><p>Projeção de {displayDate(periodStart)} a {displayDate(periodEnd)} para colaboradores ativos com função elegível.</p></div><button type="button" className="secondary-button" onClick={() => setPeriodSummaryRefresh((current) => current + 1)} disabled={periodSummaryLoading || !validPeriod}><Clock3 size={15} /> Atualizar</button></div>
      <div className="attendance-summary-cards" aria-label="Totais estimados">
        <article><small>Valor cheio sem descontos</small><strong>{displayMoney(periodSummary.fullAmount)}</strong><span>Parcela dos ativos com valor definido</span></article>
        <article><small>Reduções aplicadas</small><strong>{displayMoney(periodSummary.reductionAmount)}</strong><span>{periodSummary.recordsWithReduction} colaborador(es) com redução</span></article>
        <article className="is-payable"><small>Estimativa após reduções</small><strong>{displayMoney(periodSummary.estimatedAmount)}</strong><span>Pendentes considerados sem redução registrada</span></article>
        <article><small>Ativos elegíveis</small><strong>{periodSummary.beneficiaries}</strong><span>Funções autorizadas para assiduidade</span></article>
      </div>
      <div className="attendance-summary-highlights">
        <span><strong>{periodSummary.pendingEmployees.length}</strong> sem lançamento no período</span>
        <span><strong>{periodSummary.recordsWithReduction}</strong> com redução registrada</span>
        <span><strong>{periodSummary.unresolvedScopes.length}</strong> com centro/valor a confirmar</span>
      </div>
      <div className="attendance-summary-note" role="note"><ShieldCheck size={17} /><span>Prévia para conferência do RH, não cálculo oficial de folha. O valor cheio soma todos os ativos com função habilitada, mesmo sem lançamento de ocorrência. Reduções são consideradas apenas quando registradas; quem está sem lançamento entra sem redução. Colaboradores sem valor inequívoco por centro/unidade ficam fora dos totais até a regra ser definida.</span></div>
      {periodSummaryError ? <div className="attendance-summary-error" role="alert"><span>{periodSummaryError}</span><button type="button" className="secondary-button" onClick={() => setPeriodSummaryRefresh((current) => current + 1)}>Tentar novamente</button></div> : <>
        {periodSummary.pendingEmployees.length > 0 && <details className="attendance-pending-employees"><summary>{periodSummary.pendingEmployees.length} ativo(s) elegível(is) sem lançamento — incluídos sem redução</summary><p>{periodSummary.pendingEmployees.map((employee) => `${employee.registration ? `${employee.registration} · ` : ""}${employee.full_name}`).join("; ")}</p></details>}
        {periodSummary.withoutEnabledRule.length > 0 && <details className="attendance-pending-employees attendance-unconfigured-employees"><summary>{periodSummary.withoutEnabledRule.length} ativo(s) nas funções selecionadas sem regra habilitada — fora dos totais</summary><p>{periodSummary.withoutEnabledRule.map((employee) => `${employee.registration ? `${employee.registration} · ` : ""}${employee.full_name} (${employeeFunction(employee)})`).join("; ")}</p></details>}
        <div className="attendance-summary-table-heading"><div><h3>Colaboradores ativos elegíveis</h3><p>{periodSummary.rows.length} funcionário(s) com regra de assiduidade habilitada</p></div><label className="attendance-summary-search"><Search size={16} aria-hidden="true" /><input value={periodSummarySearch} onChange={(event) => setPeriodSummarySearch(event.target.value)} placeholder="Buscar nome, matrícula ou função" aria-label="Buscar colaboradores elegíveis" /></label></div>
        {periodSummaryLoading ? <div className="attendance-inline-loading"><LoaderCircle className="spin" size={18} /> Atualizando valores do período...</div> : filteredPeriodSummaryRows.length === 0 ? <div className="attendance-summary-empty">{periodSummary.rows.length === 0 ? "Não há funcionários ativos com função e regra de assiduidade habilitadas." : "Nenhum colaborador corresponde à busca."}</div> : <div className="attendance-summary-table-wrap"><table className="attendance-summary-table"><thead><tr><th>Colaborador</th><th>Função / centro</th><th>Valor cheio</th><th>Redução</th><th>Estimativa após redução</th><th>Situação</th></tr></thead><tbody>
          {filteredPeriodSummaryRows.map((row) => <tr key={row.id}>
            <td><strong>{row.employee?.full_name ?? "Colaborador não disponível"}</strong><small>{row.employee?.registration ? `Matrícula ${row.employee.registration}` : "Matrícula não informada"}</small></td>
            <td><strong>{row.function_name_snapshot}</strong><small>{row.scope_name_snapshot}</small><small>{row.reductionCriteria}</small></td>
            <td>{row.fullAmount === null ? "A definir" : displayMoney(row.fullAmount)}</td>
            <td>{row.fullAmount === null ? "—" : displayMoney(row.reductionAmount)}</td>
            <td className="attendance-summary-net">{row.estimatedAmount === null ? "A definir" : displayMoney(row.estimatedAmount)}</td>
            <td><span className={`attendance-summary-status ${row.scopeAmbiguous ? "is-unresolved" : !row.registered ? "is-pending" : row.reductionAmount > 0 ? "has-reduction" : "is-clear"}`}>{row.scopeAmbiguous ? "Centro pendente" : !row.registered ? "Sem lançamento" : row.reductionAmount > 0 ? "Com redução" : "Sem redução"}</span></td>
          </tr>)}
        </tbody></table></div>}
      </>}
    </section>}
  </main>;
}
