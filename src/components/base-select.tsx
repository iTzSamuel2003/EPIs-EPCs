"use client";

import type { OperationalBase } from "@/lib/use-base-context";

export function BaseSelect({ bases, value, onChange, label = "Base operacional", required = true }: {
  bases: OperationalBase[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
}) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
    {!required && <option value="">Todas as bases</option>}
    {required && !value && <option value="">Selecione a base</option>}
    {bases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}
  </select></label>;
}
