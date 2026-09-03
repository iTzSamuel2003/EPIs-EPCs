export type UserRole = "admin" | "user";
export type MaterialType = "EPI" | "EPC";
export type EmployeeStatus = "active" | "away" | "terminated";
export type MaterialStatus = "active" | "inactive";
export interface Material { id: string; internalCode: string; name: string; type: MaterialType; categoryId?: string; unit: string; caNumber?: string; caExpiresAt?: string; currentStock: number; minimumStock: number; location?: string; status: MaterialStatus; }
export interface Employee { id: string; registration: string; fullName: string; cpf: string; role?: string; department?: string; status: EmployeeStatus; }
export interface StockLot { id: string; materialId: string; lotNumber: string; receivedQuantity: number; availableQuantity: number; entryDate: string; expiresAt?: string; }
export interface StockMovement { id: string; materialId: string; lotId?: string; movementType: "entry" | "delivery" | "return" | "adjustment" | "discard"; quantity: number; createdAt: string; createdBy: string; }
