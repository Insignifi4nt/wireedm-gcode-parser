import { useEffect, useRef, type FormEvent } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type {
  DxfImportPreparation,
  DxfImportPreparationResult,
  DxfImportPreview,
  DxfImportPreviewResult
} from '@/domain/dxf/prepareDxfProjectImport';

import type { ResolvedPlanningMachineFit } from './dashboardTypes';

export interface DxfImportConfirmationDialogProps {
  declaredUnitOverrideAcknowledged: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  onOverrideAcknowledgedChange: (acknowledged: boolean) => void;
  onRebuildAcknowledgedChange?: (acknowledged: boolean) => void;
  onUnitCandidateChange: (candidateId: string) => void;
  planningMachineFit: ResolvedPlanningMachineFit | null;
  preparationResult: DxfImportPreparationResult;
  previewResult: DxfImportPreviewResult | null;
  selectedUnitCandidateId: string | null;
  submitting: boolean;
  mode?: 'import' | 'reimport';
  rebuildAcknowledged?: boolean;
  rebuildRequired?: boolean;
}

export function DxfImportConfirmationDialog({
  declaredUnitOverrideAcknowledged,
  errorMessage,
  onCancel,
  onConfirm,
  onOverrideAcknowledgedChange,
  onRebuildAcknowledgedChange,
  onUnitCandidateChange,
  planningMachineFit,
  preparationResult,
  previewResult,
  selectedUnitCandidateId,
  submitting,
  mode = 'import',
  rebuildAcknowledged = false,
  rebuildRequired = false
}: DxfImportConfirmationDialogProps) {
  const reimport = mode === 'reimport';
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const unitSelectRef = useRef<HTMLSelectElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const latestCancelRef = useRef(onCancel);
  const latestSubmittingRef = useRef(submitting);
  latestCancelRef.current = onCancel;
  latestSubmittingRef.current = submitting;

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;
    const activeDialog: HTMLFormElement = dialog;

    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const siblings = readModalBackgroundSiblings(overlay).map((element) => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      element,
      inertAttribute: element.getAttribute('inert'),
      inertProperty: element.inert
    }));
    siblings.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });
    (unitSelectRef.current ?? activeDialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (latestSubmittingRef.current) return;
        event.preventDefault();
        latestCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = readFocusableElements(activeDialog);
      const first = focusable[0] ?? activeDialog;
      const last = focusable.at(-1) ?? activeDialog;
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !activeDialog.contains(active);
      if (outside || (!event.shiftKey && active === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      siblings.forEach((snapshot) => {
        snapshot.element.inert = snapshot.inertProperty;
        if (snapshot.inertAttribute === null) snapshot.element.removeAttribute('inert');
        else snapshot.element.setAttribute('inert', snapshot.inertAttribute);
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
        else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
      });
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, []);

  const preparation = preparationResult.ok ? preparationResult.preparation : null;
  const selectedCandidate = preparation?.unitCandidates.find(
    ({ id }) => id === selectedUnitCandidateId
  ) ?? null;
  const declaration = preparation?.parseResult.unitDeclaration ?? null;
  const declaredScale = declaration?.status === 'recognized'
    ? declaration.units.scaleToMillimeters
    : null;
  const overridesDeclaration =
    declaredScale !== null &&
    selectedCandidate !== null &&
    selectedCandidate.scaleToMillimeters !== declaredScale;
  const preview = readMatchingPreview(previewResult, selectedUnitCandidateId);
  const previewMismatch =
    previewResult?.ok === true &&
    previewResult.preview.unitCandidate.id !== selectedUnitCandidateId;
  const confirmationBlocked =
    submitting ||
    !preparationResult.ok ||
    selectedCandidate === null ||
    preview === null ||
    previewMismatch ||
    (overridesDeclaration && !declaredUnitOverrideAcknowledged) ||
    (rebuildRequired && !rebuildAcknowledged);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmationBlocked) void onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      data-dxf-import-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          event.preventDefault();
          onCancel();
        }
      }}
      ref={overlayRef}
    >
      <form
        aria-label={reimport ? 'Review DXF unit re-import' : 'Review DXF import'}
        aria-modal="true"
        className="grid max-h-[88vh] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border border-border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="font-mono text-base font-semibold">
              {reimport ? 'Re-import DXF with Different Units' : 'Review DXF Import'}
            </h2>
            {preparation && (
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {preparation.fileName}
              </p>
            )}
          </div>
          <button
            aria-label={reimport ? 'Close DXF unit re-import review' : 'Close DXF import review'}
            className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground disabled:opacity-45"
            disabled={submitting}
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="work-region-scrollbar min-h-0 overflow-auto p-4 font-mono text-[11px]">
          <div className="grid gap-4">
            {preparation && <PreparationCounts preparation={preparation} preview={preview} />}

            {preparation && <SourceReview preparation={preparation} preview={preview} />}

            {preparation && (
              <section className="grid gap-3 border border-border bg-background/45 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold">Source units</h3>
                  {selectedCandidate && (
                    <span className="border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] text-primary">
                      {candidateSourceLabel(selectedCandidate.source, overridesDeclaration)}
                    </span>
                  )}
                </div>
                <label className="grid gap-1 text-muted-foreground">
                  DXF units
                  <select
                    aria-label="DXF units"
                    className="h-8 border border-border bg-background px-2 text-foreground outline-none focus:border-ring"
                    disabled={submitting}
                    onChange={(event) => onUnitCandidateChange(event.currentTarget.value)}
                    ref={unitSelectRef}
                    value={selectedUnitCandidateId ?? ''}
                  >
                    <option disabled value="">Select drawing units</option>
                    {preparation.unitCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label} (×{formatScale(candidate.scaleToMillimeters)})
                      </option>
                    ))}
                  </select>
                </label>
                {overridesDeclaration && (
                  <label className="flex items-start gap-2 border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
                    <input
                      aria-label="Override declared DXF units"
                      checked={declaredUnitOverrideAcknowledged}
                      className="mt-0.5"
                      disabled={submitting}
                      onChange={(event) =>
                        onOverrideAcknowledgedChange(event.currentTarget.checked)
                      }
                      type="checkbox"
                    />
                    Override declared DXF units
                  </label>
                )}
              </section>
            )}

            <section className="grid gap-3 border border-border bg-background/45 p-3">
              <h3 className="text-xs font-semibold">Result</h3>
              <div aria-live="polite" className="grid gap-2">
                {preview ? (
                  <PreviewGeometry preview={preview} />
                ) : (
                  <p className="text-muted-foreground">
                    {selectedCandidate ? 'Preview unavailable.' : 'Select drawing units to preview.'}
                  </p>
                )}
                {planningMachineFit && (
                  <PlanningMachineFitSummary planningMachineFit={planningMachineFit} />
                )}
              </div>
            </section>

            {reimport && rebuildRequired && (
              <label className="flex items-start gap-2 border border-amber-500/50 bg-amber-500/10 p-3 text-amber-200">
                <input
                  aria-label="Rebuild path geometry from raw DXF"
                  checked={rebuildAcknowledged}
                  className="mt-0.5"
                  disabled={submitting}
                  onChange={(event) =>
                    onRebuildAcknowledgedChange?.(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>
                  Rebuild the path from the persisted raw DXF. This replaces current geometry edits,
                  starts, directions, leads, compensation, inactive ranges, threading, initial wire
                  position, and stops. The original DXF and saved output revisions remain stored.
                </span>
              </label>
            )}

            {!preparationResult.ok && <ErrorMessage message={preparationResult.error.message} />}
            {previewResult && !previewResult.ok && (
              <ErrorMessage message={previewResult.error.message} />
            )}
            {previewMismatch && (
              <ErrorMessage message="DXF preview does not match the selected unit candidate." />
            )}
            {errorMessage && <ErrorMessage message={errorMessage} />}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border p-3">
          <Button disabled={submitting} onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={confirmationBlocked} type="submit">
            {submitting
              ? reimport ? 'Re-importing...' : 'Importing...'
              : reimport ? 'Re-import and open' : 'Import and open'}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function PreparationCounts({ preparation, preview }: { preparation: DxfImportPreparation; preview: DxfImportPreview | null }) {
  return (
    <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
      <span>{preparation.entityCount} supported source {preparation.entityCount === 1 ? 'entity' : 'entities'}</span>
      <span aria-hidden="true">/</span>
      <span>{preparation.unsupportedEntityCount} unsupported entity {preparation.unsupportedEntityCount === 1 ? 'type' : 'types'}</span>
      <span aria-hidden="true">/</span>
      <span>{preparation.warningCount + (preview?.geometryWarnings.length ?? 0)} warnings</span>
    </div>
  );
}

function SourceReview({ preparation, preview }: { preparation: DxfImportPreparation; preview: DxfImportPreview | null }) {
  const layers = new Map<string | null, number>();
  for (const entity of preparation.parseResult.entities) layers.set(entity.layer, (layers.get(entity.layer) ?? 0) + 1);
  const warnings = [...preparation.parseResult.warnings, ...(preview?.geometryWarnings ?? [])];
  return (
    <section className="grid gap-2 border border-border bg-background/45 p-3" aria-label="DXF source review">
      <h3 className="text-xs font-semibold">Source layers</h3>
      <p className="text-muted-foreground">All supported layers are included. Layer names remain attached to imported geometry.</p>
      <ul className="max-h-28 overflow-auto text-muted-foreground">
        {[...layers].map(([layer, count]) => <li key={layer === null ? 'missing-layer' : `layer:${layer}`}>
          {layer === null ? '(No layer)' : layer} · {count} source {count === 1 ? 'entity' : 'entities'}
        </li>)}
      </ul>
      {warnings.length > 0 && <div className="border-t border-amber-500/40 pt-2 text-amber-200" role="status">
        <h4 className="font-semibold">Import warnings</h4>
        <ul className="mt-1 max-h-32 list-disc overflow-auto pl-4">
          {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      </div>}
    </section>
  );
}

function PreviewGeometry({ preview }: { preview: DxfImportPreview }) {
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">Path segments</dt>
      <dd>{preview.segmentCount}</dd>
      <dt className="text-muted-foreground">Resulting size</dt>
      <dd data-testid="dxf-import-size">
        {formatMm(preview.sizeMm.widthMm)} × {formatMm(preview.sizeMm.lengthMm)} mm
      </dd>
      <dt className="text-muted-foreground">X bounds</dt>
      <dd>{formatMm(preview.boundsMm.minX)}..{formatMm(preview.boundsMm.maxX)} mm</dd>
      <dt className="text-muted-foreground">Y bounds</dt>
      <dd>{formatMm(preview.boundsMm.minY)}..{formatMm(preview.boundsMm.maxY)} mm</dd>
    </dl>
  );
}

function PlanningMachineFitSummary({
  planningMachineFit
}: {
  planningMachineFit: ResolvedPlanningMachineFit;
}) {
  const { machine, result } = planningMachineFit;
  if (!result.ok) {
    return (
      <p
        className="border border-destructive/70 bg-destructive/10 p-2 text-destructive"
        data-dxf-import-machine-fit="error"
        role="alert"
      >
        {machine.name}: {result.error.message}
      </p>
    );
  }
  if (result.fit.status === 'too-large') {
    return (
      <p
        className="border border-destructive/70 bg-destructive/10 p-2 text-destructive"
        data-dxf-import-machine-fit="too-large"
      >
        {machine.name} does not fit: {result.fit.issues.map((issue) =>
          `${issue.axis.toUpperCase()} ${formatMm(issue.actualMm)} > ${formatMm(issue.limitMm)} mm`
        ).join('; ')}
      </p>
    );
  }
  if (result.fit.status === 'fits') {
    return (
      <p
        className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-300"
        data-dxf-import-machine-fit="fits"
      >
        Fits planning machine {machine.name}.
      </p>
    );
  }
  return (
    <p
      className="border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200"
      data-dxf-import-machine-fit="indeterminate"
    >
      Fit for planning machine {machine.name} is indeterminate: unknown{' '}
      {result.fit.unknownAxes.map((axis) => axis.toUpperCase()).join('/')} travel.
    </p>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="border border-destructive bg-destructive/10 p-2 text-destructive" role="alert">
      {message}
    </p>
  );
}

function readMatchingPreview(
  result: DxfImportPreviewResult | null,
  selectedUnitCandidateId: string | null
) {
  return result?.ok === true && result.preview.unitCandidate.id === selectedUnitCandidateId
    ? result.preview
    : null;
}

function candidateSourceLabel(
  source: DxfImportPreparation['unitCandidates'][number]['source'],
  overridesDeclaration: boolean
) {
  if (overridesDeclaration) return 'Declared unit override';
  if (source === 'dxf-declared') return 'Declared by DXF';
  if (source === 'workbench-preference') return 'Workbench preference';
  return 'Explicit choice';
}

function readFocusableElements(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

function readModalBackgroundSiblings(overlay: HTMLElement) {
  const siblings: HTMLElement[] = [];
  let activeBranch: HTMLElement = overlay;
  while (activeBranch.parentElement) {
    const parent: HTMLElement = activeBranch.parentElement;
    siblings.push(...[...parent.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== activeBranch
    ));
    if (parent === document.body) break;
    activeBranch = parent;
  }
  return siblings;
}

function formatMm(value: number) {
  return value.toFixed(3);
}

function formatScale(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(8)));
}
