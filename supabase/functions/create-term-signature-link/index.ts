import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const productionOrigin = "https://epis-epcs.vercel.app";
const allowedOrigins = new Set([productionOrigin, "http://localhost:3000", "http://127.0.0.1:3000"]);
const maxLinksPerHour = 12;
const attempts = new Map<string, { count: number; resetAt: number }>();

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : productionOrigin;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function respond(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function object(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return object(value[0]);
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function allowedToManage(role: string, pagePaths: unknown, page: string) {
  if (role === "admin") return true;
  if (Array.isArray(pagePaths)) return pagePaths.includes(page);
  const defaults: Record<string, string[]> = {
    rh: ["/employees", "/deliveries", "/returns", "/requests", "/stock", "/validities", "/reports"],
    tst: ["/entries", "/deliveries", "/returns", "/stock", "/validities", "/tests", "/ca", "/reports"],
    user: [],
  };
  return (defaults[role] ?? []).includes(page);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function allowAttempt(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  if (current.count >= maxLinksPerHour) return false;
  current.count += 1;
  return true;
}

function mapDeliveryItem(value: unknown) {
  const item = object(value);
  const material = object(item.material);
  const variant = object(item.variant);
  const units = Array.isArray(item.material_units) ? item.material_units.map((value) => {
    const unit = object(value);
    return {
      identifier: text(unit.unit_identifier),
      valid_until: text(unit.valid_until) || null,
      test_performed_at: text(unit.test_performed_at) || null,
      test_expires_at: text(unit.test_expires_at) || null,
      test_number: text(unit.test_number) || null,
      test_report_number: text(unit.test_report_number) || null,
      ca_number: text(unit.ca_number) || null,
      ca_expires_at: text(unit.ca_expires_at) || null,
    };
  }) : [];
  return {
    material: text(material.name) || "Material",
    code: text(material.internal_code) || null,
    unit: text(material.unit) || "un.",
    quantity: Number(item.quantity) || 0,
    size: text(variant.size) || text(variant.name) || null,
    expected_replacement_at: text(item.expected_replacement_at) || null,
    ca_number: text(material.ca_number) || null,
    ca_expires_at: text(material.ca_expires_at) || null,
    units,
  };
}

function mapReturnItem(value: unknown) {
  const item = object(value);
  const material = object(item.material);
  const deliveryItem = object(item.delivery_item);
  const variant = object(deliveryItem.variant);
  return {
    material: text(material.name) || "Material",
    unit: text(material.unit) || "un.",
    quantity: Number(item.quantity) || 0,
    size: text(variant.size) || text(variant.name) || null,
    condition: text(item.equipment_condition) || null,
    destination: text(item.destination) || null,
    incident_type: text(item.incident_type) || "normal",
    incident_description: text(item.incident_description) || null,
    deduction_requested: item.deduction_requested === true,
    deduction_amount: item.deduction_amount === null || item.deduction_amount === undefined ? null : Number(item.deduction_amount),
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
const publishableKey = (publishableKeys ? JSON.parse(publishableKeys).default : "") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const serviceKey = (secretKeys ? JSON.parse(secretKeys).default : "") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origem não autorizada." }, 403, origin);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return respond({ error: "Método não permitido." }, 405, origin);
  if (!supabaseUrl || !publishableKey || !serviceKey) return respond({ error: "Configuração do serviço indisponível." }, 500, origin);

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken || accessToken.length > 4096) return respond({ error: "Entre novamente para gerar o link." }, 401, origin);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
  const user = authData.user;
  if (authError || !user) return respond({ error: "Sua sessão expirou. Entre novamente." }, 401, origin);
  if (!allowAttempt(user.id)) return respond({ error: "Muitos links foram gerados. Tente novamente mais tarde." }, 429, origin);

  let body: Record<string, unknown>;
  try { body = object(await request.json()); } catch { return respond({ error: "Solicitação inválida." }, 400, origin); }
  const recordType = text(body.record_type);
  const recordId = text(body.record_id);
  if (!(recordType === "delivery" || recordType === "return") || !isUuid(recordId)) return respond({ error: "Ficha inválida." }, 400, origin);

  const { data: profile, error: profileError } = await userClient.from("profiles").select("organization_id,role,full_name").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.organization_id) return respond({ error: "Não foi possível identificar a organização." }, 403, origin);
  const requiredPage = recordType === "delivery" ? "/deliveries" : "/returns";
  let pagePaths: unknown = null;
  if (profile.role !== "admin") {
    const [{ data: override, error: overrideError }, { data: roleAccess, error: roleError }] = await Promise.all([
      userClient.from("profile_access_overrides").select("page_paths").eq("profile_id", user.id).eq("organization_id", profile.organization_id).maybeSingle(),
      userClient.from("organization_role_access").select("page_paths").eq("organization_id", profile.organization_id).eq("role", profile.role).maybeSingle(),
    ]);
    if (overrideError || roleError) return respond({ error: "Não foi possível validar suas permissões." }, 403, origin);
    pagePaths = override?.page_paths ?? roleAccess?.page_paths ?? null;
  }
  if (!allowedToManage(String(profile.role ?? "user"), pagePaths, requiredPage)) return respond({ error: "Seu perfil não tem acesso a esta ficha." }, 403, origin);

  const table = recordType === "delivery" ? "deliveries" : "returns";
  const select = recordType === "delivery"
    ? "id,organization_id,employee_id,delivered_at,reason,notes,term_signed_at,employee:employees(full_name,registration,phone),delivery_items(quantity,expected_replacement_at,material:materials(name,unit,internal_code,ca_number,ca_expires_at),variant:material_variants(name,size),material_units(unit_identifier,valid_until,test_performed_at,test_expires_at,test_number,test_report_number,ca_number,ca_expires_at))"
    : "id,organization_id,employee_id,returned_at,reason,notes,term_signed_at,employee:employees(full_name,registration,phone),return_items(quantity,equipment_condition,destination,incident_type,incident_description,deduction_requested,deduction_amount,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size)))";
  const { data: transaction, error: transactionError } = await userClient.from(table).select(select).eq("id", recordId).maybeSingle();
  if (transactionError || !transaction || transaction.organization_id !== profile.organization_id) return respond({ error: "A ficha não foi encontrada nesta organização." }, 404, origin);
  const transactionRecord = transaction as unknown as Record<string, unknown>;
  if (transactionRecord.term_signed_at) return respond({ error: "Esta ficha já está assinada." }, 409, origin);

  const employee = object(transactionRecord.employee);
  const employeeId = text(transactionRecord.employee_id);
  const { data: organization, error: organizationError } = await userClient.from("organizations").select("name").eq("id", profile.organization_id).maybeSingle();
  if (organizationError) return respond({ error: "Não foi possível carregar a organização." }, 500, origin);
  const rawItems = recordType === "delivery" ? transactionRecord.delivery_items : transactionRecord.return_items;
  const items = Array.isArray(rawItems)
    ? rawItems.map((value) => recordType === "delivery" ? mapDeliveryItem(value) : mapReturnItem(value))
    : [];
  const snapshot = {
    version: 1,
    type: recordType,
    organization_name: text(organization?.name) || "Organização",
    responsible_name: text(profile.full_name) || "Responsável pelo controle",
    employee_name: text(employee.full_name) || "Colaborador",
    employee_registration: text(employee.registration) || null,
    date: recordType === "delivery" ? text(transactionRecord.delivered_at) : text(transactionRecord.returned_at),
    reason: text(transactionRecord.reason),
    notes: text(transactionRecord.notes) || null,
    items,
  };
  if (!employeeId || !items.length) return respond({ error: "A ficha não possui dados suficientes para assinatura." }, 409, origin);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const token = createToken();
  const tokenHash = await sha256(token);
  const snapshotHash = await sha256(stableJson(snapshot));
  const { data: link, error: insertError } = await admin.from("term_signature_links").insert({
    organization_id: profile.organization_id,
    employee_id: employeeId,
    delivery_id: recordType === "delivery" ? recordId : null,
    return_id: recordType === "return" ? recordId : null,
    created_by: user.id,
    token_hash: tokenHash,
    snapshot,
    snapshot_hash: snapshotHash,
    expires_at: expiresAt,
  }).select("id,expires_at").single();
  if (insertError || !link) return respond({ error: "Não foi possível gerar o link de assinatura." }, 500, origin);

  const revokeQuery = admin.from("term_signature_links").update({ revoked_at: now.toISOString() })
    .eq("organization_id", profile.organization_id).neq("id", link.id).is("used_at", null).is("revoked_at", null);
  const { error: revokeError } = recordType === "delivery"
    ? await revokeQuery.eq("delivery_id", recordId)
    : await revokeQuery.eq("return_id", recordId);
  if (revokeError) {
    await admin.from("term_signature_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id);
    return respond({ error: "Não foi possível preparar o link de assinatura." }, 500, origin);
  }

  const safeOrigin = origin && allowedOrigins.has(origin) ? origin : productionOrigin;
  return respond({
    url: `${safeOrigin}/assinar/${token}`,
    expires_at: link.expires_at,
    employee_name: snapshot.employee_name,
    employee_phone: text(employee.phone) || null,
  }, 200, origin);
});
