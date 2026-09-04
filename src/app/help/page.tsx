import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardCheck, PackagePlus, Users } from "lucide-react";

const guides = [
  { title: "1. Cadastre os materiais", description: "Inclua EPIs, EPCs e ferramentais, com estoque mínimo, CA quando aplicável e localização.", href: "/materials", icon: PackagePlus, action: "Abrir materiais" },
  { title: "2. Registre a nota e a entrada", description: "Uma nota fiscal pode conter vários produtos. Informe lote, quantidade, custo e validade em cada linha.", href: "/entries", icon: ClipboardCheck, action: "Registrar entrada" },
  { title: "3. Complete os dados do colaborador", description: "Na ficha do funcionário, registre medidas, cursos e imprima o comprovante de materiais entregues.", href: "/employees", icon: Users, action: "Abrir funcionários" },
];

export default function HelpPage() {
  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">ORIENTAÇÃO DE USO</p><h1>Central de ajuda</h1><p className="module-subtitle">Um roteiro rápido para iniciar e operar o controle de equipamentos.</p></div></header><section className="module-summary help-summary"><div><BookOpen size={19} /><strong>Primeiros passos</strong><span>Cadastre materiais, registre entradas e faça entregas.</span></div><div><ClipboardCheck size={19} /><strong>Movimentações</strong><span>Use entregas, devoluções e ensaios para manter o histórico.</span></div><div><Users size={19} /><strong>Colaboradores</strong><span>Complete medidas e cursos diretamente na ficha individual.</span></div></section><section className="help-guides">{guides.map(({ title, description, href, icon: Icon, action }) => <article className="panel help-guide" key={title}><Icon size={23} /><div><h2>{title}</h2><p>{description}</p><Link className="text-link" href={href}>{action} <ArrowRight size={15} /></Link></div></article>)}</section><section className="panel help-note"><h2>Certificados de aprovação (CA)</h2><p>A consulta automática à API BaseCAEPI permanece como a única integração técnica planejada para uma próxima etapa. Enquanto isso, o CA pode ser informado manualmente ao cadastrar cada EPI.</p></section></main>;
}
