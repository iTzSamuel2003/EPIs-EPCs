"use client";

export type EmployeeHrPrivateData = {
  birth_date: string;
  address: string;
  pis: string;
  bank_name: string;
  bank_account: string;
  bank_branch: string;
  marital_status: string;
  dependents: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
};

export const emptyEmployeeHrPrivateData: EmployeeHrPrivateData = {
  birth_date: "",
  address: "",
  pis: "",
  bank_name: "",
  bank_account: "",
  bank_branch: "",
  marital_status: "",
  dependents: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
};

type Props = {
  value: EmployeeHrPrivateData;
  onChange: (field: keyof EmployeeHrPrivateData, value: string) => void;
};

const maritalStatuses = [
  ["single", "Solteiro(a)"],
  ["married", "Casado(a)"],
  ["stable_union", "União estável"],
  ["divorced", "Divorciado(a)"],
  ["widowed", "Viúvo(a)"],
  ["separated", "Separado(a)"],
  ["other", "Outro"],
] as const;

export function EmployeeHrPrivateFields({ value, onChange }: Props) {
  return (
    <>
      <div className="form-section-title employee-private-data-heading">
        <h2>Dados adicionais do RH</h2>
        <p>Informações pessoais, bancárias e de emergência visíveis somente ao RH e à administração.</p>
      </div>
      <div className="form-grid three">
        <label>Data de nascimento<input type="date" value={value.birth_date} onChange={(event) => onChange("birth_date", event.target.value)} /></label>
        <label>Estado civil<select value={value.marital_status} onChange={(event) => onChange("marital_status", event.target.value)}><option value="">Não informado</option>{maritalStatuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>PIS / NIT<input value={value.pis} onChange={(event) => onChange("pis", event.target.value)} maxLength={40} autoComplete="off" /></label>
      </div>
      <label>Endereço<input value={value.address} onChange={(event) => onChange("address", event.target.value)} maxLength={600} autoComplete="street-address" placeholder="Rua, número, bairro, cidade e CEP" /></label>
      <div className="form-grid three">
        <label>Banco<input value={value.bank_name} onChange={(event) => onChange("bank_name", event.target.value)} maxLength={120} autoComplete="off" /></label>
        <label>Agência<input value={value.bank_branch} onChange={(event) => onChange("bank_branch", event.target.value)} maxLength={40} autoComplete="off" /></label>
        <label>Conta<input value={value.bank_account} onChange={(event) => onChange("bank_account", event.target.value)} maxLength={80} autoComplete="off" /></label>
      </div>
      <label>Dependentes<textarea value={value.dependents} onChange={(event) => onChange("dependents", event.target.value)} maxLength={4000} rows={3} placeholder="Nome, parentesco e data de nascimento (um dependente por linha)" /></label>
      <div className="form-grid two">
        <label>Contato de emergência — nome<input value={value.emergency_contact_name} onChange={(event) => onChange("emergency_contact_name", event.target.value)} maxLength={200} autoComplete="off" /></label>
        <label>Contato de emergência — telefone<input type="tel" value={value.emergency_contact_phone} onChange={(event) => onChange("emergency_contact_phone", event.target.value)} maxLength={60} autoComplete="off" /></label>
      </div>
    </>
  );
}
