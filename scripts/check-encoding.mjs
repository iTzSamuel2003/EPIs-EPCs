import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["src", "supabase", "public", "."].map((root) => path.resolve(root));
const ignored = new Set(["node_modules", ".next", ".git"]);
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".md", ".sql", ".json", ".html"]);
const mojibake = ["\u00c3\u00a3", "\u00c3\u00a7", "\u00c3\u00a1", "\u00c3\u00a9", "\u00c3\u00ad", "\u00c3\u00b3", "\u00c3\u00ba", "\u00c2\u00b7", "\u00e2\u0080", "\u00f0\u009f", "\ufffd"];
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
}

await collect(roots[0]);
await collect(roots[1]);
await collect(roots[2]);
for (const file of ["CLAUDE.md", "AGENTS.md", "README.md"]) files.push(path.resolve(file));

const failures = [];
for (const file of [...new Set(files)]) {
  const text = await readFile(file, "utf8");
  if (mojibake.some((sequence) => text.includes(sequence))) failures.push(path.relative(process.cwd(), file));
}

if (failures.length) {
  console.error(`Possível codificação incorreta em: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Codificação UTF-8 validada: nenhum texto corrompido encontrado.");
