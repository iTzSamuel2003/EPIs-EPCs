import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const allowedOrigins = new Set(["https://epis-epcs.vercel.app", "http://localhost:3000"]);
const bucket = "employee-course-documents";
const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const attempts = new Map<string, { count: number; resetAt: number }>();

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

function allowAttempt(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
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
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origem nao autorizada" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return response({ error: "Metodo nao permitido" }, 405, origin);
  if (!supabaseUrl || !serviceKey) return response({ error: "Configuracao do servidor indisponivel" }, 500, origin);

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowAttempt(ip)) return response({ error: "Tente novamente mais tarde" }, 429, origin);
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
  if (!registration || !cpf || !name || !completedAt || !expiresAt || !attachment) return response({ error: "Informe curso, datas e comprovante" }, 400, origin);
  if (name.length > 200 || provider.length > 200 || certificateNumber.length > 100) return response({ error: "Dados do curso excedem o tamanho permitido" }, 400, origin);
  if (!allowAttempt(`${ip}:${registration}:${cpf}`)) return response({ error: "Tente novamente mais tarde" }, 429, origin);

  const extension = allowedTypes.get(attachment.type) ?? "";
  const filenameExtension = attachment.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const validJpegExtension = extension === ".jpg" && (filenameExtension === ".jpg" || filenameExtension === ".jpeg");
  if (!extension || (!validJpegExtension && filenameExtension !== extension) || attachment.size > maxFileSize || !(await hasValidFileSignature(attachment, attachment.type))) {
    return response({ error: "Anexo invalido: use PDF, JPG, JPEG, PNG ou WEBP de ate 10 MB" }, 400, origin);
  }

  const { data: profiles, error: profileError } = await admin.rpc("get_employee_portal_data_v3", { p_registration: registration, p_cpf: cpf });
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (profileError || !profile) return response({ error: "Matricula ou CPF nao conferem" }, 400, origin);
  const requirements = Array.isArray(profile.requirements) ? profile.requirements : [];
  if (!requirements.some((item) => item?.course_name === name)) return response({ error: "Curso nao previsto para a funcao do colaborador" }, 400, origin);

  const path = `portal/${crypto.randomUUID()}-${safeFileName(attachment.name)}`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(path, attachment, { contentType: attachment.type, upsert: false });
  if (uploadError) return response({ error: "Nao foi possivel salvar o comprovante" }, 500, origin);

  const { data: courseId, error: courseError } = await admin.rpc("submit_employee_portal_course", {
    p_registration: registration,
    p_cpf: cpf,
    p_name: name,
    p_provider: provider,
    p_completed_at: completedAt,
    p_expires_at: expiresAt,
    p_certificate_number: certificateNumber,
    p_certificate_file_path: path,
  });
  if (courseError || !courseId) {
    await admin.storage.from(bucket).remove([path]);
    return response({ error: courseError?.message ?? "Nao foi possivel registrar o curso" }, 400, origin);
  }
  return response({ id: courseId, has_attachment: true }, 200, origin);
});
