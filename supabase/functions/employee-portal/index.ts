import "@supabase/functions-js/edge-runtime.d.ts";
import {
  createEmployeePortalAdmin,
  createEmployeePortalIpAdmin,
  enforceEmployeePortalIpRateLimit,
} from "../_shared/employee-portal-security.ts";

const allowedOrigins = new Set([
  "https://epis-epcs.vercel.app",
  "http://localhost:3000",
]);
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : "https://epis-epcs.vercel.app",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function isRateLimitError(message: string) {
  return /muitas tentativas|portal_rate_limit_exceeded/i.test(message);
}

async function readJsonBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32 * 1024) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return response({ error: "Origem não autorizada" }, 403, origin);
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return response({ error: "Método não permitido" }, 405, origin);
  }
  if (!supabaseUrl || !serviceKey) {
    return response(
      { error: "Configuração do servidor indisponível" },
      500,
      origin,
    );
  }

  let ipAdmin: Awaited<ReturnType<typeof createEmployeePortalIpAdmin>>;
  try {
    ipAdmin = await createEmployeePortalIpAdmin(
      request,
      origin,
      supabaseUrl,
      serviceKey,
    );
    await enforceEmployeePortalIpRateLimit(ipAdmin);
  } catch (error) {
    if (
      error instanceof Error && error.message === "PORTAL_RATE_LIMIT_EXCEEDED"
    ) {
      return response(
        { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
        429,
        origin,
      );
    }
    const unavailable = error instanceof Error &&
      error.message === "EMPLOYEE_PORTAL_IP_UNAVAILABLE";
    console.error("employee portal IP limiter unavailable");
    return response(
      {
        error: unavailable
          ? "Não foi possível validar a origem. Tente novamente."
          : "Serviço temporariamente indisponível. Tente novamente.",
      },
      503,
      origin,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonBody(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid json");
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
      return response(
        { error: "Solicitação excede o limite permitido" },
        413,
        origin,
      );
    }
    return response({ error: "Solicitação inválida" }, 400, origin);
  }

  const registration = typeof body.registration === "string"
    ? body.registration.trim()
    : "";
  const cpf = typeof body.cpf === "string" ? body.cpf.trim() : "";
  const action = body.action;
  if (!registration || registration.length > 100 || !cpf || cpf.length > 64) {
    return response({ error: "Informe matrícula e CPF válidos" }, 400, origin);
  }

  let admin: Awaited<ReturnType<typeof createEmployeePortalAdmin>>;
  try {
    admin = await createEmployeePortalAdmin(
      request,
      origin,
      registration,
      cpf,
      supabaseUrl,
      serviceKey,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "EMPLOYEE_PORTAL_IP_UNAVAILABLE"
    ) {
      return response(
        { error: "Não foi possível validar a origem. Tente novamente." },
        503,
        origin,
      );
    }
    return response(
      { error: "Não foi possível validar o acesso." },
      500,
      origin,
    );
  }

  let result: unknown;
  let error: { message: string } | null = null;
  if (action === "profile") {
    ({ data: result, error } = await admin.rpc("get_employee_portal_data_v3", {
      p_registration: registration,
      p_cpf: cpf,
    }));
  } else if (action === "measurements") {
    const fields = [
      "shirt_size",
      "pants_size",
      "shoe_size",
      "helmet_size",
      "glove_size",
      "notes",
    ] as const;
    if (
      fields.some((field) =>
        body[field] !== null && body[field] !== undefined &&
        typeof body[field] !== "string"
      )
    ) {
      return response({ error: "Informe medidas válidas" }, 400, origin);
    }
    const values = {
      shirt_size: typeof body.shirt_size === "string" ? body.shirt_size : "",
      pants_size: typeof body.pants_size === "string" ? body.pants_size : "",
      shoe_size: typeof body.shoe_size === "string" ? body.shoe_size : "",
      helmet_size: typeof body.helmet_size === "string" ? body.helmet_size : "",
      glove_size: typeof body.glove_size === "string" ? body.glove_size : "",
      notes: typeof body.notes === "string" ? body.notes : "",
    };
    if (
      [
        values.shirt_size,
        values.pants_size,
        values.shoe_size,
        values.helmet_size,
        values.glove_size,
      ].some((value) => value.length > 50) || values.notes.length > 1000
    ) {
      return response(
        { error: "Uma das medidas excede o tamanho permitido" },
        400,
        origin,
      );
    }
    ({ data: result, error } = await admin.rpc(
      "submit_employee_portal_measurements",
      {
        p_registration: registration,
        p_cpf: cpf,
        p_shirt_size: values.shirt_size,
        p_pants_size: values.pants_size,
        p_shoe_size: values.shoe_size,
        p_helmet_size: values.helmet_size,
        p_glove_size: values.glove_size,
        p_notes: values.notes,
      },
    ));
  } else if (action === "request") {
    const requestType = typeof body.request_type === "string"
      ? body.request_type
      : "";
    const description = typeof body.description === "string"
      ? body.description.trim()
      : "";
    if (!description || description.length > 2000) {
      return response(
        { error: "Informe uma descrição de até 2.000 caracteres" },
        400,
        origin,
      );
    }
    ({ data: result, error } = await admin.rpc(
      "submit_employee_portal_request",
      {
        p_registration: registration,
        p_cpf: cpf,
        p_request_type: requestType,
        p_description: description,
      },
    ));
  } else {
    return response({ error: "Operação não permitida" }, 400, origin);
  }

  if (error) {
    if (isRateLimitError(error.message)) {
      return response(
        { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
        429,
        origin,
      );
    }
    console.error("employee portal operation failed", {
      action,
      code: (error as { code?: string }).code,
    });
    return response(
      {
        error:
          "Não foi possível concluir a operação. Verifique os dados e tente novamente.",
      },
      400,
      origin,
    );
  }
  return response(result, 200, origin);
});
