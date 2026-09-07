import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const bucket = "employee-request-attachments";
const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const attempts = new Map<string, { count: number; resetAt: number }>();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function cleanText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function registerCleanup(requestId: string | null, path: string, error: unknown) {
  await admin.from("employee_request_attachment_cleanup").insert({ request_id: requestId, attachment_path: path, last_error: error instanceof Error ? error.message : String(error) });
}

async function removeAttachment(path: string, requestId: string, originalError: unknown) {
  const { error: removeError } = await admin.storage.from(bucket).remove([path]);
  if (removeError) await registerCleanup(requestId, path, removeError);
  const { error: deleteError } = await admin.from("employee_portal_requests").delete().eq("id", requestId);
  if (deleteError) await registerCleanup(requestId, path, deleteError);
  if (removeError || deleteError) console.error("request cleanup pending", { requestId, path, originalError, removeError, deleteError });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método não permitido" }, 405);
  if (!supabaseUrl || !serviceKey) return response({ error: "Configuração do servidor indisponível" }, 500);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowAttempt(ip)) return response({ error: "Tente novamente mais tarde" }, 429);
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > maxFileSize + 1024 * 1024) return response({ error: "Arquivo excede o limite de 10 MB" }, 413);

  let form: FormData;
  try { form = await req.formData(); } catch { return response({ error: "Formulário multipart inválido" }, 400); }
  const registration = cleanText(form.get("registration"));
  const cpf = cleanText(form.get("cpf"));
  const deliveryItemId = cleanText(form.get("delivery_item_id"));
  const description = cleanText(form.get("description"));
  if (!allowAttempt(`${ip}:${registration}:${cpf}`)) return response({ error: "Tente novamente mais tarde" }, 429);
  if (!registration || !cpf || !isUuid(deliveryItemId) || !description) return response({ error: "Informe funcionário, material e descrição" }, 400);
  if (description.length > 4000) return response({ error: "Descrição muito longa" }, 400);

  const attachmentValue = form.get("attachment");
  const attachment = attachmentValue instanceof File && attachmentValue.size > 0 ? attachmentValue : null;
  let extension = "";
  if (attachment) {
    extension = allowedTypes.get(attachment.type) ?? "";
    const filenameExtension = attachment.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    if (!extension || filenameExtension !== extension || attachment.size > maxFileSize) return response({ error: "Anexo inválido: use PDF, JPG, PNG ou WEBP de até 10 MB" }, 400);
  }

  const { data: requestId, error: requestError } = await admin.rpc("create_employee_material_request", { p_registration: registration, p_cpf: cpf, p_delivery_item_id: deliveryItemId, p_description: description });
  if (requestError || !requestId) {
    console.error("request creation failed", requestError);
    return response({ error: requestError?.message ?? "Não foi possível criar a solicitação" }, 409);
  }
  if (!attachment) return response({ id: requestId });

  const { data: request, error: lookupError } = await admin.from("employee_portal_requests").select("organization_id").eq("id", requestId).single();
  if (lookupError || !request) {
    await removeAttachment("unresolved-request/" + requestId, requestId, lookupError ?? "request lookup failed");
    return response({ error: "Não foi possível finalizar a solicitação" }, 500);
  }
  const path = `${request.organization_id}/${requestId}/attachment${extension}`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(path, attachment, { contentType: attachment.type, upsert: false });
  if (uploadError) {
    await removeAttachment(path, requestId, uploadError);
    return response({ error: "Não foi possível salvar o anexo" }, 500);
  }
  const { error: updateError } = await admin.from("employee_portal_requests").update({ attachment_path: path, attachment_uploaded_at: new Date().toISOString() }).eq("id", requestId);
  if (updateError) {
    await removeAttachment(path, requestId, updateError);
    return response({ error: "Não foi possível finalizar o anexo" }, 500);
  }
  return response({ id: requestId, has_attachment: true });
});
