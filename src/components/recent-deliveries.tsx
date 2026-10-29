"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, Check, ClipboardList, LoaderCircle, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { FeedbackMessage } from "@/components/feedback-message";
import { TermCopyLinkButton } from "@/components/term-copy-link-button";
import { TermDocumentActions } from "@/components/term-document-actions";
import type { DeliveryTermSnapshot } from "@/components/delivery-term-print-sheet";

type DeliveryUnit = {
  unit_identifier: string;
  valid_until: string | null;
  test_performed_at: string | null;
  test_number: string | null;
  test_report_number: string | null;
  ca_number: string | null;
  ca_expires_at: string | null;
};

type Employee = {
  full_name: string;
  registration: string | null;
  department: string | null;
  job_title: string | null;
  function_name: string | null;
  admission_date: string | null;
  termination_date: string | null;
  status: string;
} | null;

type Delivery = {
  id: string;
  base_id: string;
  delivered_at: string;
  reason: string;
  notes: string | null;
  term_file_path: string | null;
  term_uploaded_at: string | null;
  term_signature_method: string | null;
  term_signed_at: string | null;
  employee: Employee;
  delivery_items: Array<{
    quantity: number;
    test_performed_at: string | null;
    test_expires_at: string | null;
    expected_replacement_at: string | null;
    material: { name: string; unit: string; internal_code: string | null } | null;
    variant: { name: string; size: string | null } | null;
    lot: { ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; test_expires_at: string | null } | null;
    material_units: DeliveryUnit[];
  }>;
};

type Organization = {
  name: string;
  logo_url: string | null;
  cnpj: string | null;
  address: string | null;
  phone: string | null;
};

const reasons: Record<string, string> = {
  admission: "Admissão",
  periodic_change: "Troca periódica",
  damaged: "Equipamento danificado",
  lost: "Equipamento perdido",
  role_change: "Alteração de função",
  replacement: "Substituição",
  other: "Outro",
};

function date(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

function buildPrintSnapshot(delivery: Delivery, organization: Organization | null, responsibleName: string): DeliveryTermSnapshot {
  return {
    type: "delivery",
    pre_delivery_signature: false,
    organization_name: organization?.name || "Organização",
    organization_logo_url: organization?.logo_url,
    organization_cnpj: organization?.cnpj,
    organization_address: organization?.address,
    organization_phone: organization?.phone,
    responsible_name: responsibleName || null,
    employee_name: delivery.employee?.full_name || "Colaborador",
    employee_registration: delivery.employee?.registration ?? null,
    employee_function: delivery.employee?.job_title || delivery.employee?.function_name || null,
    employee_department: delivery.employee?.department,
    employee_admission_date: delivery.employee?.admission_date,
    employee_termination_date: delivery.employee?.status === "terminated" ? delivery.employee.termination_date : null,
    date: delivery.delivered_at,
    reason: delivery.reason,
    notes: delivery.notes,
    items: delivery.delivery_items.map((item) => {
      const caUnit = item.material_units.find((unit) => unit.ca_number);
      return {
        material: item.material?.name || "Material",
        code: item.material?.internal_code,
        unit: item.material?.unit || "un.",
        quantity: item.quantity,
        size: item.variant?.size || item.variant?.name || null,
        ca_number: item.lot?.ca_number || caUnit?.ca_number || null,
        ca_expires_at: item.lot?.ca_expires_at || caUnit?.ca_expires_at || null,
        expected_replacement_at: item.expected_replacement_at,
        units: item.material_units.map((unit) => ({
          identifier: unit.unit_identifier,
          test_number: unit.test_number || item.lot?.test_number || null,
          test_report_number: unit.test_report_number || item.lot?.test_report_number || null,
          test_performed_at: unit.test_performed_at || item.test_performed_at || item.lot?.test_performed_at || null,
          test_expires_at: item.test_expires_at || item.lot?.test_expires_at || null,
          ca_number: unit.ca_number,
          ca_expires_at: unit.ca_expires_at,
        })),
      };
    }),
  };
}

export function RecentDeliveries({ onPrintTerm }: { onPrintTerm: (snapshot: DeliveryTermSnapshot) => Promise<void> }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [baseNames, setBaseNames] = useState<Record<string, string>>({});
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [responsibleName, setResponsibleName] = useState("");
  const [preparingId, setPreparingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const requestRef = useRef(0);
  const preparingRef = useRef("");

  useEffect(() => {
    let active = true;

    async function load() {
      const requestId = ++requestRef.current;
      setLoading(true);
      setError("");
      setDeliveries([]);
      setOrganization(null);
      setResponsibleName("");

      try {
        const supabase = createClient();
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw authError ?? new Error("Sua sessão expirou. Entre novamente.");

        const [{ data, error: loadError }, { data: profile, error: profileError }, { data: bases, error: basesError }] = await Promise.all([
          supabase.from("deliveries").select("id,base_id,delivered_at,reason,notes,term_file_path,term_uploaded_at,term_signature_method,term_signed_at,employee:employees(full_name,registration,department,job_title,function_name,admission_date,termination_date,status),delivery_items(quantity,test_performed_at,test_expires_at,expected_replacement_at,material:materials(name,unit,internal_code),variant:material_variants(name,size),lot:material_lots(ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),material_units(unit_identifier,valid_until,test_performed_at,test_number,test_report_number,ca_number,ca_expires_at))").order("delivered_at", { ascending: false }).order("created_at", { ascending: false }).limit(10),
          supabase.from("profiles").select("organization_id,full_name").eq("id", auth.user.id).maybeSingle(),
          supabase.from("organization_bases").select("id,name"),
        ]);

        if (!active || requestId !== requestRef.current) return;
        if (loadError || profileError || basesError) throw loadError ?? profileError ?? basesError;

        setDeliveries((data ?? []) as unknown as Delivery[]);
        setBaseNames(Object.fromEntries((bases ?? []).map((base) => [base.id, base.name])));
        setResponsibleName(profile?.full_name ?? "");

        if (profile?.organization_id) {
          const { data: organizationData, error: organizationError } = await supabase
            .from("organizations")
            .select("name,logo_url,cnpj,address,phone")
            .eq("id", profile.organization_id)
            .maybeSingle();
          if (!active || requestId !== requestRef.current) return;
          if (organizationError) throw organizationError;
          setOrganization(organizationData as Organization | null);
        }
      } catch (caught) {
        if (active && requestId === requestRef.current) setError(friendlyError(caught, "Não foi possível carregar as entregas."));
      } finally {
        if (active && requestId === requestRef.current) setLoading(false);
      }
    }

    const refresh = () => void load();
    refresh();
    window.addEventListener("delivery-created", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      requestRef.current += 1;
      window.removeEventListener("delivery-created", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [retryKey]);

  async function printUnsignedTerm(delivery: Delivery) {
    if (preparingRef.current) return;
    preparingRef.current = delivery.id;
    setPreparingId(delivery.id);
    setError("");
    try {
      await onPrintTerm(buildPrintSnapshot(delivery, organization, responsibleName));
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível preparar a ficha para impressão."));
    } finally {
      preparingRef.current = "";
      setPreparingId("");
    }
  }

  return (
    <section className="panel recent-deliveries-card">
      <div className="panel-header no-print">
        <div><p className="eyebrow">MOVIMENTAÇÃO DE EQUIPAMENTOS</p><h2>Últimas entregas</h2><p>Entregas realizadas recentemente para os colaboradores.</p></div>
        <ClipboardList size={21} aria-hidden="true" />
      </div>

      {loading ? (
        <div className="module-loading no-print" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} aria-hidden="true" /> Carregando histórico...</div>
      ) : error ? (
        <FeedbackMessage onRetry={() => setRetryKey((current) => current + 1)}>{error}</FeedbackMessage>
      ) : deliveries.length ? (
        <div className="recent-delivery-list no-print" role="list" aria-label="Últimas entregas">
          {deliveries.map((delivery) => {
            const hasDocument = Boolean(delivery.term_file_path);
            const signed = Boolean(delivery.term_signed_at);
            const employeeName = delivery.employee?.full_name || "Colaborador";

            return (
              <article className="recent-delivery-item" key={delivery.id} role="listitem">
                <div className="recent-delivery-icon"><UserRound size={17} aria-hidden="true" /></div>
                <div className="recent-delivery-main">
                  <strong>{employeeName}</strong>
                  <small>{delivery.employee?.registration ? `Matrícula ${delivery.employee.registration} · ` : ""}{date(delivery.delivered_at)} · {reasons[delivery.reason] || delivery.reason} · {baseNames[delivery.base_id] || "Base não identificada"}</small>
                  <div className="recent-delivery-materials" aria-label="Materiais entregues">
                    {delivery.delivery_items.map((item, index) => (
                      <span key={`${delivery.id}-${index}`}>
                        <strong>{item.quantity}x {item.material?.name || "Material"}</strong>
                        {item.material_units.map((unit) => <small key={unit.unit_identifier}>Identificador: {unit.unit_identifier}{unit.valid_until ? ` · válido até ${date(unit.valid_until)}` : ""}</small>)}
                      </span>
                    ))}
                  </div>
                  <span className={`delivery-term-status ${hasDocument || signed ? "complete" : "pending"}`}>
                    {hasDocument ? <><Check size={12} aria-hidden="true" /> {delivery.term_signature_method === "physical_upload" ? "Assinado fisicamente" : delivery.term_signature_method === "assisted" ? "Assinado no aparelho" : "Documento assinado/anexado"}</> : signed ? <><Check size={12} aria-hidden="true" /> Assinado · arquivo indisponível</> : "Termo pendente de assinatura"}
                  </span>
                </div>

                <div className="recent-delivery-actions">
                  {hasDocument && <TermDocumentActions path={delivery.term_file_path!} employeeName={employeeName} />}
                  {!hasDocument && !signed && <>
                    <button type="button" className="action-button" onClick={() => void printUnsignedTerm(delivery)} disabled={preparingId === delivery.id} aria-busy={preparingId === delivery.id}>
                      {preparingId === delivery.id ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}
                      {preparingId === delivery.id ? "Preparando ficha..." : "Imprimir / salvar ficha em PDF"}
                    </button>
                    <TermCopyLinkButton recordType="delivery" recordId={delivery.id} />
                  </>}
                </div>
                <CalendarClock size={17} className="recent-delivery-date" aria-hidden="true" />
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state no-print"><ClipboardList size={27} aria-hidden="true" /><strong>Nenhuma entrega registrada</strong><span>As entregas confirmadas aparecerão aqui.</span></div>
      )}
    </section>
  );
}
