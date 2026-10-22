"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, Check, Download, Eye, LoaderCircle, PackageCheck, Printer, ShieldCheck, Upload } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/ui-feedback";
import { closePendingDownload, finishPendingDownload, openPendingDownload } from "@/lib/external-download";
import { EmployeeNavigation } from "@/components/employee-navigation";
import { DeliverySignatureModal } from "@/components/delivery-signature-modal";
import { ReturnSignatureModal } from "@/components/return-signature-modal";
import { FeedbackMessage } from "@/components/feedback-message";
import { DeliveryTermPrintSheet, type DeliveryTermSnapshot } from "@/components/delivery-term-print-sheet";
import { TermCopyLinkButton } from "@/components/term-copy-link-button";
import { TermDocumentActions } from "@/components/term-document-actions";
import { createReturnTermDocument, type ReturnTermItem } from "@/lib/return-term-document";

type Organization = { name: string; cnpj: string | null; logo_url: string | null; address: string | null; phone: string | null };
type Employee = { id: string; registration: string | null; full_name: string; cpf: string; job_title: string | null; function_name: string | null; function_classification: string | null; department: string | null; unit: string | null; admission_date: string | null; termination_date: string | null; status: "active" | "away" | "terminated"; organization: Organization | null };
type MaterialUnit = { unit_identifier: string; delivered_at: string | null; valid_until: string | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null };
type Item = { id: string; quantity: number; returned: number; expected_replacement_at: string | null; test_performed_at: string | null; test_expires_at: string | null; material: { name: string; internal_code: string | null; unit: string; type: string } | null; variant: { name: string; size: string | null } | null; lot: { lot_number: string; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; test_expires_at: string | null } | null; units: MaterialUnit[]; delivery: { id: string; delivered_at: string; reason: string; notes: string | null; term_file_path: string | null; term_uploaded_at: string | null; term_signature_method: string | null; term_signed_at: string | null } | null };
type Course = { id: string; name: string; provider: string | null; expires_at: string | null };
type ReturnSheetItem = {
  quantity: number;
  material: { name: string; unit: string } | null;
  variant: { name: string; size: string | null } | null;
  delivered_at: string | null;
  lot_number: string | null;
  ca_number: string | null;
  ca_expires_at: string | null;
  test_number: string | null;
  test_report_number: string | null;
  test_performed_at: string | null;
  test_expires_at: string | null;
  units?: Array<{ unit_identifier: string | null; ca_number: string | null; ca_expires_at: string | null; test_number: string | null; test_report_number: string | null; test_performed_at: string | null; test_expires_at: string | null }>;
  condition: string | null;
  destination: string | null;
  incident_type: string | null;
  incident_description: string | null;
  deduction_amount: number | null;
};
type ReturnSheet = { id: string; returned_at: string; reason: string; notes: string | null; responsible_name: string | null; term_file_path: string | null; term_signature_method: string | null; term_signed_at: string | null; term_signer_name: string | null; term_signer_cpf: string | null; items: ReturnSheetItem[] };

function toReturnTermItem(item: ReturnSheetItem): ReturnTermItem {
  const uniqueUnitValue = (key: "ca_number" | "ca_expires_at" | "test_number" | "test_report_number" | "test_performed_at" | "test_expires_at") => [...new Set((item.units ?? []).map((unit) => unit[key]).filter(Boolean))].join(", ") || null;
  return {
    material: item.material?.name || "Material", unit: item.material?.unit || "un.", quantity: item.quantity,
    size: item.variant?.size || item.variant?.name, delivered_at: item.delivered_at, lot_number: item.lot_number,
    ca_number: item.ca_number || uniqueUnitValue("ca_number"), ca_expires_at: item.ca_expires_at || uniqueUnitValue("ca_expires_at"), test_number: item.test_number || uniqueUnitValue("test_number"),
    test_report_number: item.test_report_number || uniqueUnitValue("test_report_number"), test_performed_at: item.test_performed_at || uniqueUnitValue("test_performed_at"), test_expires_at: item.test_expires_at || uniqueUnitValue("test_expires_at"),
    condition: item.condition, destination: item.destination, incident_type: item.incident_type,
    incident_description: item.incident_description, deduction_amount: item.deduction_amount,
  };
}

const reasonLabels: Record<string, string> = { admission: "Admissão", periodic_change: "Troca periódica", damaged: "Equipamento danificado", lost: "Equipamento perdido", role_change: "Alteração de função", replacement: "Substituição", other: "Outro" };
function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? "Data inválida" : parsed.toLocaleDateString("pt-BR");
}
function epiCaDetails(item: Item) {
  const unitDetails = item.units.flatMap((unit) => [
    unit.ca_number ? `CA ${unit.ca_number}${unit.ca_expires_at ? ` · validade ${date(unit.ca_expires_at)}` : ""}` : "",
    unit.test_number ? `Ensaio ${unit.test_number}` : "",
    unit.test_report_number ? `Laudo ${unit.test_report_number}` : "",
    unit.test_performed_at ? `realizado ${date(unit.test_performed_at)}` : "",
  ].filter(Boolean));
  const certificate = item.lot?.ca_number
    ? `CA ${item.lot.ca_number}${item.lot.ca_expires_at ? ` · validade ${date(item.lot.ca_expires_at)}` : ""}`
    : "";
  const lotTestDetails = [
    item.lot?.test_number ? `Ensaio ${item.lot.test_number}` : "",
    item.lot?.test_report_number ? `Laudo ${item.lot.test_report_number}` : "",
    item.test_performed_at || item.lot?.test_performed_at ? `realizado ${date(item.test_performed_at || item.lot?.test_performed_at || null)}` : "",
    item.test_expires_at || item.lot?.test_expires_at ? `ensaio válido até ${date(item.test_expires_at || item.lot?.test_expires_at || null)}` : "",
  ];
  const details = [...new Set([...unitDetails, ...lotTestDetails, certificate].filter(Boolean))];
  if (details.length) return details.join("; ");
  return item.material?.type === "EPI" ? "Não informado" : "Não se aplica";
}
function replacementStatus(value: string | null) {
  if (!value) return { label: "Sem previsão", tone: "neutral" };
  const replacementDate = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(replacementDate.getTime())) return { label: "Data inválida", tone: "danger" };
  const days = Math.ceil((replacementDate.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days < 0) return { label: "Troca vencida", tone: "danger" };
  if (days <= 30) return { label: "Troca próxima", tone: "warning" };
  return { label: "Em dia", tone: "success" };
}

function EmployeeTermActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", closeWhenOutside);
    return () => document.removeEventListener("mousedown", closeWhenOutside);
  }, [open]);
  return <div className="employee-term-menu" ref={menuRef}><button type="button" className="action-button employee-term-menu-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open}>Ações do termo</button>{open && <div className="employee-term-menu-panel">{children}</div>}</div>;
}

export default function EmployeeMaterialsPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [returnSheets, setReturnSheets] = useState<ReturnSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadingId, setUploadingId] = useState("");
  const [deliveryPrintSnapshot, setDeliveryPrintSnapshot] = useState<DeliveryTermSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setEmployee(null);
      setItems([]);
      setCourses([]);
      setReturnSheets([]);
      try {
      const supabase = createClient();
      const [{ data: employeeData, error: employeeError }, { data: deliveryData, error: deliveryError }, { data: courseData, error: courseError }, { data: returnData, error: returnError }] = await Promise.all([
        supabase.from("employees").select("id,registration,full_name,cpf,job_title,function_name,function_classification,department,unit,admission_date,termination_date,status,organization:organizations(name,cnpj,logo_url,address,phone)").eq("id", id).single(),
        supabase.from("delivery_items").select("id,quantity,expected_replacement_at,test_performed_at,test_expires_at,materials(name,internal_code,unit,type),material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),variant:material_variants(name,size),material_units(unit_identifier,delivered_at,valid_until,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at),deliveries!inner(id,delivered_at,reason,notes,employee_id,term_file_path,term_uploaded_at,term_signature_method,term_signed_at),return_items(quantity,destination,return:returns(term_signed_at))").eq("deliveries.employee_id", id).order("created_at", { ascending: false }),
        supabase.from("employee_courses").select("id,name,provider,expires_at").eq("employee_id", id).order("expires_at", { ascending: true, nullsFirst: false }),
        supabase.from("returns").select("id,returned_at,reason,notes,term_file_path,term_signature_method,term_signed_at,term_signer_name,term_signer_cpf,return_accountability(responsible_name),return_items(quantity,equipment_condition,destination,incident_type,incident_description,deduction_requested,deduction_amount,material:materials(name,unit),delivery_item:delivery_items(variant:material_variants(name,size),delivery:deliveries(delivered_at),lot:material_lots(lot_number,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at),units:material_units(unit_identifier,ca_number,ca_expires_at,test_number,test_report_number,test_performed_at,test_expires_at)))").eq("employee_id", id).order("returned_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (employeeError || deliveryError || courseError || returnError) setError(friendlyError(employeeError ?? deliveryError ?? courseError ?? returnError, "Não foi possível carregar a ficha."));
      setEmployee(employeeData as unknown as Employee);
      setCourses((courseData ?? []) as Course[]);
      setReturnSheets(((returnData ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), returned_at: String(row.returned_at), reason: String(row.reason), notes: row.notes as string | null,
        term_file_path: row.term_file_path as string | null, term_signature_method: row.term_signature_method as string | null,
        term_signed_at: row.term_signed_at as string | null, term_signer_name: row.term_signer_name as string | null, term_signer_cpf: row.term_signer_cpf as string | null,
        responsible_name: ((row.return_accountability as Record<string, unknown> | null)?.responsible_name as string | null) ?? null,
        items: ((row.return_items ?? []) as Array<Record<string, unknown>>).map((item) => {
          const material = item.material as { name: string; unit: string } | null;
          const deliveryItem = item.delivery_item as Record<string, unknown> | null;
          const variant = deliveryItem?.variant as { name: string; size: string | null } | null;
          const delivery = deliveryItem?.delivery as { delivered_at: string } | null;
          const lot = deliveryItem?.lot as Record<string, unknown> | null;
          const units = (deliveryItem?.units ?? []) as ReturnSheetItem["units"];
          return {
            material, variant, quantity: Number(item.quantity),
            delivered_at: delivery?.delivered_at || null, lot_number: (lot?.lot_number as string | null) || null,
            ca_number: (lot?.ca_number as string | null) || null, ca_expires_at: (lot?.ca_expires_at as string | null) || null,
            test_number: (lot?.test_number as string | null) || null, test_report_number: (lot?.test_report_number as string | null) || null,
            test_performed_at: (lot?.test_performed_at as string | null) || null, test_expires_at: (lot?.test_expires_at as string | null) || null,
            units,
            condition: String(item.equipment_condition || ""), destination: String(item.destination || ""), incident_type: String(item.incident_type || "normal"),
            incident_description: item.incident_description as string | null, deduction_amount: item.deduction_requested ? Number(item.deduction_amount) : null,
          };
        }),
      })));
      setItems(((deliveryData ?? []) as unknown[]).map((row) => {
        const value = row as Record<string, unknown>;
        const units = (value.material_units ?? []) as MaterialUnit[];
        const material = value.materials as Item["material"];

        return { id: String(value.id), quantity: Number(value.quantity), returned: ((value.return_items ?? []) as Array<Record<string, unknown>>).reduce((total, item) => { const signed = Boolean((item.return as Record<string, unknown> | null)?.term_signed_at); return total + (item.destination === "not_returned" && !signed ? 0 : Number(item.quantity || 0)); }, 0), expected_replacement_at: value.expected_replacement_at as string | null, test_performed_at: value.test_performed_at as string | null, test_expires_at: value.test_expires_at as string | null, material, variant: value.variant as Item["variant"], lot: value.material_lots as Item["lot"], units, delivery: value.deliveries as Item["delivery"] };
      }));
      } catch (caught) {
        if (!cancelled) setError(friendlyError(caught, "Não foi possível carregar a ficha."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  const summary = useMemo(() => {
    const totalQuantity = items.reduce((total, item) => total + item.quantity, 0);
    const pending = items.filter((item) => replacementStatus(item.expected_replacement_at).tone !== "success" && item.expected_replacement_at).length;
    return { totalQuantity, pending };
  }, [items]);
  const currentItems = useMemo(() => items.filter((item) => item.quantity > item.returned), [items]);
  const epiSheetRows = useMemo(() => [...items].sort((first, second) => (first.delivery?.delivered_at ?? "").localeCompare(second.delivery?.delivered_at ?? "")), [items]);

  const deliverySheets = useMemo(() => {
    const grouped = new Map<string, { id: string; delivered_at: string; reason: string; notes: string | null; term_file_path: string | null; term_uploaded_at: string | null; term_signature_method: string | null; term_signed_at: string | null; items: number; materials: Item[] }>();
    items.forEach((item) => {
      if (!item.delivery) return;
      const current = grouped.get(item.delivery.id) ?? { ...item.delivery, items: 0, materials: [] };
      current.items += item.quantity;
      current.materials.push(item);
      grouped.set(item.delivery.id, current);
    });
    return [...grouped.values()].sort((first, second) => second.delivered_at.localeCompare(first.delivered_at));
  }, [items]);

  const safeFileName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  async function printEpiSheet() {
    const logos = Array.from(document.querySelectorAll<HTMLImageElement>(".employee-epi-brand img"));
    await Promise.all(logos.map((logo) => logo.decode().catch(() => undefined)));
    window.print();
  }

  async function printDeliveryTerm(sheet: (typeof deliverySheets)[number]) {
    if (!employee) return;
    const organization = employee.organization;
    const snapshot: DeliveryTermSnapshot = {
      type: "delivery",
      pre_delivery_signature: false,
      organization_name: organization?.name || "DSX",
      organization_logo_url: organization?.logo_url,
      organization_cnpj: organization?.cnpj,
      organization_address: organization?.address,
      organization_phone: organization?.phone,
      responsible_name: null,
      employee_name: employee.full_name,
      employee_registration: employee.registration,
      employee_function: employee.function_name || employee.job_title,
      employee_department: employee.department,
      employee_admission_date: employee.admission_date,
      employee_termination_date: employee.status === "terminated" ? employee.termination_date : null,
      date: sheet.delivered_at,
      reason: sheet.reason,
      notes: sheet.notes,
      items: sheet.materials.map((item) => ({
        material: item.material?.name || "Material",
        code: item.material?.internal_code,
        unit: item.material?.unit || "un.",
        quantity: item.quantity,
        size: item.variant?.size || item.variant?.name || null,
        ca_number: item.lot?.ca_number || item.units.find((unit) => unit.ca_number)?.ca_number || null,
        ca_expires_at: item.lot?.ca_expires_at || item.units.find((unit) => unit.ca_expires_at)?.ca_expires_at || null,
        expected_replacement_at: item.expected_replacement_at,
        units: item.units.map((unit) => ({
          identifier: unit.unit_identifier,
          ca_number: unit.ca_number,
          ca_expires_at: unit.ca_expires_at,
          test_number: unit.test_number || item.lot?.test_number || null,
          test_report_number: unit.test_report_number || item.lot?.test_report_number || null,
          test_performed_at: unit.test_performed_at || item.test_performed_at || item.lot?.test_performed_at || null,
          test_expires_at: item.test_expires_at || item.lot?.test_expires_at || null,
        })),
      })),
    };
    setDeliveryPrintSnapshot(snapshot);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    const logo = document.querySelector<HTMLImageElement>(".pending-delivery-print img");
    if (logo) await logo.decode().catch(() => undefined);
    window.addEventListener("afterprint", () => setDeliveryPrintSnapshot(null), { once: true });
    window.print();
  }

  async function uploadTerm(sheet: (typeof deliverySheets)[number], event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError("Anexe um PDF, JPG, PNG ou WEBP."); return; } if (file.size > 10 * 1024 * 1024) { setError("O arquivo do termo deve ter no máximo 10 MB."); return; }
    setUploadingId(sheet.id); setError("");
    let uploadedPath = "";
    let supabase: ReturnType<typeof createClient> | null = null;
    try {
    supabase = createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); return; }
    const { data: profileData, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profileData?.organization_id) { setError(friendlyError(profileError, "Não foi possível identificar a organização.")); return; }
    const path = `${profileData.organization_id}/${sheet.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    uploadedPath = path;
    const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setError(friendlyError(uploadError, "Não foi possível enviar o arquivo.")); return; }
    const uploadedAt = new Date().toISOString();
    const { data: updatedDelivery, error: updateError } = await supabase.from("deliveries").update({ term_file_path: path, term_uploaded_at: uploadedAt, term_uploaded_by: auth.user.id, term_signature_method: "physical_upload", term_signed_at: uploadedAt, term_signer_name: employee!.full_name, term_signer_cpf: employee!.cpf }).eq("id", sheet.id).select("id").maybeSingle();
    if (updateError || !updatedDelivery) { setError(friendlyError(updateError, "Não foi possível atualizar o termo. Verifique se você ainda tem permissão para esta ficha.")); } else {
      uploadedPath = "";
      if (sheet.term_file_path) await supabase.storage.from("delivery-terms").remove([sheet.term_file_path]);
      setItems((current) => current.map((item) => item.delivery?.id === sheet.id ? { ...item, delivery: item.delivery ? { ...item.delivery, term_file_path: path, term_uploaded_at: uploadedAt, term_signature_method: "physical_upload", term_signed_at: uploadedAt } : item.delivery } : item));
    }
    setUploadingId("");
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível concluir a operação."));
    } finally {
      if (uploadedPath && supabase) { try { await supabase.storage.from("delivery-terms").remove([uploadedPath]); } catch {} }
      setUploadingId("");
    }
  }

  function downloadTerm(sheet: (typeof deliverySheets)[number]) {
    void printDeliveryTerm(sheet);
  }

  async function uploadReturnTerm(sheet: ReturnSheet, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Anexe um PDF, JPG, PNG ou WEBP."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("O arquivo do termo deve ter no máximo 10 MB."); return; }
    setUploadingId(sheet.id); setError(""); let uploadedPath = ""; let supabase: ReturnType<typeof createClient> | null = null; try { supabase = createClient(); const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) { setError(friendlyError(authError, "Sua sessão expirou. Entre novamente.")); return; } const { data: profileData, error: profileError } = await supabase.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
    if (profileError || !profileData?.organization_id) { setError(friendlyError(profileError, "Não foi possível identificar a organização.")); return; }
    const path = `${profileData.organization_id}/${sheet.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    uploadedPath = path;
    const { error: uploadError } = await supabase.storage.from("delivery-terms").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setError(friendlyError(uploadError, "Não foi possível enviar o arquivo.")); return; }
    const uploadedAt = new Date().toISOString(); const { data: updatedReturn, error: updateError } = await supabase.from("returns").update({ term_file_path: path, term_uploaded_at: uploadedAt, term_uploaded_by: auth.user.id, term_signature_method: "physical_upload", term_signed_at: uploadedAt, term_signer_name: employee!.full_name, term_signer_cpf: employee!.cpf }).eq("id", sheet.id).select("id").maybeSingle();
    if (updateError || !updatedReturn) { setError(friendlyError(updateError, "Não foi possível atualizar o termo. Verifique se você ainda tem permissão para esta ficha.")); return; }
    uploadedPath = "";
    if (sheet.term_file_path) await supabase.storage.from("delivery-terms").remove([sheet.term_file_path]);
    setReturnSheets((current) => current.map((item) => item.id === sheet.id ? { ...item, term_file_path: path, term_signature_method: "physical_upload", term_signed_at: uploadedAt } : item)); setUploadingId("");
    } catch (caught) {
      setError(friendlyError(caught, "Não foi possível concluir a operação."));
    } finally {
      if (uploadedPath && supabase) { try { await supabase.storage.from("delivery-terms").remove([uploadedPath]); } catch {} }
      setUploadingId("");
    }
  }

  async function downloadReturnTerm(sheet: ReturnSheet) {
    if (!employee) return;
    if (sheet.term_signed_at && sheet.term_file_path) {
      const { data: signedFile, error: signedUrlError } = await createClient().storage.from("delivery-terms").createSignedUrl(sheet.term_file_path, 60);
      if (signedUrlError || !signedFile?.signedUrl) { setError(friendlyError(signedUrlError, "Não foi possível baixar o termo assinado.")); return; }
      try {
        const response = await fetch(signedFile.signedUrl);
        if (!response.ok) throw new Error("Não foi possível baixar o termo assinado.");
        const blob = await response.blob();
        const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "pdf";
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `termo-devolucao-assinado-${safeFileName(employee.full_name)}.${extension}`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (caught) { setError(friendlyError(caught, "Não foi possível baixar o termo assinado.")); }
      return;
    }
    const doc = await createReturnTermDocument({
      organization: employee.organization || { name: "EPIS+" },
      employee: { name: employee.full_name, cpf: employee.cpf, registration: employee.registration, job_title: employee.job_title || employee.function_name, department: employee.department, admission_date: employee.admission_date, termination_date: employee.status === "terminated" ? employee.termination_date : null },
      responsible_name: sheet.responsible_name,
      return_id: sheet.id,
      returned_at: sheet.returned_at,
      reason: sheet.reason,
      notes: sheet.notes,
      items: sheet.items.map(toReturnTermItem),
      signed_at: sheet.term_signed_at,
      signed_name: sheet.term_signer_name,
      signed_cpf: sheet.term_signer_cpf,
    });
    doc.save(`termo-devolucao-${safeFileName(employee.full_name)}.pdf`);
  }

  async function openSignedReturnTerm(sheet: ReturnSheet) {
    if (!sheet.term_file_path) return;
    const popup = openPendingDownload();
    try {
      if (!popup) throw new Error("O navegador bloqueou a abertura do termo. Permita pop-ups para este site.");
      const { data, error: signedUrlError } = await createClient().storage.from("delivery-terms").createSignedUrl(sheet.term_file_path, 300);
      if (signedUrlError || !data?.signedUrl) throw signedUrlError ?? new Error("Não foi possível abrir o termo assinado.");
      finishPendingDownload(popup, data.signedUrl);
    } catch (caught) {
      closePendingDownload(popup);
      setError(friendlyError(caught, "Não foi possível abrir o termo assinado."));
    }
  }

  if (loading) return <main className="module-shell"><div className="module-loading"><LoaderCircle className="spin" size={22} /> Carregando ficha...</div></main>;
  if (error || !employee) return <main className="module-shell"><section className="panel runtime-error-card"><FeedbackMessage onRetry={() => window.location.reload()}>{error || "Funcionário não encontrado."}</FeedbackMessage></section><Link className="secondary-button" href="/employees"><ArrowLeft size={16} /> Funcionários</Link></main>;

  const organization = employee.organization;
  const companyName = organization?.name || "DSX";
  const isDsx = companyName.toLocaleUpperCase("pt-BR").includes("DSX");
  const companyAddress = organization?.address || (isDsx ? "Rua Harrison de Figueiredo, 132, Jd. Sta. Maria, 79833-552, Dourados-MS" : "");
  const companyPhone = organization?.phone || (isDsx ? "+55 67 3425-2324" : "");

  return <main className={`module-shell employee-sheet${deliveryPrintSnapshot ? " print-single-delivery-sheet" : ""}`}>
    {deliveryPrintSnapshot && <DeliveryTermPrintSheet snapshot={deliveryPrintSnapshot} />}
    <header className="module-header no-print"><div><Link className="employee-back-link" href="/employees"><ArrowLeft size={14} /> Funcionários</Link><p className="eyebrow">CONTROLE INDIVIDUAL</p><h1>Ficha de EPI</h1><p className="module-subtitle">Registro de fornecimento, dados do colaborador e assinaturas por entrega.</p></div><div className="employee-header-tools"><EmployeeNavigation id={id} current="sheet" /></div></header>
    <section className="panel sheet-card enhanced-sheet">
      <section className="employee-epi-print">
        <header className="employee-epi-header">
          <div className="employee-epi-brand">
            {organization?.logo_url ? <Image src={organization.logo_url} alt={`Logo ${companyName}`} width={142} height={48} unoptimized /> : <strong>{companyName}</strong>}
            <div><h2>FICHA DE EPI</h2><span>Equipamento de Proteção Individual · Registro de fornecimento</span></div>
          </div>
          <button type="button" className="secondary-button no-print" onClick={() => void printEpiSheet()}><Printer size={16} /> Imprimir ficha de EPI</button>
        </header>

        <section className="employee-epi-identification" aria-label="Identificação do colaborador">
          <div className="employee-epi-name"><small>Nome completo</small><strong>{employee.full_name}</strong></div>
          <div><small>Matrícula</small><strong>{employee.registration || "Não informada"}</strong></div>
          <div><small>Data de admissão</small><strong>{date(employee.admission_date)}</strong></div>
          {employee.status === "terminated" && <div><small>Data de demissão</small><strong>{date(employee.termination_date)}</strong></div>}
          <div><small>Cargo / função</small><strong>{employee.function_name || employee.job_title || "Não informado"}{employee.function_classification ? ` · Classe ${employee.function_classification}` : ""}</strong></div>
          <div><small>Setor</small><strong>{employee.department || "Não informado"}</strong></div>
          <div><small>Unidade</small><strong>{employee.unit || "Não informada"}</strong></div>
        </section>

        <section className="employee-epi-declaration" aria-labelledby="employee-epi-declaration-title">
          <h3 id="employee-epi-declaration-title">Declaração de recebimento e responsabilidade</h3>
          <p>Declaro que recebi os materiais relacionados nesta ficha. Quanto aos equipamentos de proteção individual (EPIs), confirmo o recebimento em condições de uso e a ciência das orientações aplicáveis sobre sua finalidade, os riscos contra os quais oferecem proteção, suas limitações, o uso e ajuste corretos, manutenção e substituição e os cuidados de limpeza, guarda e conservação, conforme a NR-06 e as instruções do fabricante.</p>
          <p>Comprometo-me a utilizar cada EPI somente para a finalidade a que se destina, zelar por sua limpeza, guarda e conservação, comunicar à organização qualquer extravio, dano ou alteração que o torne impróprio e cumprir as orientações de uso. Estou ciente de que a recusa injustificada em cumprir essas obrigações pode caracterizar ato faltoso conforme a NR-01, item 1.4.2.1, preservado o direito de interromper a atividade diante de risco grave e iminente e comunicar a chefia, nos termos do item 1.4.3. A organização deve fornecer EPI gratuitamente e prestar orientação e treinamento quando aplicáveis; esta ficha não substitui os registros próprios de capacitação.</p>
          <p className="employee-epi-deduction-note"><strong>Perda, extravio ou dano:</strong> a ocorrência poderá ser registrada e apurada individualmente. Esta ficha não autoriza desconto automático; eventual ressarcimento ou desconto deverá ser analisado conforme o caso e os limites do art. 462 da CLT e demais normas aplicáveis.</p>
        </section>

        <div className="employee-epi-declaration-signature"><span></span><strong>{employee.full_name}</strong><small>Assinatura do colaborador — ciência da ficha</small></div>

        <section className="employee-epi-deliveries" aria-labelledby="employee-epi-deliveries-title">
          <div className="employee-epi-section-heading"><div><h3 id="employee-epi-deliveries-title">Materiais entregues</h3><p>Histórico por entrega, com variação, CA e dados do ensaio quando aplicáveis.</p></div><span>{epiSheetRows.length} registro(s)</span></div>
          <div className="employee-epi-table-wrap"><table className="employee-epi-table"><thead><tr><th>Data</th><th>Descrição do equipamento</th><th>Quantidade</th><th>Tamanho / numeração</th><th>Nº CA / ensaio</th></tr></thead><tbody>
            {epiSheetRows.length ? epiSheetRows.map((item) => {
              return <tr key={item.id}>
                <td data-label="Data">{date(item.delivery?.delivered_at ?? null)}</td>
                <td data-label="Descrição do equipamento"><strong>{item.material?.name || "Material"}</strong></td>
                <td data-label="Quantidade">{item.quantity} {item.material?.unit || "un."}</td>
                <td data-label="Tamanho / numeração">{item.variant ? item.variant.size || item.variant.name : "N/A"}</td>
                <td data-label="Nº CA / ensaio">{epiCaDetails(item)}</td>
              </tr>;
            }) : <tr><td colSpan={5} className="employee-epi-empty">Nenhum EPI entregue até o momento.</td></tr>}
          </tbody></table></div>
        </section>

        <footer className="employee-epi-footer">
          <div>{companyAddress && <span>{companyAddress}</span>}{companyPhone && <span>{companyPhone}</span>}{isDsx && <span>www.dsxenergia.com.br</span>}{organization?.cnpj && <span>CNPJ {organization.cnpj}</span>}</div>
          <small>Ficha emitida pelo EPIS+ em {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" })} · Registros e assinaturas vinculados às entregas.</small>
        </footer>
      </section>
      <section className="sheet-metrics"><div><PackageCheck size={18} /><span><strong>{items.length}</strong> materiais distintos</span></div><div><PackageCheck size={18} /><span><strong>{summary.totalQuantity}</strong> itens entregues</span></div><div className={summary.pending ? "attention" : ""}><CalendarClock size={18} /><span><strong>{summary.pending}</strong> troca(s) a acompanhar</span></div></section>
      <section className="sheet-section employee-delivery-sheets">
        <div className="sheet-section-heading"><div><p>FICHAS DE ENTREGA</p><h2>Termos de entrega</h2><span>{deliverySheets.length} ficha(s) registrada(s)</span></div></div>
        {deliverySheets.length ? <div className="table-wrap"><table><thead><tr><th>DATA</th><th>MOTIVO</th><th>ITENS</th><th>DOCUMENTO</th><th>AÇÕES</th></tr></thead><tbody>
          {deliverySheets.map((sheet) => {
            const signed = Boolean(sheet.term_signed_at || sheet.term_file_path);
            const status = sheet.term_file_path
              ? sheet.term_signature_method === "physical_upload" ? "Assinado fisicamente" : "Assinado"
              : sheet.term_signed_at ? "Assinado · arquivo indisponível" : "Pendente";
            return <tr key={sheet.id}>
              <td>{date(sheet.delivered_at)}</td>
              <td>{reasonLabels[sheet.reason] || sheet.reason}</td>
              <td>{sheet.items}</td>
              <td><span className={`status-pill ${signed ? "success" : "warning"}`}>{signed ? <><Check size={11} /> {status}</> : status}</span></td>
              <td>
                <EmployeeTermActions>
                  <div className="employee-sheet-actions">
                    {!signed && <>
                      <button type="button" className="action-button" onClick={() => downloadTerm(sheet)}><Printer size={14} /> Imprimir / salvar ficha em PDF</button>
                      <TermCopyLinkButton recordType="delivery" recordId={sheet.id} />
                      <DeliverySignatureModal deliveryId={sheet.id} employeeName={employee.full_name} employeeCpf={employee.cpf} employeeRegistration={employee.registration} deliveredAt={sheet.delivered_at} reason={sheet.reason} items={sheet.materials.map((item) => ({ quantity: item.quantity, expected_replacement_at: item.expected_replacement_at, material: item.material }))} currentPath={sheet.term_file_path} onComplete={(path) => setItems((current) => current.map((item) => item.delivery?.id === sheet.id ? { ...item, delivery: item.delivery ? { ...item.delivery, term_file_path: path, term_signature_method: "assisted", term_signed_at: new Date().toISOString() } : item.delivery } : item))} />
                    </>}
                    {sheet.term_file_path && <TermDocumentActions path={sheet.term_file_path} employeeName={employee.full_name} />}
                    {signed && !sheet.term_file_path && <span className="delivery-term-status complete">Assinatura registrada; documento indisponível.</span>}
                    <label className="action-button upload-term-button"><Upload size={14} /> {uploadingId === sheet.id ? "Enviando..." : sheet.term_file_path ? "Trocar termo assinado" : "Anexar termo assinado"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadTerm(sheet, event)} disabled={uploadingId === sheet.id} /></label>
                  </div>
                </EmployeeTermActions>
              </td>
            </tr>;
          })}
        </tbody></table></div> : <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhuma ficha registrada</strong><span>As fichas aparecerão após cada entrega.</span></div>}
      </section>

      <section className="sheet-section employee-return-sheets"><div className="sheet-section-heading"><div><p>FICHAS DE DEVOLUÇÃO</p><h2>Termos de devolução</h2><span>{returnSheets.length} termo(s) registrado(s)</span></div></div>{returnSheets.length ? <div className="table-wrap"><table><thead><tr><th>DOCUMENTO</th><th>DATA</th><th>MATERIAIS</th><th>STATUS</th><th>AÇÕES</th></tr></thead><tbody>{returnSheets.map((sheet) => <tr key={sheet.id}><td><strong>Termo de devolução</strong><small>{reasonLabels[sheet.reason] || sheet.reason}</small></td><td>{date(sheet.returned_at)}</td><td>{sheet.items.map((item, index) => <span className="employee-term-material" key={`${sheet.id}-${index}`}>{item.quantity}x {item.material?.name || "Material"}{item.variant ? ` · Tamanho ${item.variant.size || item.variant.name}` : ""}</span>)}</td><td><span className={`status-pill ${sheet.term_signed_at ? "success" : "warning"}`}>{sheet.term_signed_at ? <><Check size={11} /> {sheet.term_signature_method === "physical_upload" ? "Assinado fisicamente" : "Assinado digitalmente"}</> : "Pendente"}</span></td><td><EmployeeTermActions><div className="employee-sheet-actions"><button type="button" className="action-button" onClick={() => void downloadReturnTerm(sheet)}><Download size={14} /> {sheet.term_signed_at ? "Baixar termo assinado" : "Baixar termo para assinatura"}</button>{!sheet.term_signed_at && <ReturnSignatureModal returnId={sheet.id} employee={{ name: employee!.full_name, cpf: employee!.cpf, registration: employee!.registration, job_title: employee!.job_title || employee!.function_name, department: employee!.department, admission_date: employee!.admission_date, termination_date: employee!.status === "terminated" ? employee!.termination_date : null }} organization={employee!.organization || { name: "EPIS+" }} responsibleName={sheet.responsible_name} returnedAt={sheet.returned_at} reason={sheet.reason} items={sheet.items} currentPath={sheet.term_file_path} onComplete={(path) => setReturnSheets((current) => current.map((item) => item.id === sheet.id ? { ...item, term_file_path: path, term_signature_method: "assisted", term_signed_at: new Date().toISOString() } : item))} />}</div></EmployeeTermActions>{sheet.term_file_path && <button type="button" className="action-button" onClick={() => void openSignedReturnTerm(sheet)}><Eye size={14} /> Visualizar termo</button>}<label className="action-button upload-term-button"><Upload size={14} /> {uploadingId === sheet.id ? "Enviando..." : sheet.term_file_path ? "Trocar termo assinado" : "Anexar termo assinado"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => void uploadReturnTerm(sheet, event)} disabled={uploadingId === sheet.id} /></label></td></tr>)}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum termo de devolução</strong><span>Os termos aparecerão após uma devolução registrada.</span></div>}</section>

      <section className="sheet-section"><div className="sheet-section-heading"><div><p>RESPONSABILIDADE ATUAL</p><h2>Materiais atualmente com o colaborador</h2><span>{currentItems.length} registro(s) em posse do colaborador</span></div></div>{currentItems.length ? <div className="table-wrap sheet-table-wrap"><table><thead><tr><th>MATERIAL</th><th>IDENTIFICAÇÃO</th><th>VALIDADE</th><th>LOTE</th><th>QTD.</th><th>ENTREGA</th><th>PREVISÃO DE TROCA</th><th>STATUS</th><th>MOTIVO</th></tr></thead><tbody>{currentItems.map((item) => { const status = replacementStatus(item.expected_replacement_at); return <tr key={item.id}><td><strong>{item.material?.name || "Material"}</strong><small>{item.material?.internal_code ? `${item.material.internal_code || "Código não informado"} · ${item.material.unit}` : item.material?.unit}</small></td><td>{item.units.length ? item.units.map((unit, index) => <span className="employee-term-material" key={`${item.id}-unit-${index}`}>{unit.unit_identifier}</span>) : "—"}</td><td>{item.units.length ? item.units.map((unit, index) => <span className="employee-term-material" key={`${item.id}-validity-${index}`}>{date(unit.valid_until)}</span>) : "—"}</td><td>{item.lot?.lot_number || "—"}</td><td><strong>{item.quantity - item.returned}</strong></td><td>{date(item.delivery?.delivered_at ?? null)}</td><td>{date(item.expected_replacement_at)}</td><td><span className={`status-pill ${status.tone}`}>{status.tone !== "success" && status.tone !== "neutral" && <AlertTriangle size={11} />}{status.label}</span></td><td>{reasonLabels[item.delivery?.reason ?? ""] || "—"}</td></tr>; })}</tbody></table></div> : <div className="empty-state"><ShieldCheck size={27} /><strong>Nenhum material em posse</strong><span>Este colaborador não possui materiais atualmente sob sua responsabilidade.</span></div>}</section>
      {courses.length > 0 && <section className="sheet-courses"><div className="sheet-section-heading"><div><p>CAPACITAÇÕES</p><h2>Cursos e treinamentos</h2></div></div>{courses.map((course) => <div key={course.id}><strong>{course.name}</strong><span>{course.provider || "Instituição não informada"}{course.expires_at ? ` · validade ${date(course.expires_at)}` : ""}</span></div>)}</section>}
    </section>
  </main>;
}
