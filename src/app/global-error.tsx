"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: "#f7f8fc", color: "#17233c", fontFamily: "Arial, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "min(100%, 480px)", background: "#fff", border: "1px solid #e8ebf2", borderRadius: 16, padding: 32, textAlign: "center", boxShadow: "0 18px 50px rgba(23,35,60,.08)" }}>
            <div style={{ width: 52, height: 52, margin: "0 auto 18px", display: "grid", placeItems: "center", borderRadius: 14, background: "#fff0ee", color: "#c66155", fontSize: 26 }}>!</div>
            <h1 style={{ margin: "0 0 10px", fontSize: 22 }}>Não foi possível carregar esta tela</h1>
            <p style={{ margin: "0 0 24px", color: "#7b879f", fontSize: 14, lineHeight: 1.5 }}>Ocorreu um erro inesperado. Tente novamente; se continuar, atualize a página ou entre em contato com o administrador.</p>
            <button type="button" onClick={() => reset()} style={{ border: 0, borderRadius: 8, padding: "11px 18px", background: "#7762d6", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Tentar novamente</button>
          </section>
        </main>
      </body>
    </html>
  );
}
