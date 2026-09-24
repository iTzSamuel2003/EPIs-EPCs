import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const filePath = process.argv[2];
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes("--dry-run");
const functionUrl = process.env.CA_IMPORT_FUNCTION_URL;
const functionToken = process.env.CA_IMPORT_FUNCTION_TOKEN;

if (!filePath || (!dryRun && ((!url || !serviceKey) && (!functionUrl || !functionToken)))) {
  console.error("Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-caepi.mjs caminho/para/base-caepi.csv");
  process.exit(1);
}

const content = await fs.readFile(filePath, "utf8");
const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
if (lines.length < 2) throw new Error("A base do CAEPI está vazia ou sem cabeçalho.");

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      values.push(value.trim() || null); value = "";
    } else value += char;
  }
  values.push(value.trim() || null);
  return values;
}

const delimiter = lines[0].includes("|") ? "|" : lines[0].includes(";") ? ";" : ",";
const normalizeHeader = (header) => (header ?? "").replace(/^#/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const headers = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);
const column = (...names) => names.map(normalizeHeader).map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
const indexes = {
  ca_number: column("nrregistroca", "registroca", "numeroCA", "ca"),
  valid_until: column("datavalidade", "datadevalidade", "validade", "validadeca"),
  status: column("situacao", "status"),
  process_number: column("nrprocesso", "nrdoprocesso", "processo"),
  manufacturer_document: column("cnpj", "cnpjfabricante"),
  manufacturer_name: column("razaosocial", "fabricante", "nomefabricante"),
  equipment_name: column("nomeequipamento", "equipamento", "descricaoequipamento"),
  equipment_description: column("descricaoequipamento", "descricao"),
  brand: column("marcaca", "marca"),
  reference: column("referencia"),
  color: column("cor"),
  approved_for_report: column("aprovadoparalaudo", "aprovadopararelatorios"),
  report_restriction: column("restricaolaudo", "restricaorelatorios"),
  report_analysis_notes: column("observacaoanaliselaudo", "observacoes"),
  laboratory_document: column("cnpjlaboratorio"),
  laboratory_name: column("razaosociallaboratorio", "laboratorio"),
  report_number: column("nrlaudo", "numerolaudo"),
  standard: column("norma"),
};

if (indexes.ca_number < 0) throw new Error(`Não foi possível localizar a coluna do número do CA. Cabeçalho encontrado: ${headers.join(", ")}`);
function parseDate(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const br = trimmed.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = trimmed.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

const parsedRows = lines.slice(1).map((line) => {
  const values = parseDelimitedLine(line, delimiter);
  const row = Object.fromEntries(Object.entries(indexes).map(([key, index]) => [key, index >= 0 ? values[index] ?? null : null]));
  row.ca_number = row.ca_number?.replace(/\D/g, "") || null;
  row.valid_until = parseDate(row.valid_until);
  row.raw_data = Object.fromEntries(headers.map((header, index) => [header || `coluna_${index + 1}`, values[index] ?? null]));
  return row;
}).filter((row) => row.ca_number);
const rows = [...new Map(parsedRows.map((row) => [row.ca_number, row])).values()];

if (dryRun) {
  console.log(`Leitura concluída: ${rows.length} CAs válidos encontrados.`);
  console.log(JSON.stringify(rows.slice(0, 2), null, 2));
  process.exit(0);
}

const supabase = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const batchSize = 500;
for (let index = 0; index < rows.length; index += batchSize) {
  const batch = rows.slice(index, index + batchSize);
  if (functionUrl) {
    const response = await fetch(functionUrl, { method: "POST", headers: { "content-type": "application/json", "x-ca-import-token": functionToken }, body: JSON.stringify({ rows: batch }) });
    if (!response.ok) throw new Error(`Falha no importador remoto (${response.status}): ${await response.text()}`);
  } else {
    const { error } = await supabase.from("ca_certificates").upsert(batch, { onConflict: "ca_number" });
    if (error) throw error;
  }
  console.log(`Importados ${Math.min(index + batchSize, rows.length)} de ${rows.length} CAs`);
}

console.log(`Importação concluída: ${rows.length} CAs.`);
