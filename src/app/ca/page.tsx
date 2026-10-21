"use client";

import { ExternalLink, FileCheck2, LoaderCircle, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
type StockLink = { material_id: string; ca_number: string; material: { id: string; name: string; internal_code: string | null } };

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
  const [stockLinks, setStockLinks] = useState<StockLink[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Certificate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchSequence = useRef(0);
  const activeSearch = useRef<AbortController | null>(null);

  async function loadMaterials() {
    const supabase = createClient();
    const { data, error: lotError } = await supabase.from("material_lots").select("material_id,ca_number,material:materials!inner(id,name,internal_code)").not("ca_number", "is", null).gt("available_quantity", 0);
    if (lotError) throw lotError;
    setStockLinks((data ?? []) as unknown as StockLink[]);
  }

  async function searchCertificates(term: string) {
    const sequence = ++searchSequence.current;
    activeSearch.current?.abort();
    const controller = new AbortController();
    activeSearch.current = controller;
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      const supabase = createClient();
      const columns = "ca_number,status,valid_until,process_number,manufacturer_name,manufacturer_document,equipment_name,equipment_description,brand,reference,standard,synced_at";
      const createSearch = () => supabase.from("ca_certificates").select(columns).abortSignal(controller.signal);
      const normalized = term.trim();
      const caNumber = normalized.match(/^(?:CA\s*)?(\d+)$/i)?.[1];
      let results: Certificate[] = [];

      if (caNumber) {
        const exact = await createSearch().eq("ca_number", caNumber).order("ca_number").limit(50);
        if (exact.error) throw exact.error;
        results = (exact.data ?? []) as Certificate[];

        if (!results.length) {
          const partial = await createSearch().ilike("ca_number", `%${caNumber}%`).order("ca_number").limit(50);
          if (partial.error) throw partial.error;
          results = (partial.data ?? []) as Certificate[];
        }
      } else if (normalized) {
        const safe = normalized.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
        if (safe) {
          const [equipment, manufacturer] = await Promise.all([
            createSearch().textSearch("equipment_name", safe, { config: "simple", type: "plain" }).limit(50),
            createSearch().textSearch("manufacturer_name", safe, { config: "simple", type: "plain" }).limit(50),
          ]);
          if (equipment.error) throw equipment.error;
          if (manufacturer.error) throw manufacturer.error;

          const unique = new Map<string, Certificate>();
          for (const certificate of [...(equipment.data ?? []), ...(manufacturer.data ?? [])] as Certificate[]) {
            unique.set(certificate.ca_number, certificate);
          }
          results = [...unique.values()]
            .sort((left, right) => left.ca_number.localeCompare(right.ca_number, "pt-BR", { numeric: true }))
            .slice(0, 50);
        }
      } else {
        const initial = await createSearch().order("ca_number").limit(50);
        if (initial.error) throw initial.error;
        results = (initial.data ?? []) as Certificate[];
      }

      if (sequence !== searchSequence.current) return;
      setCertificates(results);
    } catch (caught) {
      if (sequence !== searchSequence.current) return;
      setError(friendlyError(caught, "Não foi possível carregar a consulta de CA."));
      setCertificates([]);
      setSelected(null);
    } finally {
      if (sequence === searchSequence.current) {
        setLoading(false);
        if (activeSearch.current === controller) activeSearch.current = null;
      }
    }
  }

  useEffect(() => {
    void loadMaterials().catch((caught) => setError(friendlyError(caught, "Não foi possível carregar os materiais vinculados.")));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void searchCertificates(query), 300);
    return () => {
      window.clearTimeout(timer);
      activeSearch.current?.abort();
      activeSearch.current = null;
      searchSequence.current += 1;
    };
  }, [query]);

  const linkedCaNumbers = useMemo(() => new Set(stockLinks.map((lot) => lot.ca_number)), [stockLinks]);
  const linkedMaterials = useMemo(() => {
    if (!selected) return [];
    const unique = new Map<string, StockLink["material"]>();
    for (const lot of stockLinks) if (lot.ca_number === selected.ca_number) unique.set(lot.material.id, lot.material);
    return [...unique.values()];
  }, [selected, stockLinks]);

  return <main className="module-shell ca-page">
    <header className="module-header"><div><p className="eyebrow">CONFORMIDADE</p><h1>Consulta de CA</h1><p className="module-subtitle">Consulte os Certificados de Aprovação e veja quais materiais estão vinculados.</p></div><a className="secondary-button" href="https://caepi.mte.gov.br/internet/ConsultaCAInternet.aspx" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Consulta oficial</a></header>
    <section className="module-toolbar"><div className="module-search"><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por CA, equipamento ou fabricante" aria-label="Buscar certificado de aprovação" /></div><span className="ca-sync-note">{certificates.length} resultado(s) exibido(s)</span></section>
    {error && <FeedbackMessage onRetry={() => void searchCertificates(query)}>{error}</FeedbackMessage>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando certificados...</div> : <div className="ca-layout">
      <section className="panel module-table-card"><div className="panel-header"><div><h2>Certificados cadastrados</h2><p>Dados importados da base oficial do CAEPI. A busca exibe até 50 resultados.</p></div></div>{certificates.length ? <div className="table-wrap"><table aria-label="Certificados de aprovação"><thead><tr><th>CA</th><th>EQUIPAMENTO</th><th>FABRICANTE</th><th>VALIDADE</th><th>SITUAÇÃO</th></tr></thead><tbody>{certificates.map((certificate) => { const state = situation(certificate); return <tr key={certificate.ca_number} className={selected?.ca_number === certificate.ca_number ? "ca-row-selected" : undefined} onClick={() => setSelected(certificate)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(certificate); }}><td><strong>{certificate.ca_number}</strong>{linkedCaNumbers.has(certificate.ca_number) && <small className="ca-linked-label">Em estoque</small>}</td><td>{certificate.equipment_name || "Não informado"}</td><td>{certificate.manufacturer_name || "Não informado"}</td><td>{dateBR(certificate.valid_until)}</td><td><span className={`status-pill ${state.tone}`}>{state.label}</span></td></tr>; })}</tbody></table></div> : <div className="empty-state"><FileCheck2 size={28} /><strong>{query ? "Nenhum CA encontrado" : "Base de CA ainda não sincronizada"}</strong><span>{query ? "Ajuste os termos da busca." : "Importe a base oficial do CAEPI para começar as consultas."}</span></div>}</section>
      <aside className="panel ca-detail-panel">{selected ? <><div className="ca-detail-header"><div><p className="eyebrow">CERTIFICADO DE APROVAÇÃO</p><h2>CA {selected.ca_number}</h2></div><span className={`status-pill ${situation(selected).tone}`}>{situation(selected).label}</span></div><dl className="ca-detail-grid"><div><dt>Equipamento</dt><dd>{selected.equipment_name || "Não informado"}</dd></div><div><dt>Fabricante</dt><dd>{selected.manufacturer_name || "Não informado"}</dd></div><div><dt>CNPJ</dt><dd>{selected.manufacturer_document || "Não informado"}</dd></div><div><dt>Validade</dt><dd>{dateBR(selected.valid_until)}</dd></div><div><dt>Marca</dt><dd>{selected.brand || "Não informada"}</dd></div><div><dt>Referência</dt><dd>{selected.reference || "Não informada"}</dd></div><div><dt>Norma</dt><dd>{selected.standard || "Não informada"}</dd></div><div><dt>Processo</dt><dd>{selected.process_number || "Não informado"}</dd></div></dl><div className="ca-description"><strong>Descrição</strong><p>{selected.equipment_description || "Não informada."}</p></div><div className="ca-linked-materials"><strong>Materiais com este CA em estoque</strong>{linkedMaterials.length ? linkedMaterials.map((material) => <span key={material.id}>{material.name}{material.internal_code ? ` · ${material.internal_code}` : ""}</span>) : <span>Nenhum lote disponível usa este CA.</span>}</div><small className="ca-last-sync">Última sincronização: {new Date(selected.synced_at).toLocaleString("pt-BR")}</small></> : <div className="empty-state"><ShieldAlert size={28} /><strong>Selecione um certificado</strong><span>Os detalhes e os materiais vinculados aparecerão aqui.</span></div>}</aside>
    </div>}
  </main>;
}
