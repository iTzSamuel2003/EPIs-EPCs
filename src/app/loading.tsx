export default function Loading() {
  return (
    <main className="module-shell" aria-busy="true" aria-live="polite">
      <div className="module-loading">
        <span className="loading-spinner" aria-hidden="true" />
        Carregando informações...
      </div>
    </main>
  );
}
