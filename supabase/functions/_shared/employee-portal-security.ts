import { createClient } from "@supabase/supabase-js";

const localPortalOrigin = "http://localhost:3000";

export function getTrustedEmployeePortalIp(
  request: Request,
  origin: string | null,
) {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (
    cloudflareIp && cloudflareIp.length <= 45 &&
    /^[0-9a-fA-F:.]+$/.test(cloudflareIp)
  ) {
    return cloudflareIp;
  }

  if (origin === localPortalOrigin) return "127.0.0.1";

  throw new Error("EMPLOYEE_PORTAL_IP_UNAVAILABLE");
}

async function hmacFingerprint(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createEmployeePortalIpAdmin(
  request: Request,
  origin: string | null,
  supabaseUrl: string,
  serviceKey: string,
) {
  const ip = getTrustedEmployeePortalIp(request, origin);
  const ipFingerprint = await hmacFingerprint(serviceKey, `ip:${ip}`);
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-employee-portal-ip": ipFingerprint } },
  });
}

export async function createEmployeePortalAdmin(
  request: Request,
  origin: string | null,
  registration: string,
  cpf: string,
  supabaseUrl: string,
  serviceKey: string,
) {
  if (
    !registration.trim() || registration.trim().length > 100 || !cpf.trim() ||
    cpf.trim().length > 64
  ) {
    throw new Error("EMPLOYEE_PORTAL_CREDENTIALS_INVALID");
  }
  const ip = getTrustedEmployeePortalIp(request, origin);
  const normalizedRegistration = registration.trim().toLowerCase();
  const normalizedCpf = cpf.replace(/\D/g, "");
  const [ipFingerprint, registrationFingerprint, credentialFingerprint] =
    await Promise.all([
      hmacFingerprint(serviceKey, `ip:${ip}`),
      hmacFingerprint(serviceKey, `registration:${normalizedRegistration}`),
      hmacFingerprint(
        serviceKey,
        `credential:${normalizedRegistration}|${normalizedCpf}`,
      ),
    ]);

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        "x-employee-portal-ip": ipFingerprint,
        "x-employee-portal-registration": registrationFingerprint,
        "x-employee-portal-credential": credentialFingerprint,
      },
    },
  });
}

export async function enforceEmployeePortalIpRateLimit(
  admin: {
    rpc: (name: string) => PromiseLike<{
      error: { code?: string; message: string } | null;
    }>;
  },
) {
  const { error } = await admin.rpc("enforce_employee_portal_ip_rate_limit");
  if (!error) return;

  // Allow the coordinated rollout to deploy Edge Functions before the SQL
  // migration. Once the migration is applied, the persistent limiter is used.
  if (error.code === "PGRST202") return;
  if (/portal_rate_limit_exceeded/i.test(error.message)) {
    throw new Error("PORTAL_RATE_LIMIT_EXCEEDED");
  }
  throw new Error("EMPLOYEE_PORTAL_RATE_LIMIT_UNAVAILABLE");
}
