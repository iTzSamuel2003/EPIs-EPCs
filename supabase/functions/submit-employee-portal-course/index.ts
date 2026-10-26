import "@supabase/functions-js/edge-runtime.d.ts";
import {
  createEmployeePortalAdmin,
  createEmployeePortalIpAdmin,
  enforceEmployeePortalIpRateLimit,
} from "../_shared/employee-portal-security.ts";

const allowedOrigins = new Set(["https://epis-epcs.vercel.app", "http://localhost:3000"]);
const bucket = "employee-course-documents";
const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "https://epis-epcs.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
}

function startsWithBytes(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

async function hasValidFileSignature(file: File, mimeType: string) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (mimeType === "application/pdf") return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (mimeType === "image/jpeg") return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/png") return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/webp") return startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origem nao autorizada" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return response({ error: "Metodo nao permitido" }, 405, origin);
  if (!supabaseUrl || !serviceKey) return response({ error: "Configuracao do servidor indisponivel" }, 500, origin);

  try {
    const ipAdmin = await createEmployeePortalIpAdmin(req, origin, supabaseUrl, serviceKey);
    await enforceEmployeePortalIpRateLimit(ipAdmin);
  } catch (error) {
    if (error instanceof Error && error.message === "PORTAL_RATE_LIMIT_EXCEEDED") return response({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);
    console.error("employee course IP limiter unavailable");
    return response({ error: "Servico temporariamente indisponivel. Tente novamente." }, 503, origin);
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > maxFileSize + 1024 * 1024) return response({ error: "Arquivo excede o limite de 10 MB" }, 413, origin);

  let form: FormData;
  try { form = await req.formData(); } catch { return response({ error: "Formulario multipart invalido" }, 400, origin); }
  const registration = text(form.get("registration"));
  const cpf = text(form.get("cpf"));
  const name = text(form.get("name"));
  const provider = text(form.get("provider"));
  const completedAt = text(form.get("completed_at"));
  const expiresAt = text(form.get("expires_at"));
  const certificateNumber = text(form.get("certificate_number"));
  const attachmentValue = form.get("attachment");
  const attachment = attachmentValue instanceof File && attachmentValue.size > 0 ? attachmentValue : null;
  if (!registration || !cpf || !name) return response({ error: "Informe matrícula, CPF e curso" }, 400, origin);
  if (name.length > 200 || provider.length > 200 || certificateNumber.length > 100) return response({ error: "Dados do curso excedem o tamanho permitido" }, 400, origin);
  if (Boolean(completedAt) !== Boolean(expiresAt)) return response({ error: "Informe as duas datas do curso" }, 400, origin);
  let admin: Awaited<ReturnType<typeof createEmployeePortalAdmin>>;
  try {
    admin = await createEmployeePortalAdmin(req, origin, registration, cpf, supabaseUrl, serviceKey);
  } catch (error) {
    if (error instanceof Error && error.message === "EMPLOYEE_PORTAL_IP_UNAVAILABLE") {
      return response({ error: "Nao foi possivel validar a origem. Tente novamente." }, 503, origin);
    }
    if (error instanceof Error && error.message === "EMPLOYEE_PORTAL_CREDENTIALS_INVALID") {
      return response({ error: "Matricula ou CPF invalidos" }, 400, origin);
    }
    return response({ error: "Nao foi possivel validar o acesso." }, 500, origin);
  }

  if (attachment) {
    const extension = allowedTypes.get(attachment.type) ?? "";
    const filenameExtension = attachment.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    const validJpegExtension = extension === ".jpg" && (filenameExtension === ".jpg" || filenameExtension === ".jpeg");
    if (!extension || (!validJpegExtension && filenameExtension !== extension) || attachment.size > maxFileSize || !(await hasValidFileSignature(attachment, attachment.type))) {
      return response({ error: "Anexo invalido: use PDF, JPG, JPEG, PNG ou WEBP de ate 10 MB" }, 400, origin);
    }
  }

  const { data: profiles, error: profileError } = await admin.rpc("get_employee_portal_data_v3", { p_registration: registration, p_cpf: cpf });
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (profileError) {
    if (/muitas tentativas|portal_rate_limit_exceeded/i.test(profileError.message)) return response({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);
    return response({ error: "Matricula ou CPF nao conferem" }, 400, origin);
  }
  if (!profile) return response({ error: "Matricula ou CPF nao conferem" }, 400, origin);
  const requirements = (Array.isArray(profile.requirements) ? profile.requirements : []) as Array<{ course_name?: string }>;
  if (!requirements.some((item) => item?.course_name === name)) return response({ error: "Curso nao previsto para a funcao do colaborador" }, 400, origin);
  const { data: employee, error: employeeError } = await admin.from("employees").select("organization_id").eq("id", profile.employee_id).single();
  if (employeeError || !employee?.organization_id) return response({ error: "Nao foi possivel identificar a organizacao do colaborador" }, 500, origin);

  let path: string | null = null;
  if (attachment) {
    path = `${employee.organization_id}/portal/${crypto.randomUUID()}-${safeFileName(attachment.name)}`;
    const { error: uploadError } = await admin.storage.from(bucket).upload(path, attachment, { contentType: attachment.type, upsert: false });
    if (uploadError) return response({ error: "Nao foi possivel salvar o comprovante" }, 500, origin);
  }

  const { data: courseId, error: courseError } = await admin.rpc("submit_employee_portal_course", {
    p_registration: registration,
    p_cpf: cpf,
    p_name: name,
    p_provider: provider,
    p_completed_at: completedAt || null,
    p_expires_at: expiresAt || null,
    p_certificate_number: certificateNumber,
    p_certificate_file_path: path,
  });
  if (courseError || !courseId) {
    if (path) await admin.storage.from(bucket).remove([path]);
    if (courseError && /muitas tentativas|portal_rate_limit_exceeded/i.test(courseError.message)) return response({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);
    return response({ error: "Nao foi possivel registrar o curso" }, 400, origin);
  }
  return response({ id: courseId, has_attachment: Boolean(path) }, 200, origin);
});
