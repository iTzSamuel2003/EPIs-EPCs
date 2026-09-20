export function friendlyError(error: unknown, fallback = "Não foi possível concluir esta operação.") {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (process.env.NODE_ENV === "development" && message) console.error("[EPIS+]", error);
  if (!message) return fallback;
  if (/permission denied for table audit_logs|audit_logs/i.test(message)) return "O registro de auditoria do banco bloqueou esta operação. Solicite a sincronização das permissões do Supabase e tente novamente.";
  if (/Cannot coerce the result to a single JSON object|JSON object/i.test(message)) return "Não foi possível carregar os dados da organização. Tente novamente.";
  if (/JWT|invalid session|session expired|not authenticated|refresh token|token has expired/i.test(message)) return "Sua sessão não está mais válida. Entre novamente para continuar.";
  if (/permission denied|not authorized|row-level security|new row violates row-level security policy|violates row-level security policy/i.test(message)) return "Seu usuário não tem permissão para esta operação. Solicite acesso de administrador ou confira a organização selecionada.";
  if (/duplicate|unique|23505/i.test(message)) return "Já existe um cadastro com esses dados.";
  if (/network|fetch|failed to fetch|timeout|timed out/i.test(message)) return "Não foi possível conectar ao sistema. Verifique sua internet e tente novamente.";
  return fallback;
}

export function formatDateBR(value: string | null | undefined) {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

export function formatDateTimeBR(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
}

