export type ContractAnnexMaterial = {
  contract_item_code: string | null;
  contract_source: string | null;
};

export const CONTRACT_ANNEX_LABELS: Record<string, string> = {
  "04": "C&M e Poda",
  "05": "Linha Viva Distribuição",
  "06": "STC - Operação e Perdas",
  "07": "Motociclista",
};

export function getContractAnnexNumber(material: ContractAnnexMaterial) {
  const itemCodeAnnex = material.contract_item_code
    ?.trim()
    .match(/^A(\d{1,2})\s*[-.]/i)?.[1];
  if (itemCodeAnnex) return itemCodeAnnex.padStart(2, "0");

  const sourceAnnex = material.contract_source
    ?.match(/\banexo\s*(?:n[º°.]?\s*)?(\d{1,2})\b/i)?.[1];
  return sourceAnnex?.padStart(2, "0") ?? null;
}

export function contractAnnexLabel(annexNumber: string) {
  return CONTRACT_ANNEX_LABELS[annexNumber]
    ? `${CONTRACT_ANNEX_LABELS[annexNumber]} · Anexo ${annexNumber}`
    : `Anexo ${annexNumber}`;
}
