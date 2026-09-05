export type UserRole = "admin" | "user";
export type MaterialType = "EPI" | "EPC" | "FERRAMENTAL";
export type ContractCategory = MaterialType | "EQUIPAMENTO" | "ACESSORIO" | "TI";
export type UsageScope = "individual" | "coletivo";
export type MaterialUnitStatus = "available" | "assigned" | "maintenance" | "quarantine" | "discarded";
export type EmployeeStatus = "active" | "away" | "terminated";
export type MaterialStatus = "active" | "inactive";
export interface Material { id: string; internalCode: string; name: string; type: MaterialType; categoryId?: string; unit: string; caNumber?: string; caExpiresAt?: string; currentStock: number; minimumStock: number; location?: string; status: MaterialStatus; contractItemCode?: string; contractCategory?: ContractCategory; usageScope?: UsageScope; contractSource?: string; contractSpecification?: string; voltageClass?: string; caRequired?: boolean; testRequired?: boolean; testType?: "dielectric" | "calibration" | "operational" | "inspection" | "other"; testIntervalMonths?: 6 | 12; reportRequired?: boolean; artRequired?: boolean; }
export interface MaterialUnit { id: string; materialId: string; unitIdentifier: string; lotNumber?: string; serialNumber?: string; manufacturer?: string; model?: string; size?: string; manufacturedAt?: string; expiresAt?: string; caNumber?: string; caExpiresAt?: string; status: MaterialUnitStatus; location?: string; }
export interface ContractScenario { id: string; code: string; name: string; sourceAnnex: string; teamSize?: number; composition?: string; }
export interface ContractRequirement { id: string; scenarioId: string; materialId: string; sourceAnnex: string; sourceItemNumber?: number; quantity: number; unit: string; usageScope: UsageScope; notes?: string; }
export interface Employee { id: string; registration: string | null; fullName: string; cpf: string; role?: string; department?: string; status: EmployeeStatus; }
export interface StockLot { id: string; materialId: string; lotNumber: string; receivedQuantity: number; availableQuantity: number; entryDate: string; expiresAt?: string; }
export interface StockMovement { id: string; materialId: string; lotId?: string; movementType: "entry" | "delivery" | "return" | "adjustment" | "discard"; quantity: number; createdAt: string; createdBy: string; }

