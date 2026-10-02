export const PAGE_PERMISSIONS = [
  ["/", "Dashboard"], ["/materials", "Materiais"], ["/employees", "Funcionários"], ["/teams", "Equipes"], ["/units", "Unidades físicas"], ["/variants", "Variações"], ["/function-templates", "Listas por função"],
  ["/entries", "Entradas"], ["/deliveries", "Entregas"], ["/returns", "Devoluções"], ["/requests", "Solicitações"], ["/stock", "Estoque"], ["/validities", "Validades"], ["/ca", "Consulta CA"], ["/contract-requirements", "Requisitos contratuais"], ["/tests", "Ensaios"], ["/training-compliance", "Treinamentos"], ["/compliance", "Conformidade"], ["/costs", "Custos"], ["/reports", "Relatórios"], ["/movements", "Movimentações"], ["/audit", "Auditoria"], ["/settings", "Configurações"], ["/help", "Central de ajuda"],
] as const;

export const rolePageDefaults: Record<string, string[]> = {
  admin: PAGE_PERMISSIONS.map(([path]) => path),
  rh: ["/", "/employees", "/deliveries", "/returns", "/requests", "/stock", "/validities", "/reports", "/help"],
  tst: ["/", "/materials", "/entries", "/deliveries", "/returns", "/stock", "/validities", "/ca", "/contract-requirements", "/tests", "/training-compliance", "/compliance", "/costs", "/reports", "/movements", "/help"],
  user: ["/", "/help"],
};
