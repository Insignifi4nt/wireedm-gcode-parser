import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type StatusToastType = 'success' | 'error' | 'warning' | 'info';

export interface StatusToast {
  createdAt: number;
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
      className="pointer-events-none fixed left-1/2 top-3 z-50 grid w-[min(320px,calc(100vw-24px))] -translate-x-1/2 gap-1.5"
      data-status-toast-container
      data-status-toast-placement="top-center"
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
      className={`pointer-events-auto grid min-h-9 grid-cols-[16px_minmax(0,1fr)_14px] items-center gap-1.5 border px-2 py-1.5 text-left font-mono text-[10px] leading-4 shadow-lg outline-none backdrop-blur transition hover:brightness-110 ${toneClass(
        toast.type
      )}`}
      data-status-toast={toast.type}
      onClick={() => onDismiss(toast.id)}
      title="Dismiss status message"
      type="button"
    >
      {toastIcon(toast.type)}
      <span className="min-w-0 truncate">{toast.message}</span>
      <X className="size-3 opacity-70" />
    </button>
  );
}

export function StatusNotificationMenu({ notifications }: { notifications: StatusToast[] }) {
  const [open, setOpen] = useState(false);
  const countLabel = notifications.length > 99 ? '99+' : String(notifications.length);

  return (
    <div className="relative font-mono text-[10px]" data-status-notification-root>
      <button
        aria-expanded={open}
        aria-label="Open notifications"
        className="flex h-7 items-center gap-1 border border-border bg-background/60 px-2 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
        onClick={() => setOpen((current) => !current)}
        title="Notifications"
        type="button"
      >
        <Bell className="size-3.5" />
        {notifications.length > 0 && (
          <span
            className="min-w-4 border border-primary/50 bg-primary/20 px-1 text-center text-[8px] text-primary"
            data-status-notification-count
          >
            {countLabel}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-50 grid max-h-[70vh] w-[min(320px,calc(100vw-24px))] overflow-auto border border-border bg-card/98 p-1.5 shadow-2xl"
          data-status-notification-menu
        >
          <div className="flex h-7 items-center justify-between border-b border-border px-1.5 text-[9px] uppercase text-muted-foreground">
            <span>Notifications</span>
            <span>{notifications.length}</span>
          </div>
          {notifications.length === 0 ? (
            <p className="px-2 py-3 text-muted-foreground" data-status-notification-empty>
              No notifications
            </p>
          ) : (
            <div className="grid gap-1 pt-1">
              {notifications.map((notification) => (
                <div
                  className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 border border-border bg-background/50 p-2"
                  data-status-notification-item
                  data-status-notification-type={notification.type}
                  key={notification.id}
                >
                  {toastIcon(notification.type)}
                  <span className="min-w-0 text-foreground">{notification.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toastIcon(type: StatusToastType) {
  if (type === 'success') return <CheckCircle2 className="size-3.5" />;
  if (type === 'error') return <XCircle className="size-3.5" />;
  if (type === 'warning') return <AlertTriangle className="size-3.5" />;
  return <Info className="size-3.5" />;
}

function toneClass(type: StatusToastType) {
  if (type === 'success') return 'border-emerald-500/45 bg-emerald-950/85 text-emerald-100';
  if (type === 'error') return 'border-destructive/65 bg-red-950/90 text-red-100';
  if (type === 'warning') return 'border-amber-500/55 bg-amber-950/85 text-amber-100';
  return 'border-primary/45 bg-sky-950/85 text-sky-100';
}
