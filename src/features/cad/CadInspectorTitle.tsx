import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The inspector heading slot an editor can name; claiming it hides the panel's default label. */
export interface CadInspectorTitleHost { readonly slot: HTMLElement | null; claim(): () => void }
export const CadInspectorTitleContext = createContext<CadInspectorTitleHost | null>(null);

/** An editor's title: shown in the inspector heading beside its actions, or inline outside an inspector. */
export function CadInspectorTitle({ children }: { children: ReactNode }) {
  const host = useContext(CadInspectorTitleContext);
  useLayoutEffect(() => host?.claim(), [host]);
  return host?.slot ? createPortal(<span className="cad-inspector-title">{children}</span>, host.slot) : <div className="cad-property-title">{children}</div>;
}
