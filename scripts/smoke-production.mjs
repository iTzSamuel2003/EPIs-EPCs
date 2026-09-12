const baseUrl = (process.env.PRODUCTION_URL ?? "https://epis-epcs.vercel.app").replace(/\/$/, "");
const publicRoutes = new Set(["/login", "/portal", "/reset-password"]);
const routes = [
  "/", "/audit", "/ca", "/compliance", "/contract-requirements", "/costs",
  "/deliveries", "/employees", "/entries", "/function-templates", "/help",
  "/materials", "/movements", "/portal-qr", "/reports", "/requests", "/returns",
  "/settings", "/stock", "/teams", "/tests", "/training-compliance", "/units",
  "/validities", "/variants", "/login", "/portal", "/reset-password",
];

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);
const failures = [];

try {
  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`, {
      redirect: "manual",
      signal: controller.signal,
    });
    const expected = publicRoutes.has(route) ? 200 : 307;
    if (response.status !== expected) failures.push(`${response.status} ${route} (esperado ${expected})`);
  }
} finally {
  clearTimeout(timeout);
}

if (failures.length) {
  console.error(`Smoke test falhou em ${failures.length} rota(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Smoke test aprovado: ${routes.length} rotas em ${baseUrl}.`);
}
