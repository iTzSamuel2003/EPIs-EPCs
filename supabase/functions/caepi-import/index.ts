import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v4.15.5/index.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const githubKeys = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));
const expectedRepository = "iTzSamuel2003/EPIs-EPCs";
const expectedAudience = "supabase-caepi-import";

async function authorize(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  try {
    const { payload } = await jwtVerify(header.slice(7), githubKeys, {
      issuer: "https://token.actions.githubusercontent.com",
      audience: expectedAudience,
    });
    return payload.repository === expectedRepository && payload.ref === "refs/heads/main";
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST" || !(await authorize(request))) return new Response("Não autorizado", { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 1000) return Response.json({ error: "Envie entre 1 e 1000 registros." }, { status: 400 });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await supabase.from("ca_certificates").upsert(body.rows, { onConflict: "ca_number" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ imported: body.rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao importar." }, { status: 400 });
  }
});
