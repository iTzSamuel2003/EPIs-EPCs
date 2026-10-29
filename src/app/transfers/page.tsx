"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, LoaderCircle, PackageCheck, Plus, RefreshCw, Send, X } from "lucide-react";
import { BaseSelect } from "@/components/base-select";
import { FeedbackMessage } from "@/components/feedback-message";
import { createClient } from "@/lib/supabase/client";
import { useBaseContext } from "@/lib/use-base-context";
import { friendlyError } from "@/lib/ui-feedback";

type Material = { id: string; name: string };
type Variant = { id: string; material_id: string; name: string; size: string | null };
type Lot = { id: string; base_id: string; material_id: string; variant_id: string | null; lot_number: string; available_quantity: number; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_expires_at: string | null };
type TransferHeader = { id: string; source_base_id: string; destination_base_id: string; status: "in_transit" | "received" | "cancelled"; notes: string | null; created_at: string; shipped_at: string; received_at: string | null };
type TransferItem = { id: string; transfer_id: string; source_lot_id: string; material_id: string; variant_id: string | null; quantity: number };
type DraftItem = { lot_id: string; quantity: string };

const statusLabels: Record<TransferHeader["status"], string> = { in_transit: "Em trânsito", received: "Recebida", cancelled: "Cancelada" };

export default function TransfersPage() {
  const { bases, accessibleBases, selectedBaseId, chooseBase, loading: basesLoading, error: basesError } = useBaseContext();
  const [lots, setLots] = useState<Lot[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [transfers, setTransfers] = useState<TransferHeader[]>([]);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [destinationBaseId, setDestinationBaseId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [lineQuantity, setLineQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    if (basesLoading) return;
    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const [lotResult, materialResult, variantResult, transferResult] = await Promise.all([
        selectedBaseId
          ? supabase.from("material_lots").select("id,base_id,material_id,variant_id,lot_number,available_quantity,ca_number,ca_expires_at,test_number,test_expires_at").eq("base_id", selectedBaseId).gt("available_quantity", 0).order("material_id").order("lot_number")
          : Promise.resolve({ data: [], error: null }),
        supabase.from("materials").select("id,name").order("name"),
        supabase.from("material_variants").select("id,material_id,name,size"),
        supabase.from("stock_transfers").select("id,source_base_id,destination_base_id,status,notes,created_at,shipped_at,received_at").order("created_at", { ascending: false }).limit(100),
      ]);
      const initialError = lotResult.error ?? materialResult.error ?? variantResult.error ?? transferResult.error;
      if (initialError) throw initialError;
      const transferRows = (transferResult.data ?? []) as TransferHeader[];
      const ids = transferRows.map((transfer) => transfer.id);
      const itemResult = ids.length
        ? await supabase.from("stock_transfer_items").select("id,transfer_id,source_lot_id,material_id,variant_id,quantity").in("transfer_id", ids)
        : { data: [], error: null };
      if (itemResult.error) throw itemResult.error;
      setLots((lotResult.data ?? []) as Lot[]);
      setMaterials((materialResult.data ?? []) as Material[]);
      setVariants((variantResult.data ?? []) as Variant[]);
      setTransfers(transferRows);
      setTransferItems((itemResult.data ?? []) as TransferItem[]);
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível carregar as transferências entre bases."));
      setLots([]);
      setTransfers([]);
      setTransferItems([]);
    } finally {
      setLoading(false);
    }
  }, [basesLoading, selectedBaseId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (accessibleBases.some((base) => base.id === selectedBaseId)) return;
    chooseBase(accessibleBases[0]?.id ?? "");
  }, [accessibleBases, chooseBase, selectedBaseId]);
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 4500);
    return () => window.clearTimeout(timer);
  }, [success]);

  const materialById = useMemo(() => new Map(materials.map((material) => [material.id, material])), [materials]);
  const variantById = useMemo(() => new Map(variants.map((variant) => [variant.id, variant])), [variants]);
  const availableDestinationBases = bases.filter((base) => base.id !== selectedBaseId);
  const draftLotIds = new Set(draft.map((item) => item.lot_id));
  const selectedLot = lots.find((lot) => lot.id === selectedLotId);
  const draftQuantity = Number(lineQuantity);

  function lotLabel(lot: Lot) {
    const material = materialById.get(lot.material_id)?.name ?? "Material";
    const variant = lot.variant_id ? variantById.get(lot.variant_id) : null;
    return `${material}${variant ? ` · ${variant.size || variant.name}` : ""} · Lote ${lot.lot_number}${lot.ca_number ? ` · CA ${lot.ca_number}` : ""} · ${lot.available_quantity} disponível(is)`;
  }

  function addDraftItem() {
    if (!selectedLot || !Number.isInteger(draftQuantity) || draftQuantity <= 0 || draftQuantity > Number(selectedLot.available_quantity) || draftLotIds.has(selectedLot.id)) return;
    setDraft((current) => [...current, { lot_id: selectedLot.id, quantity: String(draftQuantity) }]);
    setSelectedLotId("");
    setLineQuantity("1");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !selectedBaseId || !destinationBaseId || !draft.length) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const { error: transferError } = await createClient().rpc("create_stock_transfer", {
        p_source_base_id: selectedBaseId,
        p_destination_base_id: destinationBaseId,
        p_items: draft.map((item) => ({ lot_id: item.lot_id, quantity: Number(item.quantity) })),
        p_notes: notes.trim() || null,
      });
      if (transferError) throw transferError;
      setSuccess("Transferência registrada. O saldo sairá da disponibilidade de origem e ficará em trânsito até o recebimento.");
      setDraft([]); setNotes(""); setDestinationBaseId("");
      window.dispatchEvent(new Event("stock-transfer-updated"));
      await load();
    } catch (caught) { setError(friendlyError(caught, "Não foi possível registrar a transferência.")); }
    finally { setSaving(false); }
  }

  async function runTransferAction(transfer: TransferHeader, action: "receive" | "cancel") {
    setBusyId(transfer.id); setError(""); setSuccess("");
    try {
      const { error: actionError } = await createClient().rpc(action === "receive" ? "receive_stock_transfer" : "cancel_stock_transfer", { p_transfer_id: transfer.id });
      if (actionError) throw actionError;
      setSuccess(action === "receive" ? "Recebimento confirmado. O saldo agora está disponível nesta base." : "Transferência cancelada e saldo restaurado na origem.");
      window.dispatchEvent(new Event("stock-transfer-updated"));
      await load();
    } catch (caught) { setError(friendlyError(caught, action === "receive" ? "Não foi possível confirmar o recebimento." : "Não foi possível cancelar a transferência.")); }
    finally { setBusyId(""); }
  }

  return <main className="module-shell transfers-page">
    <header className="module-header"><div><p className="eyebrow">MOVIMENTAÇÃO DE ESTOQUE</p><h1>Transferências entre bases</h1><p className="module-subtitle">Envie materiais com rastreio de lote e CA; o estoque de destino é liberado após a conferência e confirmação.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Atualizar</button></header>
    {success && <FeedbackMessage kind="success">{success}</FeedbackMessage>}
    {(error || basesError) && <FeedbackMessage onRetry={() => void load()}>{error || basesError}</FeedbackMessage>}
    {basesLoading || loading ? <section className="panel module-loading"><LoaderCircle className="spin" size={22} /> Carregando bases e transferências…</section> : <>
      <section className="panel transfer-form-panel">
        <div className="panel-header"><div><h2>Enviar materiais</h2><p>O material permanece rastreável e não pode ser entregue ao colaborador no destino antes da confirmação.</p></div><span className="transfer-icon"><ArrowLeftRight size={20} /></span></div>
        <form className="material-form" onSubmit={submit}>
          <div className="form-grid three">
            <BaseSelect bases={accessibleBases} value={selectedBaseId} onChange={(baseId) => { chooseBase(baseId); setDraft([]); setSelectedLotId(""); }} label="Base de origem" />
            <label>Base de destino<select value={destinationBaseId} onChange={(event) => setDestinationBaseId(event.target.value)} required><option value="">Selecione a base de destino</option>{availableDestinationBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label>
            <label>Lote e material<select value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)}><option value="">Selecione um lote disponível</option>{lots.filter((lot) => !draftLotIds.has(lot.id)).map((lot) => <option key={lot.id} value={lot.id}>{lotLabel(lot)}</option>)}</select></label>
          </div>
          <div className="transfer-add-row"><label>Quantidade<input type="number" min="1" max={selectedLot?.available_quantity} step="1" value={lineQuantity} onChange={(event) => setLineQuantity(event.target.value)} disabled={!selectedLot} /></label><button type="button" className="secondary-button" onClick={addDraftItem} disabled={!selectedLot || !Number.isInteger(draftQuantity) || draftQuantity <= 0 || draftQuantity > Number(selectedLot.available_quantity)}><Plus size={16} /> Adicionar lote</button></div>
          {draft.length > 0 && <div className="transfer-draft-list"><h3>Itens para envio</h3>{draft.map((item) => { const lot = lots.find((candidate) => candidate.id === item.lot_id); return lot ? <div className="transfer-draft-row" key={item.lot_id}><span><strong>{lotLabel(lot)}</strong><small>{lot.ca_expires_at ? `Validade do CA: ${new Date(`${lot.ca_expires_at}T00:00:00`).toLocaleDateString("pt-BR")}` : "CA sem validade registrada"}{lot.test_number ? ` · Ensaio ${lot.test_number}${lot.test_expires_at ? ` válido até ${new Date(`${lot.test_expires_at}T00:00:00`).toLocaleDateString("pt-BR")}` : ""}` : ""}</small></span><label>Qtd.<input type="number" min="1" max={lot.available_quantity} step="1" value={item.quantity} onChange={(event) => setDraft((current) => current.map((line) => line.lot_id === item.lot_id ? { ...line, quantity: event.target.value } : line))} /></label><button type="button" className="remove-item" aria-label="Remover lote" onClick={() => setDraft((current) => current.filter((line) => line.lot_id !== item.lot_id))}><X size={17} /></button></div> : null; })}</div>}
          <label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="Ex.: veículo, responsável pelo transporte, previsão de chegada" /></label>
          <div className="modal-actions"><button className="primary-button" disabled={saving || !selectedBaseId || !destinationBaseId || !draft.length || draft.some((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || Number(item.quantity) > Number(lots.find((lot) => lot.id === item.lot_id)?.available_quantity ?? 0))}>{saving ? "Registrando envio…" : "Registrar envio"}<Send size={16} /></button></div>
        </form>
      </section>

      <section className="panel module-table-card transfer-history-panel">
        <div className="panel-header"><div><h2>Histórico de transferências</h2><p>Registros das bases às quais você tem acesso, incluindo materiais em trânsito aguardando conferência.</p></div><span className="pending-count">{transfers.length}</span></div>
        {!transfers.length ? <div className="empty-state"><PackageCheck size={26} /><strong>Nenhuma transferência encontrada</strong><span>Os envios e recebimentos entre bases aparecerão aqui.</span></div> : <div className="transfer-history-list">{transfers.map((transfer) => {
          const source = bases.find((base) => base.id === transfer.source_base_id)?.name ?? "Base de origem";
          const destination = bases.find((base) => base.id === transfer.destination_base_id)?.name ?? "Base de destino";
          const lines = transferItems.filter((item) => item.transfer_id === transfer.id);
          const canReceive = transfer.status === "in_transit" && accessibleBases.some((base) => base.id === transfer.destination_base_id);
          const canCancel = transfer.status === "in_transit" && accessibleBases.some((base) => base.id === transfer.source_base_id);
          return <article className="transfer-history-card" key={transfer.id}><div className="transfer-history-heading"><div><strong>{source} <ArrowLeftRight size={14} /> {destination}</strong><small>Enviada em {new Date(transfer.shipped_at).toLocaleString("pt-BR")}{transfer.received_at ? ` · Recebida em ${new Date(transfer.received_at).toLocaleString("pt-BR")}` : ""}</small></div><span className={`status-pill ${transfer.status === "received" ? "success" : transfer.status === "cancelled" ? "danger" : "warning"}`}>{statusLabels[transfer.status]}</span></div><ul>{lines.map((item) => { const variant = item.variant_id ? variantById.get(item.variant_id) : null; return <li key={item.id}>{item.quantity}× {materialById.get(item.material_id)?.name ?? "Material"}{variant ? ` · ${variant.size || variant.name}` : ""}</li>; })}</ul>{transfer.notes && <p>{transfer.notes}</p>}{(canReceive || canCancel) && <div className="transfer-history-actions">{canReceive && <button type="button" className="primary-button" onClick={() => void runTransferAction(transfer, "receive")} disabled={Boolean(busyId)}>{busyId === transfer.id ? "Processando…" : "Confirmar recebimento"}<Check size={15} /></button>}{canCancel && <button type="button" className="secondary-button" onClick={() => void runTransferAction(transfer, "cancel")} disabled={Boolean(busyId)}>{busyId === transfer.id ? "Processando…" : "Cancelar envio"}<X size={15} /></button>}</div>}</article>;
        })}</div>}
      </section>
    </>}
  </main>;
}
