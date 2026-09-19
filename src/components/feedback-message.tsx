import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

type FeedbackMessageProps = { kind?: "error" | "success" | "info"; children: ReactNode; onRetry?: () => void };

export function FeedbackMessage({ kind = "error", children, onRetry }: FeedbackMessageProps) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "info" ? Info : AlertCircle;
  return <div className={`feedback ${kind}-feedback`}><Icon className="feedback-icon" size={17} aria-hidden="true" /><span className="feedback-copy" role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"} aria-atomic="true">{children}</span>{onRetry && <button type="button" className="feedback-retry" onClick={onRetry} aria-label="Tentar carregar novamente"><RefreshCw size={14} aria-hidden="true" /> Tentar novamente</button>}</div>;
}
