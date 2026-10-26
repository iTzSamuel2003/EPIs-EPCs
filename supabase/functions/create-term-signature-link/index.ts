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
    rh: ["/employees", "/deliveries", "/returns", "/discounts", "/requests", "/stock", "/validities", "/reports"],
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
  const lot = object(item.lot);
  const units = Array.isArray(item.material_units) ? item.material_units.map((value) => {
    const unit = object(value);
    return {
      identifier: text(unit.unit_identifier),
      valid_until: text(unit.valid_until) || null,
      test_performed_at: text(unit.test_performed_at) || text(item.test_performed_at) || text(lot.test_performed_at) || null,
      test_expires_at: text(item.test_expires_at) || text(lot.test_expires_at) || text(unit.valid_until) || null,
      test_number: text(unit.test_number) || text(lot.test_number) || null,
      test_report_number: text(unit.test_report_number) || text(lot.test_report_number) || null,
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
    ca_number: text(lot.ca_number) || null,
    ca_expires_at: text(lot.ca_expires_at) || null,
    units,
  };
}

function mapReturnItem(value: unknown) {
  const item = object(value);
  const material = object(item.material);
  const deliveryItem = object(item.delivery_item);
  const variant = object(deliveryItem.variant);
  const lot = object(deliveryItem.lot);
  const delivery = object(deliveryItem.delivery);
  const units = Array.isArray(deliveryItem.units) ? deliveryItem.units.map(object) : [];
  const unitValue = (key: string) => [...new Set(units.map((unit) => text(unit[key])).filter(Boolean))].join(", ") || null;
  return {
    material: text(material.name) || "Material",
    unit: text(material.unit) || "un.",
    quantity: Number(item.quantity) || 0,
    size: text(variant.size) || text(variant.name) || null,
    delivered_at: text(delivery.delivered_at) || null,
    lot_number: text(lot.lot_number) || null,
    ca_number: text(lot.ca_number) || unitValue("ca_number"),
    ca_expires_at: text(lot.ca_expires_at) || unitValue("ca_expires_at"),
    test_number: text(lot.test_number) || unitValue("test_number"),
    test_report_number: text(lot.test_report_number) || unitValue("test_report_number"),
    test_performed_at: text(lot.test_performed_at) || unitValue("test_performed_at"),
    test_expires_at: text(lot.test_expires_at) || unitValue("valid_until"),
    condition: text(item.equipment_condition) || null,
    destination: text(item.destination) || null,
    incident_type: text(item.incident_type) || "normal",
    incident_description: text(item.incident_description) || null,
    deduction_requested: item.deduction_requested === true,
  };
}

async function mapPendingDeliveryItems(pending: Record<string, unknown>, organizationId: string) {
  const requests = Array.isArray(pending.request_items) ? pending.request_items.map(object) : [];
  const plan = Array.isArray(pending.lot_plan) ? pending.lot_plan.map(object) : [];
  const materialIds = [...new Set(requests.map((item) => text(item.material_id)).filter(Boolean))];
  const variantIds = [...new Set(requests.map((item) => text(item.variant_id)).filter(Boolean))];
  const lotIds = [...new Set(plan.map((item) => text(item.lot_id)).filter(Boolean))];
  if (!requests.length || !plan.length || !materialIds.length || !lotIds.length) return [];

  const [materialsResult, variantsResult, lotsResult] = await Promise.all([
    admin.from("materials").select("id,name,internal_code,unit,test_required").eq("organization_id", organizationId).in("id", materialIds),
    variantIds.length ? admin.from("material_variants").select("id,name,size").eq("organization_id", organizationId).in("id", variantIds) : Promise.resolve({ data: [], error: null }),
    admin.from("material_lots").select("id,lot_number,ca_number,ca_expires_at,test_number,test_performed_at,test_expires_at,test_report_number").eq("organization_id", organizationId).in("id", lotIds),
  ]);
  if (materialsResult.error || variantsResult.error || lotsResult.error) throw new Error("Não foi possível carregar os dados dos lotes para a ficha.");
  const materials = new Map((materialsResult.data ?? []).map((item) => [item.id, item]));
  const variants = new Map((variantsResult.data ?? []).map((item) => [item.id, item]));
  const lots = new Map((lotsResult.data ?? []).map((item) => [item.id, item]));
  const caNumbers = [...new Set((lotsResult.data ?? []).map((lot) => text(lot.ca_number)).filter(Boolean))];
  const certificatesResult = caNumbers.length
    ? await admin.from("ca_certificates").select("ca_number,valid_until").in("ca_number", caNumbers)
    : { data: [], error: null };
  if (certificatesResult.error) throw new Error("Não foi possível consultar as validades dos CAs da ficha.");
  const certificates = new Map((certificatesResult.data ?? []).map((certificate) => [certificate.ca_number, certificate.valid_until]));

  return requests.flatMap((request, requestIndex) => plan
    .filter((allocation) => Number(allocation.item_index) === requestIndex + 1)
    .map((allocation) => {
      const material = materials.get(text(allocation.material_id));
      const variant = variants.get(text(request.variant_id));
      const lot = lots.get(text(allocation.lot_id));
      if (!material || !lot || text(allocation.material_id) !== text(request.material_id)) throw new Error("A ficha contém um lote que não está mais disponível. Gere uma nova ficha.");
      const quantity = Number(allocation.quantity) || 0;
      const caExpiresAt = text(lot.ca_number ? certificates.get(lot.ca_number) : null) || text(lot.ca_expires_at) || null;
      const units = material.test_required ? Array.from({ length: quantity }, () => ({
        valid_until: text(lot.test_expires_at) || null,
        test_performed_at: text(lot.test_performed_at) || null,
        test_expires_at: text(lot.test_expires_at) || null,
        test_number: text(lot.test_number) || null,
        test_report_number: text(lot.test_report_number) || null,
        ca_number: text(lot.ca_number) || null,
        ca_expires_at: caExpiresAt,
      })) : [];
      return {
        material: text(material.name) || "Material",
        code: text(material.internal_code) || null,
        unit: text(material.unit) || "un.",
        quantity,
        size: text(variant?.size) || text(variant?.name) || null,
        expected_replacement_at: text(request.expected_replacement_at) || null,
        ca_number: text(lot.ca_number) || null,
        ca_expires_at: caExpiresAt,
        units,
      };
    }));
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
  const action = text(body.action) || "create";
  if (!(recordType === "delivery" || recordType === "pending_delivery" || recordType === "return" || recordType === "deduction" || recordType === "witness") || !isUuid(recordId)) return respond({ error: "Ficha inválida." }, 400, origin);
  if (!(action === "create" || action === "cancel") || (action === "cancel" && recordType !== "return" && recordType !== "deduction") || (recordType === "witness" && action !== "create")) return respond({ error: "Ação de link inválida." }, 400, origin);

  const table = recordType === "witness" ? "return_deduction_refusal_witnesses" : recordType === "pending_delivery" ? "pending_deliveries" : recordType === "delivery" ? "deliveries" : recordType === "deduction" ? "return_deduction_cases" : "returns";
  const select = action === "cancel"
    ? recordType === "deduction" ? "id,organization_id,employee_id,status,signed_at" : "id,organization_id,term_signed_at"
    : recordType === "witness"
      ? "id,organization_id,employee_id,refusal_record_id,employee_name_snapshot,employee_registration_snapshot,employee_job_title_snapshot,signed_at"
    : recordType === "pending_delivery"
      ? "id,organization_id,employee_id,delivered_at,reason,notes,request_items,lot_plan,status,snapshot,employee:employees(full_name,registration,job_title,function_name,department,admission_date,termination_date,status)"
      : recordType === "delivery"
        ? "id,organization_id,employee_id,delivered_at,reason,notes,term_signed_at,employee:employees(full_name,registration,job_title,function_name,department,admission_date,termination_date,status),delivery_items(quantity,test_performed_at,test_expires_at,expected_replacement_at,material:materials(name,unit,internal_code),lot:material_lots(ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),variant:material_variants(name,size),material_units(unit_identifier,valid_until,test_performed_at,test_number,test_report_number,ca_number,ca_expires_at))"
      : recordType === "deduction"
        ? "id,organization_id,return_id,employee_id,approved_amount,status,review_notes,employee:employees(full_name,registration,job_title,function_name,department,admission_date,termination_date,status),return:returns(returned_at,reason,return_items(id,quantity,deduction_requested,equipment_condition,destination,incident_type,incident_description,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size),delivery:deliveries(delivered_at),lot:material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),units:material_units(unit_identifier,valid_until,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at))))"
        : "id,organization_id,employee_id,returned_at,reason,notes,term_signed_at,employee:employees(full_name,registration,job_title,function_name,department,admission_date,termination_date,status),return_items(quantity,equipment_condition,destination,incident_type,incident_description,deduction_requested,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size),delivery:deliveries(delivered_at),lot:material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),units:material_units(unit_identifier,valid_until,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at)))";
  const profileQuery = action === "cancel"
    ? userClient.from("profiles").select("organization_id,role,full_name").eq("id", user.id).maybeSingle()
    : userClient.from("profiles").select("organization_id,role,full_name,organization:organizations(name,logo_url,cnpj,address,phone)").eq("id", user.id).maybeSingle();
  const { data: profile, error: profileError } = await profileQuery;
  if (profileError || !profile?.organization_id) return respond({ error: "Não foi possível identificar a organização." }, 403, origin);
  const requiredPage = recordType === "return" ? "/returns" : recordType === "deduction" || recordType === "witness" ? "/discounts" : "/deliveries";
  let pagePaths: unknown = null;
  const transactionQuery = userClient.from(table).select(select).eq("id", recordId).maybeSingle();
  let transactionResponse: Awaited<typeof transactionQuery>;
  if (profile.role !== "admin") {
    const [transactionResult, { data: override, error: overrideError }, { data: roleAccess, error: roleError }] = await Promise.all([
      transactionQuery,
      userClient.from("profile_access_overrides").select("page_paths").eq("profile_id", user.id).eq("organization_id", profile.organization_id).maybeSingle(),
      userClient.from("organization_role_access").select("page_paths").eq("organization_id", profile.organization_id).eq("role", profile.role).maybeSingle(),
    ]);
    transactionResponse = transactionResult;
    if (overrideError || roleError) return respond({ error: "Não foi possível validar suas permissões." }, 403, origin);
    pagePaths = override?.page_paths ?? roleAccess?.page_paths ?? null;
  } else transactionResponse = await transactionQuery;
  if (!allowedToManage(String(profile.role ?? "user"), pagePaths, requiredPage)) return respond({ error: "Seu perfil não tem acesso a esta ficha." }, 403, origin);

  const { data: transaction, error: transactionError } = transactionResponse;
  if (transactionError || !transaction) return respond({ error: "A ficha não foi encontrada nesta organização." }, 404, origin);
  const transactionRecord = transaction as unknown as Record<string, unknown>;
  if (transactionRecord.organization_id !== profile.organization_id) return respond({ error: "A ficha não foi encontrada nesta organização." }, 404, origin);
  let employeePhone: string | null = null;
  if (recordType !== "witness"
    && (profile.role === "admin" || profile.role === "rh")
    && allowedToManage(String(profile.role), pagePaths, "/employees")) {
    const employeeId = text(transactionRecord.employee_id);
    if (employeeId) {
      const { data: employeeContact } = await admin.from("employees")
        .select("phone")
        .eq("id", employeeId)
        .eq("organization_id", profile.organization_id)
        .maybeSingle();
      employeePhone = text(employeeContact?.phone) || null;
    }
  }
  if (recordType === "witness") {
    if (transactionRecord.signed_at) return respond({ error: "Esta testemunha já concluiu a assinatura." }, 409, origin);
    const organization = object("organization" in profile ? profile.organization : null);
    const { data: eventRecord, error: eventError } = await admin.from("return_deduction_refusal_records")
      .select("id,organization_id,deduction_case_id,outcome,presentation_channel,recorded_at,recorded_by_name,case_snapshot,presented_term_snapshot")
      .eq("id", transactionRecord.refusal_record_id).eq("organization_id", profile.organization_id).maybeSingle();
    if (eventError || !eventRecord) return respond({ error: "O registro da ocorrência não foi encontrado." }, 404, origin);
    const { data: employee, error: employeeError } = await admin.from("employees")
      .select("id,organization_id,full_name,registration,cpf,job_title,function_name,department,admission_date,termination_date,status")
      .eq("id", transactionRecord.employee_id).eq("organization_id", profile.organization_id).maybeSingle();
    if (employeeError || !employee || !text(employee.cpf)) return respond({ error: "A testemunha precisa ter CPF cadastrado para receber o link." }, 409, origin);
    const caseSnapshot = object(eventRecord.case_snapshot);
    const witnessName = text(transactionRecord.employee_name_snapshot) || text(employee.full_name) || "Testemunha";
    const witnessRegistration = text(transactionRecord.employee_registration_snapshot) || text(employee.registration) || null;
    const snapshot = {
      version: 1,
      type: "witness",
      organization_id: String(profile.organization_id),
      organization_name: text(organization.name) || text(caseSnapshot.organization_name) || "Organização",
      organization_logo_url: text(organization.logo_url) || text(caseSnapshot.organization_logo_url) || null,
      organization_cnpj: text(organization.cnpj) || text(caseSnapshot.organization_cnpj) || null,
      organization_address: text(organization.address) || text(caseSnapshot.organization_address) || null,
      organization_phone: text(organization.phone) || text(caseSnapshot.organization_phone) || null,
      responsible_name: text(profile.full_name) || "Responsável pelo registro",
      employee_name: witnessName,
      employee_registration: witnessRegistration,
      employee_function: text(transactionRecord.employee_job_title_snapshot) || text(employee.job_title) || text(employee.function_name) || null,
      employee_department: text(employee.department) || null,
      employee_admission_date: text(employee.admission_date) || null,
      employee_termination_date: text(employee.status) === "terminated" ? text(employee.termination_date) || null : null,
      date: text(caseSnapshot.return_date),
      reason: text(caseSnapshot.return_reason),
      notes: null,
      witness_record_id: String(transactionRecord.id),
      refusal_record_id: String(eventRecord.id),
      recipient_name: text(caseSnapshot.employee_name) || "Colaborador",
      recipient_registration: text(caseSnapshot.employee_registration) || null,
      outcome: text(eventRecord.outcome),
      presentation_channel: text(eventRecord.presentation_channel),
      event_recorded_at: text(eventRecord.recorded_at),
      event_recorded_by: text(eventRecord.recorded_by_name),
      items: Array.isArray(caseSnapshot.items) ? caseSnapshot.items.map((value) => {
        const item = object(value);
        return {
          material: text(item.material_name) || "Material",
          quantity: Number(item.quantity) || 0,
          unit: text(item.unit) || "un.",
          incident_type: text(item.incident_type),
          incident_description: text(item.incident_description) || null,
          condition: text(item.condition) || null,
          destination: text(item.destination) || null,
        };
      }) : [],
      attestation: "Confirmo somente o fato que presenciei durante a apresentação. Esta assinatura não é feita em nome do colaborador, não reconhece dívida e não autoriza desconto em folha.",
    };
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const token = createToken();
    const tokenHash = await sha256(token);
    const snapshotHash = await sha256(stableJson(snapshot));
    const { data: link, error: insertError } = await admin.from("term_signature_links").insert({
      organization_id: profile.organization_id,
      employee_id: String(transactionRecord.employee_id),
      refusal_witness_id: String(transactionRecord.id),
      created_by: user.id,
      token_hash: tokenHash,
      snapshot,
      snapshot_hash: snapshotHash,
      expires_at: expiresAt,
    }).select("id,expires_at").single();
    if (insertError || !link) return respond({ error: "Não foi possível gerar o link da testemunha." }, 500, origin);
    const { error: revokeError } = await admin.from("term_signature_links").update({ revoked_at: now.toISOString() })
      .eq("organization_id", profile.organization_id).eq("refusal_witness_id", String(transactionRecord.id))
      .neq("id", link.id).is("used_at", null).is("revoked_at", null);
    if (revokeError) {
      await admin.from("term_signature_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id);
      return respond({ error: "Não foi possível preparar o link da testemunha." }, 500, origin);
    }
    const safeOrigin = origin && allowedOrigins.has(origin) ? origin : productionOrigin;
    return respond({
      id: link.id,
      url: `${safeOrigin}/assinar/${token}`,
      expires_at: link.expires_at,
      employee_name: witnessName,
      witness_name: witnessName,
      snapshot,
    }, 200, origin);
  }
  if (recordType === "pending_delivery" && transactionRecord.status !== "pending_signature") return respond({ error: "Esta ficha não está mais pendente de assinatura." }, 409, origin);
  if (recordType === "deduction" && action === "create" && (transactionRecord.status !== "approved" || transactionRecord.signed_at)) return respond({ error: "A autorização precisa estar aprovada e ainda não assinada." }, 409, origin);
  if (recordType === "deduction" && transactionRecord.status === "signed") return respond({ error: "Esta autorização já foi assinada." }, 409, origin);
  if (recordType !== "pending_delivery" && recordType !== "deduction" && transactionRecord.term_signed_at) return respond({ error: "Esta ficha já está assinada." }, 409, origin);

  if (action === "cancel") {
    const { data: revokedLinks, error: revokeError } = await admin.from("term_signature_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", profile.organization_id)
      .eq(recordType === "deduction" ? "deduction_case_id" : "return_id", recordId)
      .is("used_at", null)
      .is("revoked_at", null)
      .select("id");
    if (revokeError) return respond({ error: "Não foi possível cancelar o link de assinatura." }, 500, origin);
    return respond({ cancelled: true, revoked_count: revokedLinks?.length ?? 0 }, 200, origin);
  }

  if (recordType === "deduction") {
    const employee = object(transactionRecord.employee);
    const returnRecord = object(transactionRecord.return);
    const returnItems = Array.isArray(returnRecord.return_items) ? returnRecord.return_items.map(object).filter((item) => item.deduction_requested === true) : [];
    const items = returnItems.map((item) => ({ ...mapReturnItem(item), deduction_requested: true }));
    const approvedAmount = Number(transactionRecord.approved_amount);
    if (!text(transactionRecord.employee_id) || !items.length || !Number.isFinite(approvedAmount) || approvedAmount <= 0) {
      return respond({ error: "A autorização aprovada não possui colaborador, valor ou itens para assinatura." }, 409, origin);
    }
    const organization = object("organization" in profile ? profile.organization : null);
    const snapshot = {
      version: 1,
      type: "deduction",
      organization_id: String(profile.organization_id),
      organization_name: text(organization.name) || "Organização",
      organization_logo_url: text(organization.logo_url) || null,
      organization_cnpj: text(organization.cnpj) || null,
      organization_address: text(organization.address) || null,
      organization_phone: text(organization.phone) || null,
      responsible_name: text(profile.full_name) || "Responsável do RH",
      employee_name: text(employee.full_name) || "Colaborador",
      employee_registration: text(employee.registration) || null,
      employee_function: text(employee.job_title) || text(employee.function_name) || null,
      employee_department: text(employee.department) || null,
      employee_admission_date: text(employee.admission_date) || null,
      employee_termination_date: text(employee.status) === "terminated" ? text(employee.termination_date) || null : null,
      date: text(returnRecord.returned_at),
      reason: text(returnRecord.reason),
      notes: text(transactionRecord.review_notes) || null,
      case_id: recordId,
      approved_amount: approvedAmount,
      items,
    };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const token = createToken();
    const tokenHash = await sha256(token);
    const snapshotHash = await sha256(stableJson(snapshot));
    const { data: link, error: insertError } = await admin.from("term_signature_links").insert({
      organization_id: profile.organization_id,
      employee_id: text(transactionRecord.employee_id),
      deduction_case_id: recordId,
      created_by: user.id,
      token_hash: tokenHash,
      snapshot,
      snapshot_hash: snapshotHash,
      expires_at: expiresAt,
    }).select("id,expires_at").single();
    if (insertError || !link) return respond({ error: "Não foi possível gerar o link de autorização." }, 500, origin);

    const { error: revokeError } = await admin.from("term_signature_links").update({ revoked_at: now.toISOString() })
      .eq("organization_id", profile.organization_id).eq("deduction_case_id", recordId)
      .neq("id", link.id).is("used_at", null).is("revoked_at", null);
    if (revokeError) {
      await admin.from("term_signature_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id);
      return respond({ error: "Não foi possível preparar o link de autorização." }, 500, origin);
    }
    const safeOrigin = origin && allowedOrigins.has(origin) ? origin : productionOrigin;
    return respond({
      url: `${safeOrigin}/assinar/${token}`,
      expires_at: link.expires_at,
      employee_name: snapshot.employee_name,
      employee_phone: employeePhone,
      snapshot,
    }, 200, origin);
  }

  const employee = object(transactionRecord.employee);
  const employeeId = text(transactionRecord.employee_id);
  const organization = object("organization" in profile ? profile.organization : null);
  const rawItems = recordType === "delivery" ? transactionRecord.delivery_items : transactionRecord.return_items;
  const items = recordType === "pending_delivery"
    ? await mapPendingDeliveryItems(transactionRecord, String(profile.organization_id))
    : Array.isArray(rawItems)
      ? rawItems.map((value) => recordType === "delivery" ? mapDeliveryItem(value) : mapReturnItem(value))
      : [];
  const snapshot = {
    version: 1,
    type: recordType === "return" ? "return" : "delivery",
    pre_delivery_signature: recordType === "pending_delivery",
    organization_id: String(profile.organization_id),
    organization_name: text(organization?.name) || "Organização",
    organization_logo_url: text(organization?.logo_url) || null,
    organization_cnpj: text(organization?.cnpj) || null,
    organization_address: text(organization?.address) || null,
    organization_phone: text(organization?.phone) || null,
    responsible_name: text(profile.full_name) || "Responsável pelo controle",
    employee_name: text(employee.full_name) || "Colaborador",
    employee_registration: text(employee.registration) || null,
    employee_function: text(employee.job_title) || text(employee.function_name) || null,
    employee_department: text(employee.department) || null,
    employee_admission_date: text(employee.admission_date) || null,
    employee_termination_date: text(employee.status) === "terminated" ? text(employee.termination_date) || null : null,
    date: recordType === "return" ? text(transactionRecord.returned_at) : text(transactionRecord.delivered_at),
    reason: text(transactionRecord.reason),
    notes: text(transactionRecord.notes) || null,
    items,
  };
  if (!employeeId || !items.length) return respond({ error: "A ficha não possui dados suficientes para assinatura." }, 409, origin);

  const { error: snapshotUpdateError } = recordType === "pending_delivery"
    ? await admin.from("pending_deliveries").update({ snapshot }).eq("id", recordId).eq("organization_id", profile.organization_id)
    : { error: null };
  if (snapshotUpdateError) return respond({ error: "Não foi possível guardar a ficha para impressão." }, 500, origin);

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
    pending_delivery_id: recordType === "pending_delivery" ? recordId : null,
    deduction_case_id: null,
    created_by: user.id,
    token_hash: tokenHash,
    snapshot,
    snapshot_hash: snapshotHash,
    expires_at: expiresAt,
  }).select("id,expires_at").single();
  if (insertError || !link) return respond({ error: "Não foi possível gerar o link de assinatura." }, 500, origin);

  const revokeQuery = admin.from("term_signature_links").update({ revoked_at: now.toISOString() })
    .eq("organization_id", profile.organization_id).neq("id", link.id).is("used_at", null).is("revoked_at", null);
  const { error: revokeError } = recordType === "return"
    ? await revokeQuery.eq("return_id", recordId)
    : recordType === "pending_delivery"
      ? await revokeQuery.eq("pending_delivery_id", recordId)
      : await revokeQuery.eq("delivery_id", recordId);
  if (revokeError) {
    await admin.from("term_signature_links").update({ revoked_at: new Date().toISOString() }).eq("id", link.id);
    return respond({ error: "Não foi possível preparar o link de assinatura." }, 500, origin);
  }

  const safeOrigin = origin && allowedOrigins.has(origin) ? origin : productionOrigin;
  const result: Record<string, unknown> = {
    url: `${safeOrigin}/assinar/${token}`,
    expires_at: link.expires_at,
    employee_name: snapshot.employee_name,
    employee_phone: employeePhone,
  };
  if (recordType === "pending_delivery") result.snapshot = snapshot;
  return respond(result, 200, origin);
});
