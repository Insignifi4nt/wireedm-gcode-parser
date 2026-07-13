import { useEffect, useRef, type FormEvent } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DxfImportUnitCandidate } from '@/domain/dxf/dxfImportUnits';
import type {
  DxfImportPreparation,
  DxfImportPreview,
  DxfImportSelection
} from '@/domain/dxf/prepareDxfProjectImport';

export interface DxfImportConfirmationDialogProps {
  declaredUnitOverrideAcknowledged: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  onMachineProfileChange: (profileId: string) => void;
  onOverrideAcknowledgedChange: (acknowledged: boolean) => void;
  onUnitCandidateChange: (candidateId: string) => void;
  preparation: DxfImportPreparation;
  preview: DxfImportPreview | null;
  previewErrorMessage: string | null;
  selection: DxfImportSelection;
  submitting: boolean;
  unitCandidates: DxfImportUnitCandidate[];
}

export function DxfImportConfirmationDialog({
  declaredUnitOverrideAcknowledged,
  errorMessage,
  onCancel,
  onConfirm,
  onMachineProfileChange,
  onOverrideAcknowledgedChange,
  onUnitCandidateChange,
  preparation,
  preview,
  previewErrorMessage,
  selection,
  submitting,
  unitCandidates
}: DxfImportConfirmationDialogProps) {
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

  const selectedCandidate = preview?.unitCandidate
    ?? unitCandidates.find(({ id }) => id === selection.unitCandidateId)
    ?? null;
  const declaration = preparation.parseResult.unitDeclaration;
  const declaredScale = declaration.status === 'recognized'
    ? declaration.units.scaleToMillimeters
    : null;
  const overridesDeclaration =
    declaredScale != null && selectedCandidate?.scaleToMillimeters !== declaredScale;
  const sourceBadge = overridesDeclaration
    ? 'User override'
    : selectedCandidate?.source === 'dxf-declared'
      ? 'Declared by DXF'
      : selectedCandidate?.source === 'machine-suggestion'
        ? 'Machine suggestion'
        : 'Not declared';
  const confirmationBlocked =
    submitting || !preview || Boolean(previewErrorMessage) ||
    (overridesDeclaration && !declaredUnitOverrideAcknowledged);
  const displayError = previewErrorMessage ?? errorMessage;

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
        aria-label="Review DXF import"
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
            <h2 className="font-mono text-base font-semibold">Review DXF Import</h2>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {preparation.fileName}
            </p>
          </div>
          <button
            aria-label="Close DXF import review"
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
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              <span>{preparation.entityCount} supported</span>
              <span aria-hidden="true">/</span>
              <span>{preparation.unsupportedEntityCount} unsupported</span>
              <span aria-hidden="true">/</span>
              <span>{preparation.warningCount} warnings</span>
            </div>

            <section className="grid gap-3 border border-border bg-background/45 p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold">Source units</h3>
                <span className="border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] text-primary">
                  {sourceBadge}
                </span>
              </div>
              <label className="grid gap-1 text-muted-foreground">
                DXF units
                <select
                  aria-label="DXF units"
                  className="h-8 border border-border bg-background px-2 text-foreground outline-none focus:border-ring"
                  disabled={submitting}
                  onChange={(event) => onUnitCandidateChange(event.currentTarget.value)}
                  ref={unitSelectRef}
                  value={selection.unitCandidateId}
                >
                  {unitCandidates.map((candidate) => (
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
                    onChange={(event) => onOverrideAcknowledgedChange(event.currentTarget.checked)}
                    type="checkbox"
                  />
                  Override declared DXF units
                </label>
              )}
            </section>

            <section className="grid gap-3 border border-border bg-background/45 p-3">
              <h3 className="text-xs font-semibold">Machine and result</h3>
              <label className="grid gap-1 text-muted-foreground">
                Machine profile
                <select
                  aria-label="Machine profile"
                  className="h-8 border border-border bg-background px-2 text-foreground outline-none focus:border-ring"
                  disabled={submitting}
                  onChange={(event) => onMachineProfileChange(event.currentTarget.value)}
                  value={selection.machineProfileId}
                >
                  {preparation.machineProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                  ))}
                </select>
              </label>

              <div aria-live="polite" className="grid gap-2">
                {preview ? (
                  <>
                    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Resulting size</dt>
                      <dd data-testid="dxf-import-size">
                        {formatMm(preview.sizeMm.widthMm)} × {formatMm(preview.sizeMm.lengthMm)} mm
                      </dd>
                      <dt className="text-muted-foreground">X bounds</dt>
                      <dd>{formatMm(preview.boundsMm.minX)}..{formatMm(preview.boundsMm.maxX)} mm</dd>
                      <dt className="text-muted-foreground">Y bounds</dt>
                      <dd>{formatMm(preview.boundsMm.minY)}..{formatMm(preview.boundsMm.maxY)} mm</dd>
                    </dl>
                    <MachineFitSummary preview={preview} />
                  </>
                ) : (
                  <p className="text-muted-foreground">Preview unavailable.</p>
                )}
              </div>
            </section>

            {displayError && (
              <p className="border border-destructive bg-destructive/10 p-2 text-destructive" role="alert">
                {displayError}
              </p>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border p-3">
          <Button disabled={submitting} onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={confirmationBlocked} type="submit">
            {submitting ? 'Importing...' : 'Import and open'}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function MachineFitSummary({ preview }: { preview: DxfImportPreview }) {
  const { machineFit } = preview;
  if (machineFit.status === 'too-large') {
    return (
      <p
        className="border border-destructive/70 bg-destructive/10 p-2 text-destructive"
        data-dxf-import-machine-fit="too-large"
      >
        Does not fit: {machineFit.issues.map((issue) =>
          `${issue.axis} ${formatMm(issue.actualMm)} > ${formatMm(issue.limitMm)} mm`
        ).join('; ')}
      </p>
    );
  }
  if (machineFit.status === 'fits') {
    return (
      <p className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-300" data-dxf-import-machine-fit="fits">
        Fits configured machine work area.
      </p>
    );
  }
  return (
    <p className="border border-border p-2 text-muted-foreground" data-dxf-import-machine-fit="unchecked">
      Machine work-area limits are not configured.
    </p>
  );
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
