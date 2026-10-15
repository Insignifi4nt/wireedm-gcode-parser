import { useEffect, useRef } from 'react';
import type { StatusToastType } from '@/components/StatusToasts';
import type { CadBuildResult, CadDocument } from '@/domain/cad/cadDocument';

export interface CadNotificationState {
  document: CadDocument;
  documentVersion: string;
  buildVersion: string | null;
  build: CadBuildResult | null;
  buildState: 'idle' | 'building' | 'ready' | 'error';
  errorMessage: string | null;
  onStatusMessage?: (message: string, type: StatusToastType) => void;
}

/** Report failure episodes, not renders or retries of the same failed build. */
export function useCadNotifications(state: CadNotificationState) {
  const reporter = useRef(state.onStatusMessage);
  reporter.current = state.onStatusMessage;
  const previous = useRef<{ documentId: string; diagnostics: Set<string>; error: string | null }>({ documentId: state.document.id, diagnostics: new Set(), error: null });
  useEffect(() => {
    const report = reporter.current;
    if (!report) return;
    if (previous.current.documentId !== state.document.id) {
      previous.current = { documentId: state.document.id, diagnostics: new Set(), error: null };
    }
    const history = previous.current;
    if (state.errorMessage && state.errorMessage !== history.error) {
      report(`${state.document.name}: ${state.errorMessage}`, 'error');
    }
    history.error = state.errorMessage;
    if (!state.build || state.buildVersion !== state.documentVersion || (state.buildState !== 'ready' && state.buildState !== 'error')) return;
    const stopped = state.build.diagnostics.find(diagnostic => diagnostic.code === 'rebuild-stopped');
    const failures = state.build.diagnostics.filter(diagnostic => diagnostic !== stopped);
    // A standalone stopped diagnostic must still be visible if no cause was supplied.
    const diagnostics = failures.length ? failures : stopped ? [stopped] : [];
    const current = new Set<string>();
    for (const diagnostic of diagnostics) {
      const identity = JSON.stringify([diagnostic.code, diagnostic.featureId, diagnostic.message]);
      current.add(identity);
      if (history.diagnostics.has(identity)) continue;
      const feature = state.document.features.find(entry => entry.id === diagnostic.featureId);
      const context = stopped && diagnostic !== stopped ? ` ${stopped.message}` : '';
      report(`${state.document.name}${feature ? ` · ${feature.name}` : ''}: ${diagnostic.message}${context}`, 'error');
    }
    history.diagnostics = current;
  }, [state.document, state.documentVersion, state.buildVersion, state.build, state.buildState, state.errorMessage, state.onStatusMessage]);
}
