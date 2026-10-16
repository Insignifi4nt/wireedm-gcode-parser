import { Button } from '@/components/ui/button';
import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExpandDownIcon } from '@wire-edm/icons-react';
import './cad-command-dock.css';

const ViewToolsHost = createContext<{ host: HTMLDivElement | null; open: boolean; close(): void } | undefined>(undefined);
const ViewToolsVisible = createContext(true);
const CommandToolsHost = createContext<{ host: HTMLDivElement | null; setActive(active: boolean): void } | undefined>(undefined);

/** Portaled help follows its View controls, without hiding unrelated canvas help. */
export function useCadViewToolsVisible() { return useContext(ViewToolsVisible); }

/** Disclosure changes only the dock layout; the live viewport remains mounted. */
export function CadCommandDock({ toolbar, children }: { toolbar: ReactNode; children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [commandHost, setCommandHost] = useState<HTMLDivElement | null>(null);
  const [commandActive, setCommandActive] = useState(false);
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); toggle.current?.focus(); }, []);
  const context = useMemo(() => ({ host, open, close }), [host, open, close]);
  const commandContext = useMemo(() => ({ host: commandHost, setActive: setCommandActive }), [commandHost]);
  return <ViewToolsHost.Provider value={context}><CommandToolsHost.Provider value={commandContext}>
    {children}
    <div data-cad-command-dock className={`cad-command-dock${open ? ' is-view-open' : ''}`}>
      <div className="cad-command-active-tools" ref={setCommandHost} />
      <div className="cad-command-primary-tools" hidden={commandActive} inert={commandActive}>{toolbar}</div>
      <div id={drawerId} className="cad-command-view-drawer" inert={!open} aria-hidden={!open}><div className="cad-command-view-content" ref={setHost} /></div>
      <Button ref={toggle} type="button" className="cad-command-view-tab" aria-label="View controls" aria-expanded={open} aria-controls={drawerId}
        onKeyDown={event => {
          if (!open || event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
          event.preventDefault(); event.stopPropagation(); close();
        }}
        onClick={() => setOpen(value => !value)}>View <ExpandDownIcon size={10} /></Button>
    </div>
  </CommandToolsHost.Provider></ViewToolsHost.Provider>;
}

/** Unfinished drawing owns the same reachable command row instead of covering it. */
export function CadDrawingTools({ active, children }: { active: boolean; children: ReactNode }) {
  const context = useContext(CommandToolsHost), publish = context?.setActive;
  useLayoutEffect(() => {
    publish?.(active);
    return () => publish?.(false);
  }, [active, publish]);
  return context ? context.host ? createPortal(children, context.host) : null : children;
}

export function CadViewTools({ children, label }: { children: ReactNode; label: string }) {
  const context = useContext(ViewToolsHost);
  const controls = <ViewToolsVisible.Provider value={context?.open ?? true}><div className="cad-view-tools" role="group" aria-label={label} onKeyDown={event => {
    if (!context || event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
    event.preventDefault(); event.stopPropagation(); context.close();
  }}>{children}</div></ViewToolsVisible.Provider>;
  return context === undefined ? controls : context.host ? createPortal(controls, context.host) : null;
}
