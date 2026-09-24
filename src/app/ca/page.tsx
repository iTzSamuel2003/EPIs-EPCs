"use client";

import { ExternalLink, FileCheck2, LoaderCircle, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";

type Certificate = {
  ca_number: string;
  status: string | null;
  valid_until: string | null;
  process_number: string | null;
  manufacturer_name: string | null;
  manufacturer_document: string | null;
  equipment_name: string | null;
  equipment_description: string | null;
  brand: string | null;
  reference: string | null;
  standard: string | null;
  synced_at: string;
};
type Material = { id: string; name: string; internal_code: string | null; ca_number: string | null };

function today() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
function dateBR(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR") : "Não informada";
}
function situation(certificate: Certificate) {
  const normalized = (certificate.status ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (certificate.valid_until && certificate.valid_until < today()) return { label: "Vencido", tone: "danger" };
  if (normalized.includes("cancel") || normalized.includes("suspens")) return { label: certificate.status ?? "Restrito", tone: "danger" };
  if (normalized.includes("valid") || normalized.includes("ativo")) return { label: "Válido", tone: "success" };
  return { label: certificate.status || "Não informado", tone: "warning" };
}

export default function CAPage() {
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadMaterials() {
    const supabase = createClient();
    const { data, error: materialError } = await supabase.from("materials").select("id,name,internal_code,ca_number").not("ca_number", "is", null).order("name");
    if (materialError) throw materialError;
    setMaterials((data ?? []) as Material[]);
  }

  async function searchCertificates(term: string) {
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      let request = supabase.from("ca_certificates").select("ca_number,status,valid_until,process_number,manufacturer_name,manufacturer_document,equipment_name,equipment_description,brand,reference,standard,synced_at").order("ca_number").limit(50);
      const normalized = term.trim();
      if (normalized) {
        const safe = normalized.replace(/[%,()]/g, " ").trim();
        if (safe) request = request.or(`ca_number.ilike.%${safe}%,equipment_name.ilike.%${safe}%,equipment_description.ilike.%${safe}%,manufacturer_name.ilike.%${safe}%,brand.ilike.%${safe}%,reference.ilike.%${safe}%`);
      }
      const { data, error: caError } = await request;
      if (caError) throw caError;
      setCertificates((data ?? []) as Certificate[]);
      setSelected((current) => current && (data ?? []).some((item) => item.ca_number === current.ca_number) ? current : null);
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível carregar a consulta de CA."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMaterials().catch((caught) => setError(friendlyError(caught, "Não foi possível carregar os materiais vinculados.")));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void searchCertificates(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const linkedCaNumbers = useMemo(() => new Set(materials.map((material) => material.ca_number).filter(Boolean)), [materials]);
  const linkedMaterials = selected ? materials.filter((material) => material.ca_number === selected.ca_number) : [];

  return <main className="module-shell ca-page">
    <header className="module-header"><div><p className="eyebrow">CONFORMIDADE</p><h1>Consulta de CA</h1><p className="module-subtitle">Consulte os Certificados de Aprovação e veja quais materiais estão vinculados.</p></div><a className="secondary-button" href="https://caepi.mte.gov.br/internet/ConsultaCAInternet.aspx" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Consulta oficial</a></header>
    <section className="module-toolbar"><div className="module-search"><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por CA, equipamento ou fabricante" aria-label="Buscar certificado de aprovação" /></div><span className="ca-sync-note">{certificates.length} resultado(s) exibido(s)</span></section>
    {error && <FeedbackMessage onRetry={() => void searchCertificates(query)}>{error}</FeedbackMessage>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando certificados...</div> : <div className="ca-layout">
      <section className="panel module-table-card"><div className="panel-header"><div><h2>Certificados cadastrados</h2><p>Dados importados da base oficial do CAEPI. A busca exibe até 50 resultados.</p></div></div>{certificates.length ? <div className="table-wrap"><table aria-label="Certificados de aprovação"><thead><tr><th>CA</th><th>EQUIPAMENTO</th><th>FABRICANTE</th><th>VALIDADE</th><th>SITUAÇÃO</th></tr></thead><tbody>{certificates.map((certificate) => { const state = situation(certificate); return <tr key={certificate.ca_number} className={selected?.ca_number === certificate.ca_number ? "ca-row-selected" : undefined} onClick={() => setSelected(certificate)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(certificate); }}><td><strong>{certificate.ca_number}</strong>{linkedCaNumbers.has(certificate.ca_number) && <small className="ca-linked-label">Vinculado a material</small>}</td><td>{certificate.equipment_name || "Não informado"}</td><td>{certificate.manufacturer_name || "Não informado"}</td><td>{dateBR(certificate.valid_until)}</td><td><span className={`status-pill ${state.tone}`}>{state.label}</span></td></tr>; })}</tbody></table></div> : <div className="empty-state"><FileCheck2 size={28} /><strong>{query ? "Nenhum CA encontrado" : "Base de CA ainda não sincronizada"}</strong><span>{query ? "Ajuste os termos da busca." : "Importe a base oficial do CAEPI para começar as consultas."}</span></div>}</section>
      <aside className="panel ca-detail-panel">{selected ? <><div className="ca-detail-header"><div><p className="eyebrow">CERTIFICADO DE APROVAÇÃO</p><h2>CA {selected.ca_number}</h2></div><span className={`status-pill ${situation(selected).tone}`}>{situation(selected).label}</span></div><dl className="ca-detail-grid"><div><dt>Equipamento</dt><dd>{selected.equipment_name || "Não informado"}</dd></div><div><dt>Fabricante</dt><dd>{selected.manufacturer_name || "Não informado"}</dd></div><div><dt>CNPJ</dt><dd>{selected.manufacturer_document || "Não informado"}</dd></div><div><dt>Validade</dt><dd>{dateBR(selected.valid_until)}</dd></div><div><dt>Marca</dt><dd>{selected.brand || "Não informada"}</dd></div><div><dt>Referência</dt><dd>{selected.reference || "Não informada"}</dd></div><div><dt>Norma</dt><dd>{selected.standard || "Não informada"}</dd></div><div><dt>Processo</dt><dd>{selected.process_number || "Não informado"}</dd></div></dl><div className="ca-description"><strong>Descrição</strong><p>{selected.equipment_description || "Não informada."}</p></div><div className="ca-linked-materials"><strong>Materiais vinculados</strong>{linkedMaterials.length ? linkedMaterials.map((material) => <span key={material.id}>{material.name}{material.internal_code ? ` · ${material.internal_code}` : ""}</span>) : <span>Nenhum material cadastrado usa este CA.</span>}</div><small className="ca-last-sync">Última sincronização: {new Date(selected.synced_at).toLocaleString("pt-BR")}</small></> : <div className="empty-state"><ShieldAlert size={28} /><strong>Selecione um certificado</strong><span>Os detalhes e os materiais vinculados aparecerão aqui.</span></div>}</aside>
    </div>}
  </main>;
}
