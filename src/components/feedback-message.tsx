import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

type FeedbackMessageProps = { kind?: "error" | "success" | "info"; children: ReactNode; onRetry?: () => void };

export function FeedbackMessage({ kind = "error", children, onRetry }: FeedbackMessageProps) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "info" ? Info : AlertCircle;
  return <div className={`feedback ${kind}-feedback`} role={kind === "error" ? "alert" : "status"}><Icon size={17} /><span>{children}</span>{onRetry && <button type="button" className="feedback-retry" onClick={onRetry}><RefreshCw size={14} /> Tentar novamente</button>}</div>;
}

