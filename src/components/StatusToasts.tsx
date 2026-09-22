import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { SlidingTabs } from '@/components/ui/SlidingTabs';

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

export function StatusNotificationMenu({ notifications, agentContent }: { notifications: StatusToast[]; agentContent?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'notifications' | 'agent'>('notifications');
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const countLabel = notifications.length > 99 ? '99+' : String(notifications.length);
  const tabs = [
    { value: 'notifications' as const, label: 'Notifications', id: `${id}-notifications-tab`, controls: `${id}-notifications-panel` },
    { value: 'agent' as const, label: 'Agent', id: `${id}-agent-tab`, controls: `${id}-agent-panel` }
  ];

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 12; const gap = 6;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(320, Math.max(0, viewportWidth - margin * 2));
      const below = Math.max(0, viewportHeight - anchor.bottom - gap - margin);
      const above = Math.max(0, anchor.top - gap - margin);
      const useAbove = below < 180 && above > below;
      setPosition({ width, left: Math.max(margin, Math.min(anchor.right - width, viewportWidth - width - margin)),
        ...(useAbove ? { bottom: Math.max(margin, viewportHeight - anchor.top + gap) }
          : { top: Math.max(margin, anchor.bottom + gap) }),
        maxHeight: Math.min(viewportHeight * 0.7, useAbove ? above : below) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-notifications-tab`)?.focus();
    const isInside = (target: EventTarget | null) => target instanceof Node &&
      (panelRef.current?.contains(target) || triggerRef.current?.contains(target));
    const outside = (event: Event) => { if (!isInside(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [id, open]);

  return (
    <div className="relative font-mono text-[10px]" data-status-notification-root>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${id}-popover` : undefined}
        aria-label="Open notifications"
        className="flex h-7 items-center gap-1 border border-border bg-background/60 px-2 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => { if (!open) setTab('notifications'); setOpen(!open); }}
        ref={triggerRef}
        title="Notifications"
        type="button"
      >
        <Bell className="size-3.5" />
        {notifications.length > 0 && (
          <span
            className="min-w-4 border border-primary/50 bg-primary/20 px-1 text-center text-[10px] text-primary"
            data-status-notification-count
          >
            {countLabel}
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          className="fixed z-50 flex min-h-0 flex-col overflow-hidden border border-border bg-card/98 p-1.5 font-mono text-[10px] shadow-2xl"
          data-status-notification-menu
          id={`${id}-popover`}
          role="dialog"
          aria-label="Notifications and agent activity"
          ref={panelRef}
          style={position}
          onKeyDown={event => event.stopPropagation()}
        >
          <SlidingTabs label="Notification panels" value={tab} onValueChange={setTab} tabs={tabs} className="shrink-0" />
          <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain px-0.5 pt-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring">
            {tab === 'agent' ? <div className="min-w-0 p-1.5">{agentContent ?? <p className="text-muted-foreground">Agent status is unavailable.</p>}</div>
              : notifications.length === 0 ? <p className="px-2 py-3 text-muted-foreground" data-status-notification-empty>No notifications</p>
                : <div className="grid gap-1">
                  {notifications.map(notification => <div
                    className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 border border-border bg-background/50 p-2"
                    data-status-notification-item data-status-notification-type={notification.type} key={notification.id}>
                    {toastIcon(notification.type)}
                    <span className="min-w-0 break-words text-foreground">{notification.message}</span>
                  </div>)}
                </div>}
            </div>
        </div>, document.body
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
