import { Value } from '@sinclair/typebox/value';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { ToolError } from '@/features/webmcp/siteTools';
import { CadViewportCommandSchema, type CadRenderedViewControls, type CadViewportCapture, type CadViewportState, type CadWorkbenchViewportControls } from './cadViewportControls';

export interface CadViewportBindings extends Omit<CadViewportState, 'documentId' | 'view'> {
  readonly document: CadDocument;
  readonly rendered: CadRenderedViewControls | null;
  selectFeature(id: string | null): void;
  editSketch(id: string): void;
  selectProfile(id: string | null): void;
  finishSketch(): void;
  updateView(action: () => void): void;
}

/** UI and agent requests share the same workflow, identity and rendered-source checks. */
export function createCadWorkbenchViewportControls(getBindings: () => CadViewportBindings): CadWorkbenchViewportControls {
  function readable() {
    const bindings = getBindings();
    if (bindings.workflowOpen) throw new ToolError('WORKFLOW_OPEN', 'Apply or cancel the current CAD edit before controlling or capturing the viewport.');
    if (bindings.busy) throw new ToolError('BUSY', 'Wait for the running CAD operation.');
    return bindings;
  }
  function getState(): CadViewportState {
    const bindings = getBindings();
    return Object.freeze({ documentId: bindings.document.id, documentVersion: bindings.documentVersion, dirty: bindings.dirty,
      selectedFeatureId: bindings.selectedFeatureId, selectedProfileId: bindings.selectedProfileId, sketchId: bindings.sketchId,
      workflowOpen: bindings.workflowOpen, busy: bindings.busy, buildVersion: bindings.buildVersion,
      buildState: bindings.buildState, visibleBodyIds: Object.freeze([...bindings.visibleBodyIds]), view: bindings.rendered?.getState() ?? null });
  }
  // Busy may change because the caller acquires the capture lock. Only visual content matters.
  function visualIdentity(state: CadViewportState) {
    return JSON.stringify([state.documentId, state.documentVersion, state.selectedFeatureId, state.selectedProfileId,
      state.sketchId, state.view?.mode === 'solid' ? state.buildVersion : null, state.view?.mode === 'solid' ? state.buildState : null, state.view]);
  }
  return {
    getState,
    apply(command) {
      if (!Value.Check(CadViewportCommandSchema, command)) throw new ToolError('INVALID_INPUT', 'Invalid CAD viewport command.');
      const bindings = readable();
      const rendered = bindings.rendered;
      bindings.updateView(() => {
        switch (command.kind) {
          case 'select-feature':
            if (command.featureId !== null && !bindings.document.features.some((feature) => feature.id === command.featureId)) throw new ToolError('NOT_FOUND', 'Feature does not exist in the current CAD draft.');
            bindings.selectFeature(command.featureId); return;
          case 'edit-sketch':
            if (!bindings.document.features.some((feature) => feature.kind === 'sketch' && feature.id === command.sketchId && !feature.suppressed)) throw new ToolError('NOT_FOUND', 'Choose an active sketch in the current CAD draft.');
            bindings.editSketch(command.sketchId); return;
          case 'select-profile': {
            const sketch = bindings.document.features.find((feature) => feature.kind === 'sketch' && feature.id === bindings.sketchId);
            if (sketch?.kind !== 'sketch') throw new ToolError('WRONG_VIEW', 'Open the sketch editor before selecting a profile.');
            if (command.profileId !== null && !sketch.profiles.some((profile) => profile.id === command.profileId)) throw new ToolError('NOT_FOUND', 'Profile does not exist in the active sketch.');
            bindings.selectProfile(command.profileId); return;
          }
          case 'finish-sketch':
            if (!bindings.sketchId) throw new ToolError('WRONG_VIEW', 'No sketch editor is open.');
            bindings.finishSketch(); return;
          case 'set-view':
            if (bindings.sketchId || !rendered?.setView) throw new ToolError('WRONG_VIEW', 'Finish sketch editing before selecting a named solid view.');
            rendered.setView(command.view); return;
          case 'fit':
            if (!rendered) throw new ToolError('VIEW_UNAVAILABLE', 'Wait for the viewport to load.');
            rendered.fit(); return;
          case 'set-grid':
            if (!rendered) throw new ToolError('VIEW_UNAVAILABLE', 'Wait for the viewport to load.');
            rendered.setGrid(command.visible); return;
          default: { const exhaustive: never = command; throw exhaustive; }
        }
      });
    },
    async capture(signal): Promise<CadViewportCapture> {
      signal.throwIfAborted();
      const bindings = readable();
      const rendered = bindings.rendered;
      const before = getState();
      if (!rendered || !before.view?.available) throw new ToolError('CAPTURE_UNAVAILABLE', 'Wait for a visible CAD viewport to load.');
      if (before.view.mode === 'solid' && (bindings.buildState !== 'ready' || bindings.buildVersion !== bindings.documentVersion)) throw new ToolError('STALE_STATE', 'Wait for this exact CAD draft to finish building before capturing its solid view.');
      const image = await rendered.capture(signal);
      signal.throwIfAborted();
      const after = getState();
      if (after.documentId !== before.documentId || after.documentVersion !== before.documentVersion) throw new ToolError('STALE_STATE', 'The CAD draft changed during capture. Read context and capture again.');
      if (after.workflowOpen || visualIdentity(after) !== visualIdentity(before)) throw new ToolError('STALE_VIEW', 'The CAD view changed during capture. Capture the current view again.');
      return Object.freeze({ image, contentSource: 'cad-draft', documentId: before.documentId, documentVersion: before.documentVersion,
        dirty: before.dirty, sketchId: before.sketchId, buildVersion: before.view.mode === 'solid' ? before.buildVersion : null, viewState: before });
    },
  };
}
