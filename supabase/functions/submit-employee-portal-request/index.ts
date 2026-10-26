import "@supabase/functions-js/edge-runtime.d.ts";
import {
  createEmployeePortalAdmin,
  createEmployeePortalIpAdmin,
  enforceEmployeePortalIpRateLimit,
} from "../_shared/employee-portal-security.ts";

const allowedOrigins = new Set(["https://epis-epcs.vercel.app", "http://localhost:3000"]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "https://epis-epcs.vercel.app";
  return {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  };
}
const bucket = "employee-request-attachments";
const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

function response(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}

function cleanText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
async function registerCleanup(admin: Awaited<ReturnType<typeof createEmployeePortalAdmin>>, requestId: string | null, path: string, error: unknown) {
  await admin.from("employee_request_attachment_cleanup").insert({ request_id: requestId, attachment_path: path, last_error: error instanceof Error ? error.message : String(error) });
}

async function removeAttachment(admin: Awaited<ReturnType<typeof createEmployeePortalAdmin>>, path: string, requestId: string, originalError: unknown) {
  const { error: removeError } = await admin.storage.from(bucket).remove([path]);
  if (removeError) await registerCleanup(admin, requestId, path, removeError);
  const { error: deleteError } = await admin.from("employee_portal_requests").delete().eq("id", requestId);
  if (deleteError) await registerCleanup(admin, requestId, path, deleteError);
  if (removeError || deleteError) console.error("request cleanup pending", { requestId, path, originalError, removeError, deleteError });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origem não autorizada" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return response({ error: "Método não permitido" }, 405, origin);
  if (!supabaseUrl || !serviceKey) return response({ error: "Configuração do servidor indisponível" }, 500, origin);

  try {
    const ipAdmin = await createEmployeePortalIpAdmin(req, origin, supabaseUrl, serviceKey);
    await enforceEmployeePortalIpRateLimit(ipAdmin);
  } catch (error) {
    if (error instanceof Error && error.message === "PORTAL_RATE_LIMIT_EXCEEDED") return response({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);
    console.error("employee request IP limiter unavailable");
    return response({ error: "Serviço temporariamente indisponível. Tente novamente." }, 503, origin);
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > maxFileSize + 1024 * 1024) return response({ error: "Arquivo excede o limite de 10 MB" }, 413, origin);

  let form: FormData;
  try { form = await req.formData(); } catch { return response({ error: "Formulário multipart inválido" }, 400); }
  const registration = cleanText(form.get("registration"));
  const cpf = cleanText(form.get("cpf"));
  const deliveryItemId = cleanText(form.get("delivery_item_id"));
  const description = cleanText(form.get("description"));
  if (!registration || !cpf || !isUuid(deliveryItemId) || !description) return response({ error: "Informe funcionário, material e descrição" }, 400);
  if (description.length > 4000) return response({ error: "Descrição muito longa" }, 400);

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

  const attachmentValue = form.get("attachment");
  const attachment = attachmentValue instanceof File && attachmentValue.size > 0 ? attachmentValue : null;
  let extension = "";
  if (attachment) {
    extension = allowedTypes.get(attachment.type) ?? "";
    const filenameExtension = attachment.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    const validJpegExtension = extension === ".jpg" && (filenameExtension === ".jpg" || filenameExtension === ".jpeg");
    if (!extension || (!validJpegExtension && filenameExtension !== extension) || attachment.size > maxFileSize || !(await hasValidFileSignature(attachment, attachment.type))) return response({ error: "Anexo inválido: use PDF, JPG, JPEG, PNG ou WEBP de até 10 MB" }, 400);
  }

  const { data: requestId, error: requestError } = await admin.rpc("create_employee_material_request", { p_registration: registration, p_cpf: cpf, p_delivery_item_id: deliveryItemId, p_description: description });
  if (requestError || !requestId) {
    if (requestError && /muitas tentativas|portal_rate_limit_exceeded/i.test(requestError.message)) return response({ error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." }, 429, origin);
    console.error("request creation failed", requestError);
    return response({ error: "Não foi possível criar a solicitação" }, 409, origin);
  }
  if (!attachment) return response({ id: requestId }, 200, origin);

  const { data: request, error: lookupError } = await admin.from("employee_portal_requests").select("organization_id").eq("id", requestId).single();
  if (lookupError || !request) {
    await removeAttachment(admin, "unresolved-request/" + requestId, requestId, lookupError ?? "request lookup failed");
    return response({ error: "Não foi possível finalizar a solicitação" }, 500);
  }
  const path = `${request.organization_id}/${requestId}/attachment${extension}`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(path, attachment, { contentType: attachment.type, upsert: false });
  if (uploadError) {
    await removeAttachment(admin, path, requestId, uploadError);
    return response({ error: "Não foi possível salvar o anexo" }, 500);
  }
  const { data: updatedRequest, error: updateError } = await admin.from("employee_portal_requests").update({ attachment_path: path, attachment_uploaded_at: new Date().toISOString() }).eq("id", requestId).select("id").maybeSingle();
  if (updateError || !updatedRequest) {
    await removeAttachment(admin, path, requestId, updateError);
    return response({ error: "Não foi possível finalizar o anexo" }, 500);
  }
  return response({ id: requestId, has_attachment: true });
});
