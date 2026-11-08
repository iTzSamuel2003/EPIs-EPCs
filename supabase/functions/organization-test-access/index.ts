import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const productionOrigin = "https://epis-epcs.vercel.app";
const allowedOrigins = new Set([
  productionOrigin,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const testEmailDomain = "test.epistemporario.invalid";
const passwordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";

type OrganizationSummary = {
  id: string;
  name: string;
  lifecycle_status: string;
};
type TestAccessRecord = {
  organization_id: string;
  user_id: string;
  login_name: string;
  expires_at: string;
  revoked_at: string | null;
  is_active: boolean;
};

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : productionOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function respond(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Cache-Control": "no-store, private",
      "Content-Type": "application/json; charset=utf-8",
      "Pragma": "no-cache",
    },
  });
}

function randomHex(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function generatePassword(length = 22) {
  const limit = 256 - (256 % passwordAlphabet.length);
  const output: string[] = [];
  while (output.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < limit) {
        output.push(passwordAlphabet[byte % passwordAlphabet.length]);
      }
      if (output.length === length) break;
    }
  }
  return output.join("");
}

function organizationSlug(name: string) {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18).replace(
      /-+$/g,
      "",
    );
  return slug.length >= 3 ? slug : "org";
}

function firstKey(jsonValue: string | undefined) {
  if (!jsonValue) return "";
  try {
    const parsed = JSON.parse(jsonValue) as Record<string, string>;
    return parsed.default ?? "";
  } catch {
    return "";
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = firstKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY") || "";
const secretKey = firstKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") || "";

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return respond({ error: "Origem não autorizada." }, 403, origin);
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return respond({ error: "Método não permitido." }, 405, origin);
  }
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return respond(
      { error: "Configuração do servidor indisponível." },
      500,
      origin,
    );
  }

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)
    ?.[1];
  if (!bearer) {
    return respond({ error: "Entre novamente para continuar." }, 401, origin);
  }

  let body: { action?: unknown; organization_id?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") {
      return respond({ error: "Solicitação inválida." }, 400, origin);
    }
    body = parsed as { action?: unknown; organization_id?: unknown };
  } catch {
    return respond({ error: "Solicitação inválida." }, 400, origin);
  }

  const action = body.action;
  const organizationId = typeof body.organization_id === "string"
    ? body.organization_id
    : "";
  if (
    (action !== "generate" && action !== "revoke") ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(organizationId)
  ) {
    return respond(
      { error: "Informe uma organização e uma ação válidas." },
      400,
      origin,
    );
  }

  const auth = { persistSession: false, autoRefreshToken: false };
  const userClient = createClient(supabaseUrl, publishableKey, {
    auth,
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const adminClient = createClient(supabaseUrl, secretKey, { auth });

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser(
      bearer,
    );
    if (userError || !userData.user) {
      return respond(
        { error: "Sessão inválida. Entre novamente." },
        401,
        origin,
      );
    }

    const { data: isPlatformAdmin, error: permissionError } = await userClient
      .rpc("current_user_is_platform_admin");
    if (permissionError || isPlatformAdmin !== true) {
      return respond(
        {
          error:
            "Somente a administração da plataforma pode gerenciar esse acesso.",
        },
        403,
        origin,
      );
    }

    const [
      { data: organizations, error: organizationsError },
      { data: accessRows, error: accessError },
    ] = await Promise.all([
      userClient.rpc("list_platform_organizations"),
      userClient.rpc("list_platform_organization_test_access"),
    ]);
    if (organizationsError || accessError) {
      return respond(
        {
          error:
            "Não foi possível verificar a organização e o acesso de teste.",
        },
        503,
        origin,
      );
    }

    const organization = (organizations as OrganizationSummary[] | null)?.find((
      item,
    ) => item.id === organizationId);
    if (
      !organization ||
      (action === "generate" && organization.lifecycle_status === "suspended")
    ) {
      return respond(
        { error: "A organização está indisponível para acesso de teste." },
        404,
        origin,
      );
    }
    const access = (accessRows as TestAccessRecord[] | null)?.find((item) =>
      item.organization_id === organizationId
    );

    if (action === "revoke") {
      if (!access) return respond({ revoked: true }, 200, origin);
      const { data: revokedUserId, error: revokeError } = await userClient.rpc(
        "revoke_platform_organization_test_access",
        {
          p_organization_id: organizationId,
          p_expected_user_id: access.user_id,
        },
      );
      if (revokeError) {
        return respond(
          { error: "Não foi possível bloquear o acesso de teste." },
          500,
          origin,
        );
      }
      if (typeof revokedUserId !== "string") {
        return respond({ revoked: true }, 200, origin);
      }
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(
        revokedUserId,
      );
      if (deleteError) {
        console.error("organization test account cleanup failed");
        return respond(
          {
            error:
              "O acesso foi bloqueado, mas a conta não pôde ser removida. Tente novamente.",
          },
          502,
          origin,
        );
      }
      return respond({ revoked: true }, 200, origin);
    }

    const loginName = `teste-${organizationSlug(organization.name)}-${
      randomHex(6)
    }`;
    const email = `${loginName}@${testEmailDomain}`;
    const password = generatePassword();
    const previousUserId = access?.user_id;
    const { data: createdUser, error: createError } = await adminClient.auth
      .admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Acesso temporário de teste" },
      });
    if (createError || !createdUser.user) {
      console.error("organization test account creation failed");
      return respond(
        {
          error: "Não foi possível criar o acesso temporário. Tente novamente.",
        },
        502,
        origin,
      );
    }
    const userId = createdUser.user.id;

    const { data: savedRows, error: saveError } = await userClient.rpc(
      "save_platform_organization_test_access",
      {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_login_name: loginName,
        p_expected_user_id: previousUserId ?? null,
      },
    );
    if (
      saveError || !Array.isArray(savedRows) ||
      typeof savedRows[0]?.expires_at !== "string"
    ) {
      await adminClient.auth.admin.deleteUser(userId);
      console.error("organization test access persistence failed");
      return respond(
        {
          error:
            "A conta foi preparada, mas não foi possível vincular o acesso à organização.",
        },
        502,
        origin,
      );
    }

    let cleanupWarning: string | undefined;
    if (previousUserId && previousUserId !== userId) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(
        previousUserId,
      );
      if (cleanupError) {
        cleanupWarning =
          "A nova conta já está ativa; a anterior foi bloqueada, mas a limpeza da conta antiga precisa ser conferida.";
        console.error("replaced organization test account cleanup failed");
      }
    }

    return respond(
      {
        login_name: loginName,
        password,
        expires_at: savedRows[0].expires_at,
        cleanup_warning: cleanupWarning,
      },
      200,
      origin,
    );
  } catch {
    console.error("organization test access request failed");
    return respond(
      { error: "Não foi possível concluir a solicitação agora." },
      500,
      origin,
    );
  }
});
