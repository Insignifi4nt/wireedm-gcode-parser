import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type StatusToastType = 'success' | 'error' | 'warning' | 'info';

export interface StatusToast {
  id: string;
  message: string;
  type: StatusToastType;
  durationMs?: number;
}

interface StatusToastListProps {
  onDismiss: (id: string) => void;
  toasts: StatusToast[];
}

export function StatusToastList({ onDismiss, toasts }: StatusToastListProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed right-3 top-12 z-[60] grid w-[min(360px,calc(100vw-24px))] gap-2"
      data-status-toast-container
    >
      {toasts.map((toast) => (
        <StatusToastItem key={toast.id} onDismiss={onDismiss} toast={toast} />
      ))}
    </div>
  );
}

function StatusToastItem({
  onDismiss,
  toast
}: {
  onDismiss: (id: string) => void;
  toast: StatusToast;
}) {
  useEffect(() => {
    if (!toast.durationMs || toast.durationMs <= 0) return;

    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.durationMs, toast.id]);

  return (
    <button
      className={`grid grid-cols-[18px_minmax(0,1fr)_16px] items-start gap-2 border px-3 py-2 text-left font-mono text-[11px] leading-4 shadow-xl outline-none transition hover:brightness-110 ${toneClass(
        toast.type
      )}`}
      data-status-toast={toast.type}
      onClick={() => onDismiss(toast.id)}
      title="Dismiss status message"
      type="button"
    >
      {toastIcon(toast.type)}
      <span>{toast.message}</span>
      <X className="mt-0.5 size-3 opacity-70" />
    </button>
  );
}

function toastIcon(type: StatusToastType) {
  if (type === 'success') return <CheckCircle2 className="mt-0.5 size-4" />;
  if (type === 'error') return <XCircle className="mt-0.5 size-4" />;
  if (type === 'warning') return <AlertTriangle className="mt-0.5 size-4" />;
  return <Info className="mt-0.5 size-4" />;
}

function toneClass(type: StatusToastType) {
  if (type === 'success') return 'border-emerald-500/50 bg-emerald-950/90 text-emerald-100';
  if (type === 'error') return 'border-destructive/70 bg-red-950/90 text-red-100';
  if (type === 'warning') return 'border-amber-500/60 bg-amber-950/90 text-amber-100';
  return 'border-primary/50 bg-sky-950/90 text-sky-100';
}
