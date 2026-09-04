import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type EmployeeSection = "sheet" | "edit" | "profile";

type EmployeeNavigationProps = {
  id: string;
  current: EmployeeSection;
};

export function EmployeeNavigation({ id, current }: EmployeeNavigationProps) {
  const items = [
    { key: "employees" as const, label: "Funcionários", href: "/employees" },
    { key: "sheet" as const, label: "Ficha", href: `/employees/${id}` },
    { key: "edit" as const, label: "Editar", href: `/employees/${id}/edit` },
    { key: "profile" as const, label: "Medidas e cursos", href: `/employees/${id}/profile` },
  ];

  return (
    <nav className="employee-navigation" aria-label="Navegação do colaborador">
      {items.map((item) => (
        <Link className={item.key === current ? "active" : ""} href={item.href} key={item.key}>
          {item.key === "employees" && <ArrowLeft size={14} />}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
