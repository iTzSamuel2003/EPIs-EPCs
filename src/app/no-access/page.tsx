import { LockKeyhole } from "lucide-react";

export default function NoAccessPage() {
  return (
    <main className="no-access-page">
      <section className="no-access-card">
        <div className="no-access-icon"><LockKeyhole size={25} /></div>
        <p className="eyebrow">ACESSO AO SISTEMA</p>
        <h1>Nenhuma página liberada</h1>
        <p>Seu usuário ainda não tem páginas autorizadas. Peça ao administrador da organização para revisar seu perfil ou liberar os acessos necessários.</p>
        <small>Se você acredita que isso é um engano, fale com o responsável pelo sistema na sua organização.</small>
      </section>
    </main>
  );
}
