import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SlidingTab<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  id?: string;
  controls?: string;
  disabled?: boolean;
  title?: string;
}

interface SlidingTabsProps<T extends string> {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  tabs: readonly SlidingTab<T>[];
  className?: string;
}

/** Equal-width tabs keep the selection indicator stable while labels and viewports change. */
export function SlidingTabs<T extends string>({ label, value, onValueChange, tabs, className }: SlidingTabsProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const selectedIndex = tabs.findIndex(tab => tab.value === value);
  return (
    <div role="tablist" aria-label={label}
      className={cn('relative isolate inline-grid shrink-0 rounded-full border border-border bg-background/70 p-0.5 text-[11px]', className)}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const enabled = tabs.filter(tab => !tab.disabled);
        if (!enabled.length) return;
        event.preventDefault();
        const current = enabled.findIndex(tab => buttons.current.get(tab.value) === event.target);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
          : (Math.max(0, current) + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
        buttons.current.get(enabled[index].value)?.focus();
        onValueChange(enabled[index].value);
      }}>
      {selectedIndex >= 0 && <span aria-hidden="true"
        className="pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 rounded-full border border-primary/30 bg-primary/15 shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 4px) / ${tabs.length})`, transform: `translateX(${selectedIndex * 100}%)` }} />}
      {tabs.map(tab => <button key={tab.value} id={tab.id} role="tab" type="button"
        ref={element => { if (element) buttons.current.set(tab.value, element); else buttons.current.delete(tab.value); }}
        aria-controls={tab.controls} aria-selected={tab.value === value} disabled={tab.disabled}
        tabIndex={tab.value === value ? 0 : -1} title={tab.title}
        className={cn('relative z-10 flex h-6 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3 [&_svg]:shrink-0',
          tab.value === value ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}
        onClick={() => onValueChange(tab.value)}>
        {tab.icon}<span>{tab.label}</span>
      </button>)}
    </div>
  );
}
