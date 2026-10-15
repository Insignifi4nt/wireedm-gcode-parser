import { Button } from '@/components/ui/button';
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExpandDownIcon } from '@wire-edm/icons-react';
import './cad-command-dock.css';

const ViewToolsHost = createContext<{ host: HTMLDivElement | null; open: boolean; close(): void } | undefined>(undefined);
const ViewToolsVisible = createContext(true);

/** Portaled help follows its View controls, without hiding unrelated canvas help. */
export function useCadViewToolsVisible() { return useContext(ViewToolsVisible); }

/** Disclosure changes only the dock layout; the live viewport remains mounted. */
export function CadCommandDock({ toolbar, children }: { toolbar: ReactNode; children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); toggle.current?.focus(); }, []);
  const context = useMemo(() => ({ host, open, close }), [host, open, close]);
  return <ViewToolsHost.Provider value={context}>
    {children}
    <div data-cad-command-dock className={`cad-command-dock${open ? ' is-view-open' : ''}`}>
      {toolbar}
      <div id={drawerId} className="cad-command-view-drawer" inert={!open} aria-hidden={!open}><div className="cad-command-view-content" ref={setHost} /></div>
      <Button ref={toggle} type="button" className="cad-command-view-tab" aria-label="View controls" aria-expanded={open} aria-controls={drawerId}
        onKeyDown={event => {
          if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
          event.preventDefault(); event.stopPropagation(); close();
        }}
        onClick={() => setOpen(value => !value)}>View <ExpandDownIcon size={10} /></Button>
    </div>
  </ViewToolsHost.Provider>;
}

export function CadViewTools({ children, label }: { children: ReactNode; label: string }) {
  const context = useContext(ViewToolsHost);
  const controls = <ViewToolsVisible.Provider value={context?.open ?? true}><div className="cad-view-tools" role="group" aria-label={label} onKeyDown={event => {
    if (!context || event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
    event.preventDefault(); event.stopPropagation(); context.close();
  }}>{children}</div></ViewToolsVisible.Provider>;
  return context === undefined ? controls : context.host ? createPortal(controls, context.host) : null;
}
