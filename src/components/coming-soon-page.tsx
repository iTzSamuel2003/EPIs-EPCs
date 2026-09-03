import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

export function ComingSoonPage({ title, description }: { title: string; description: string }) {
  return <main className="module-shell"><header className="module-header"><div><p className="eyebrow">EPIS+</p><h1>{title}</h1><p className="module-subtitle">{description}</p></div><Link className="secondary-button" href="/"><ArrowLeft size={16} /> Voltar ao Dashboard</Link></header><section className="panel empty-state" style={{ minHeight: 260 }}><Construction size={34} /><strong>Esta área está sendo preparada</strong><span>O acesso já está disponível e receberá seus recursos na próxima etapa do MVP.</span></section></main>;
}
