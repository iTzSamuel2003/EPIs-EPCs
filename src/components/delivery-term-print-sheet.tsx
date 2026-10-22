import Image from "next/image";

export type DeliveryTermSnapshot = {
  type: "delivery";
  pre_delivery_signature?: boolean;
  organization_id?: string;
  organization_name: string;
  organization_logo_url?: string | null;
  organization_cnpj?: string | null;
  organization_address?: string | null;
  organization_phone?: string | null;
  responsible_name?: string | null;
  employee_name: string;
  employee_registration: string | null;
  employee_function?: string | null;
  employee_department?: string | null;
  employee_admission_date?: string | null;
  employee_termination_date?: string | null;
  date: string;
  reason: string;
  notes: string | null;
  items: Array<{
    material: string;
    code?: string | null;
    unit: string;
    quantity: number;
    size?: string | null;
    ca_number?: string | null;
    ca_expires_at?: string | null;
    expected_replacement_at?: string | null;
    units?: Array<{
      identifier?: string | null;
      unit_identifier?: string | null;
      ca_number?: string | null;
      ca_expires_at?: string | null;
      test_number?: string | null;
      test_report_number?: string | null;
      test_performed_at?: string | null;
      test_expires_at?: string | null;
    }>;
  }>;
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

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("pt-BR");
}

function organizationFooter(snapshot: DeliveryTermSnapshot) {
  const isDsx = snapshot.organization_name.toLocaleUpperCase("pt-BR").includes("DSX");
  return {
    address: snapshot.organization_address || (isDsx ? "Rua Harrison de Figueiredo, 132, Jd. Sta. Maria, 79833-552, Dourados-MS" : ""),
    phone: snapshot.organization_phone || (isDsx ? "+55 67 3425-2324" : ""),
    website: isDsx ? "www.dsxenergia.com.br" : "",
  };
}

export function DeliveryTermPrintSheet({ snapshot }: { snapshot: DeliveryTermSnapshot }) {
  const footer = organizationFooter(snapshot);

  return (
    <section className="pending-delivery-print" aria-label="Ficha de EPI para assinatura">
      <header className="pending-print-header">
        <div className="pending-print-heading">
          <strong>{snapshot.organization_name}</strong>
          <span>FICHA DE EPI - EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL</span>
        </div>
        {snapshot.organization_logo_url && (
          <Image
            className="pending-delivery-print-logo"
            src={snapshot.organization_logo_url}
            alt={`Logo ${snapshot.organization_name}`}
            width={260}
            height={100}
            unoptimized
            loading="eager"
          />
        )}
      </header>

      <div className="pending-print-meta">
        <div><small>Nº DE REGISTRO / MATRÍCULA</small><strong>{snapshot.employee_registration || "Não informada"}</strong></div>
        <div className="pending-print-meta-wide"><small>NOME DO COLABORADOR</small><strong>{snapshot.employee_name}</strong></div>
        {snapshot.employee_admission_date && <div><small>DATA DE ADMISSÃO</small><strong>{date(snapshot.employee_admission_date)}</strong></div>}
        {snapshot.employee_termination_date && <div><small>DATA DE DESLIGAMENTO</small><strong>{date(snapshot.employee_termination_date)}</strong></div>}
        {snapshot.employee_function && <div><small>CARGO / FUNÇÃO</small><strong>{snapshot.employee_function}</strong></div>}
        {snapshot.employee_department && <div><small>SETOR</small><strong>{snapshot.employee_department}</strong></div>}
        <div><small>DATA DA ENTREGA</small><strong>{date(snapshot.date)}</strong></div>
        <div><small>MOTIVO</small><strong>{reasons[snapshot.reason] || snapshot.reason}</strong></div>
        {snapshot.responsible_name && <div className="pending-print-meta-wide"><small>RESPONSÁVEL PELO CONTROLE</small><strong>{snapshot.responsible_name}</strong></div>}
      </div>

      <section className="pending-print-declaration">
        <strong>DECLARAÇÃO DE RECEBIMENTO E RESPONSABILIDADE</strong>
        <p>Declaro que recebi os equipamentos de proteção relacionados nesta ficha e que fui orientado(a) sobre seu uso, finalidade, limitações, guarda e conservação, conforme as medidas de prevenção da organização e as NR-06 e NR-01. Comprometo-me a utilizar corretamente os equipamentos, seguir as orientações recebidas, comunicar danos ou alterações e devolvê-los quando solicitado, inclusive em caso de substituição, mudança de função ou desligamento.</p>
        <p>Estou ciente de que situações de perda, extravio, dano ou uso inadequado serão apuradas individualmente. Qualquer ressarcimento ou desconto dependerá da apuração e dos requisitos legais aplicáveis; esta declaração, por si só, não autoriza desconto automático.</p>
      </section>

      <div className="pending-print-employee-signature"><span />{snapshot.employee_name}<small>Assinatura do colaborador</small></div>

      <h2>Materiais entregues</h2>
      <table>
        <thead><tr><th>Data</th><th>Descrição do equipamento</th><th>Quant.</th><th>Tam.</th><th>Nº CA / ensaio</th></tr></thead>
        <tbody>
          {snapshot.items.map((item, index) => {
            const compliance = new Set<string>();
            if (item.ca_number) compliance.add(`CA ${item.ca_number}${item.ca_expires_at ? ` · validade ${date(item.ca_expires_at)}` : ""}`);
            for (const unit of item.units ?? []) {
              if (unit.ca_number) compliance.add(`CA ${unit.ca_number}${unit.ca_expires_at ? ` · validade ${date(unit.ca_expires_at)}` : ""}`);
              if (unit.test_number) compliance.add(`Ensaio nº ${unit.test_number}`);
              if (unit.test_report_number) compliance.add(`Laudo ${unit.test_report_number}`);
              if (unit.test_performed_at) compliance.add(`Realizado ${date(unit.test_performed_at)}`);
              if (unit.test_expires_at) compliance.add(`Válido até ${date(unit.test_expires_at)}`);
            }

            return (
              <tr key={`${item.material}-${index}`}>
                <td>{date(snapshot.date)}</td>
                <td>{item.material}</td>
                <td>{item.quantity} {item.unit}</td>
                <td>{item.size || "—"}</td>
                <td>{compliance.size ? [...compliance].map((value) => <div key={value}>{value}</div>) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {snapshot.notes && <p className="pending-print-notes"><strong>Observações:</strong> {snapshot.notes}</p>}
      <footer>
        <div>{snapshot.organization_cnpj && <span>CNPJ {snapshot.organization_cnpj}</span>}{footer.address && <span>{footer.address}</span>}</div>
        <div>{footer.phone && <span>{footer.phone}</span>}{footer.website && <span>{footer.website}</span>}</div>
        <small>{snapshot.pre_delivery_signature === false ? "Esta ficha registra uma entrega já lançada no sistema e permanece vinculada ao documento assinado." : "O recebimento e a baixa do estoque são registrados após a confirmação da assinatura."}</small>
      </footer>
    </section>
  );
}
