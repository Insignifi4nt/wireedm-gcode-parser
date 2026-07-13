# DXF Import Unit Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-mutating DXF preparation and confirmation flow that records source-unit provenance, selects a machine snapshot, normalizes geometry to millimetres exactly once, and safely supports later raw-source reinterpretation.

**Architecture:** DXF import is split into parse/prepare/preview and confirmed commit. Raw `$INSUNITS` remains provenance, while a separate applied-units record owns the actual scale. The selected machine profile supplies only a suggestion and project snapshot; it never silently chooses CAD units or post output units.

**Tech Stack:** TypeScript, React, Vite, Vitest, Playwright, local-first storage adapters.

## Global Constraints

- UPID geometry remains canonical millimetres.
- Recognized `$INSUNITS` is preferred and visibly identified.
- Missing, unitless, malformed, or unknown units require explicit confirmation.
- Machine profile import preference is a suggestion only.
- G20/G21 never infers DXF source units.
- Normalize from raw parsed entities exactly once; never multiply an existing UPID in place.
- Persist raw declaration, applied unit, basis, confirmation, and scale.
- Unit reinterpretation rebuilds from the persisted raw DXF except confirmation of legacy scale-1 millimetres.
- Preparation and cancellation perform no storage writes.
- Machine selection snapshots the profile without changing the workbench default.
- G20 blocks UPID export until post coordinate conversion exists.
- This work lands after and separately from the compensation-ready milestone.
- Use test-driven development and separate reviewable commits.

---

### Task 1: Unit declaration status, applied provenance, and profile suggestion

**Files:**
- Modify: `src/domain/dxf/types.ts`
- Modify: `src/domain/dxf/parseDxf.ts`
- Modify: `src/domain/dxf/__tests__/parseDxf.test.ts`
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/workbench/defaultProject.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Modify: `src/domain/machine/__tests__/machineProfiles.test.ts`
- Modify: `src/app/workbenchSettings.ts`
- Modify: `src/app/workbenchSettings.test.ts`
- Modify: `src/app/MachineOutputSettingsPanel.tsx`

**Interfaces:**
- Produces: `DxfUnitDeclarationStatus` and `AppliedDxfUnits`.
- Extends: `DxfParseResult.unitDeclaration` and `PathPlanningSourceMetadata.appliedUnits`.
- Extends: `MachineProfile.preferredDxfImportUnit: 'millimeters' | 'inches' | null`.

- [ ] **Step 1: Write failing parser/provenance tests**

```ts
it.each([
  [millimeterDxf, 'recognized'],
  [inchDxf, 'recognized'],
  [missingUnitsDxf, 'missing'],
  [unitlessDxf, 'unitless'],
  [unknownUnitsDxf, 'unknown'],
  [malformedUnitsDxf, 'malformed']
])('retains unit declaration status', (text, status) => {
  expect(parseDxf(text).unitDeclaration.status).toBe(status);
});
```

Malformed status retains the raw group-70 value when available; recognized/unitless/unknown retain the parsed code record.

- [ ] **Step 2: Write failing profile-normalization/settings tests**

```ts
it('normalizes missing DXF import preference to null', () => {
  expect(normalizeMachineProfile(legacyProfile).preferredDxfImportUnit).toBeNull();
});

it('round-trips the preferred DXF import unit independently from output settings', () => {
  const input = workbenchSettingsInputFromDraft(workbench, {
    ...draft,
    preferredDxfImportUnit: 'inches'
  });
  expect(input.machineProfile?.preferredDxfImportUnit).toBe('inches');
  expect(input.machineProfile?.output).toEqual(workbench.activeMachineProfile.output);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/dxf/__tests__/parseDxf.test.ts src/domain/machine/__tests__/machineProfiles.test.ts src/app/workbenchSettings.test.ts
```

Expected: FAIL because the new provenance/preference fields do not exist.

- [ ] **Step 4: Implement the types, parser status, profile field, and settings control**

```ts
export type DxfUnitDeclarationStatus = 'missing' | 'malformed' | 'unitless' | 'unknown' | 'recognized';

export interface AppliedDxfUnits {
  label: string;
  scaleToMillimeters: number;
  basis: 'dxf-declared' | 'user-confirmed' | 'legacy-assumed';
  confirmed: boolean;
  confirmedAt?: string;
  suggestion?: { kind: 'machine-profile'; profileId: string };
}
```

Keep `source.units` strictly raw DXF metadata. Add a settings selector with Automatic/no preference, millimetres, and inches.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run Step 3. Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/domain/dxf/types.ts src/domain/dxf/parseDxf.ts src/domain/dxf/__tests__/parseDxf.test.ts src/domain/path-intel/types.ts src/domain/workbench/types.ts src/domain/workbench/defaultProject.ts src/domain/machine/machineProfiles.ts src/domain/machine/__tests__/machineProfiles.test.ts src/app/workbenchSettings.ts src/app/workbenchSettings.test.ts src/app/MachineOutputSettingsPanel.tsx
git commit -m "feat: model DXF unit decisions"
```

---

### Task 2: Pure import preparation, candidates, bounds, and machine fit

**Files:**
- Create: `src/domain/dxf/dxfImportUnits.ts`
- Create: `src/domain/dxf/prepareDxfProjectImport.ts`
- Create: `src/domain/dxf/__tests__/prepareDxfProjectImport.test.ts`
- Modify: `src/domain/machine/machineFit.ts` only if a pure bounds entry point is needed
- Modify: `src/domain/machine/__tests__/machineFit.test.ts`

**Interfaces:**
- Produces: `prepareDxfProjectImport`, `previewDxfProjectImport`, and `resolveAppliedDxfUnits`.
- Preparation performs no adapter reads/writes beyond the already supplied file text.

- [ ] **Step 1: Write failing candidate/preparation tests**

```ts
it('orders declared units before machine suggestion and millimetre fallback', () => {
  const prepared = prepareDxfProjectImport(workbenchWithInchPreference, { fileName: 'part.dxf', text: unitlessDxf });
  expect(prepared.unitCandidates.map((candidate) => candidate.source)).toEqual([
    'machine-suggestion', 'fallback'
  ]);
  expect(adapter.writeLog).toEqual([]);
});

it('previews candidate dimensions and machine fit from raw entities', () => {
  const prepared = prepareDxfProjectImport(workbench, { fileName: 'part.dxf', text: tenUnitSquare });
  expect(previewDxfProjectImport(prepared, { unitCandidateId: 'inches', machineProfileId }).bounds).toMatchObject({
    widthMm: 254, heightMm: 254
  });
});
```

Cover recognized declaration deduplication, missing/zero/malformed/unknown requirement, finite recognized extra units, no supported geometry, non-finite scaled bounds, deleted machine ID, and zero adapter writes.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/dxf/__tests__/prepareDxfProjectImport.test.ts src/domain/machine/__tests__/machineFit.test.ts
```

Expected: FAIL because preparation APIs do not exist.

- [ ] **Step 3: Implement preparation and preview**

```ts
export interface DxfImportDecision {
  machineProfileId: string;
  unitCandidateId: string;
  confirmed: boolean;
  declaredUnitOverrideAcknowledged: boolean;
}

export function prepareDxfProjectImport(
  workbench: ConnectedWorkbench,
  input: { fileName: string; text: string; now?: Date }
): DxfImportPreparation;

export function previewDxfProjectImport(
  preparation: DxfImportPreparation,
  selection: Pick<DxfImportDecision, 'unitCandidateId' | 'machineProfileId'>
): DxfImportPreview;
```

Candidate priority is recognized declaration, machine suggestion, then millimetres. Deduplicate equal scales while retaining the strongest source badge. Scale cloned/raw entity bounds for preview; never construct and rescale a UPID.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/domain/dxf/dxfImportUnits.ts src/domain/dxf/prepareDxfProjectImport.ts src/domain/dxf/__tests__/prepareDxfProjectImport.test.ts src/domain/machine/machineFit.ts src/domain/machine/__tests__/machineFit.test.ts
git commit -m "feat: prepare DXF imports for review"
```

---

### Task 3: Applied normalization, confirmed commit, validation, and migration

**Files:**
- Modify: `src/domain/dxf/normalizeDxfGeometry.ts`
- Modify: `src/domain/dxf/dxfToUpid.ts`
- Modify: `src/domain/path-intel/fromDxfEntities.ts`
- Modify: `src/domain/dxf/importDxfProject.ts`
- Modify: `src/domain/dxf/__tests__/dxfToUpid.test.ts`
- Modify: `src/domain/dxf/__tests__/importDxfProject.test.ts`
- Modify: `src/domain/upid/validateUpidDocument.ts`
- Modify: `src/domain/upid/__tests__/validateUpidDocument.test.ts`
- Modify: `src/domain/upid/projectUpid.ts`
- Modify: `src/domain/editor/__tests__/openWorkbenchProject.test.ts`

**Interfaces:**
- Consumes: Task 2 preparation/decision.
- Produces: `commitDxfProjectImport(workbench, preparation, decision)`.
- Produces: applied-unit validation and non-mutating legacy synthesis.

- [ ] **Step 1: Write failing exactly-once normalization tests**

```ts
it('uses the applied override exactly once while retaining raw declaration', () => {
  const sourceEntities = structuredClone(parsed.entities);
  const document = dxfEntitiesToUpidDocument(parsed.entities, {}, {
    units: parsed.units,
    appliedUnits: confirmedMillimeters
  });
  expect(document.segments[0].end.x).toBe(10);
  expect(document.source.units?.label).toBe('inches');
  expect(document.source.coordinateScaleToMillimeters).toBe(1);
  expect(parsed.entities).toEqual(sourceEntities);
});
```

- [ ] **Step 2: Write failing commit/write-boundary tests**

```ts
it('commits only after confirmation and snapshots the selected machine', async () => {
  await expect(commitDxfProjectImport(workbench, prepared, { ...decision, confirmed: false })).rejects.toThrow('confirm');
  expect(adapter.writeLog).toEqual([]);
  const result = await commitDxfProjectImport(workbench, prepared, confirmedDecision);
  expect(result.project.machine.id).toBe(confirmedDecision.machineProfileId);
  expect(adapter.writeLog).toEqual(expect.arrayContaining([
    expect.stringContaining('/imports/'),
    expect.stringContaining('/projects/'),
    'workbench.json'
  ]));
});
```

Cover stale machine ID, declared override acknowledgement, unique project ID at commit, durable override warning, and each path written once.

- [ ] **Step 3: Write failing validation/migration tests**

```ts
it('rejects applied-unit scale disagreement', () => {
  document.source.appliedUnits = { ...confirmedMillimeters, scaleToMillimeters: 25.4 };
  document.source.coordinateScaleToMillimeters = 1;
  expect(validateUpidDocument(document).valid).toBe(false);
});

it('synthesizes legacy assumed-mm metadata without changing geometry', () => {
  const before = structuredClone(legacy);
  const normalized = normalizeLegacyProjectUpidDocument(legacy);
  expect(normalized.source.appliedUnits).toMatchObject({ basis: 'legacy-assumed', confirmed: false, scaleToMillimeters: 1 });
  expect(normalized.segments).toEqual(before.segments);
});
```

- [ ] **Step 4: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/dxf/__tests__/dxfToUpid.test.ts src/domain/dxf/__tests__/importDxfProject.test.ts src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/editor/__tests__/openWorkbenchProject.test.ts
```

Expected: FAIL on missing applied-scale/commit/migration behavior.

- [ ] **Step 5: Implement normalization, commit, validator, and legacy synthesis**

Prefer `appliedUnits.scaleToMillimeters`; use raw declared scale only as legacy fallback. Suppress assumed-mm diagnostics only for confirmed decisions. Resolve selected profile by ID at commit and deep-clone it. Keep project loading non-mutating by returning cloned synthesized metadata.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run Step 4. Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/domain/dxf/normalizeDxfGeometry.ts src/domain/dxf/dxfToUpid.ts src/domain/path-intel/fromDxfEntities.ts src/domain/dxf/importDxfProject.ts src/domain/dxf/__tests__/dxfToUpid.test.ts src/domain/dxf/__tests__/importDxfProject.test.ts src/domain/upid/validateUpidDocument.ts src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/upid/projectUpid.ts src/domain/editor/__tests__/openWorkbenchProject.test.ts
git commit -m "feat: confirm DXF units before persistence"
```

---

### Task 4: Import confirmation dialog and app controller flow

**Files:**
- Create: `src/features/dashboard/DxfImportConfirmationDialog.tsx`
- Create: `src/features/dashboard/__tests__/DxfImportConfirmationDialog.test.tsx`
- Modify: `src/app/appServices.ts`
- Modify: `src/app/useWorkbenchAppController.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/StartWorkPanel.tsx`
- Modify: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Consumes: prepare/preview/commit APIs from Tasks 2–3.
- Produces: pending import state, confirm, cancel, and machine/unit live preview.

- [ ] **Step 1: Write failing dialog component tests**

```tsx
it('shows source badge, resulting millimetre bounds, machine fit, and confirmation controls', () => {
  render(
    <DxfImportConfirmationDialog
      preparation={prepared}
      machineProfiles={machineProfiles}
      decision={millimetreDecision}
      onDecisionChange={onDecisionChange}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByText('Not declared')).toBeVisible();
  expect(screen.getByLabelText('DXF units')).toHaveValue('millimeters');
  expect(screen.getByLabelText('Machine profile')).toHaveValue(activeMachineId);
  expect(screen.getByTestId('dxf-import-size')).toHaveTextContent('10.000 × 10.000 mm');
});

it('requires acknowledgement when overriding declared units', () => {
  selectOptions(screen.getByLabelText('DXF units'), 'millimeters');
  expect(screen.getByRole('button', { name: 'Import and open' })).toBeDisabled();
  click(screen.getByLabelText('Override declared DXF units'));
  expect(screen.getByRole('button', { name: 'Import and open' })).toBeEnabled();
});
```

Also cover Escape/cancel, focus, warning counts, live machine/unit recomputation, and error display.

- [ ] **Step 2: Write failing app flow tests**

Select a DXF and assert the dialog appears without writes/editor navigation. Cancel and assert no writes. Confirm and assert one import, persisted selected machine/applied units, and editor open.

- [ ] **Step 3: Run focused UI tests and verify RED**

```bash
npm test -- --run src/features/dashboard/__tests__/DxfImportConfirmationDialog.test.tsx src/__tests__/appDxfProjects.test.tsx
```

Expected: FAIL because the pending flow/dialog is missing.

- [ ] **Step 4: Implement the dialog and controller state machine**

```ts
type PendingDxfImport = {
  preparation: DxfImportPreparation;
  preview: DxfImportPreview;
  selection: Pick<DxfImportDecision, 'machineProfileId' | 'unitCandidateId'>;
  overrideAcknowledged: boolean;
};
```

File selection prepares and sets pending state only. Selection changes recompute preview. Confirm calls commit; cancel clears pending state. Preserve the existing busy-operation guard without holding it across user think time.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run Step 3. Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/features/dashboard/DxfImportConfirmationDialog.tsx src/features/dashboard/__tests__/DxfImportConfirmationDialog.test.tsx src/app/appServices.ts src/app/useWorkbenchAppController.ts src/App.tsx src/features/dashboard/DashboardPage.tsx src/features/dashboard/StartWorkPanel.tsx src/__tests__/appDxfProjects.test.tsx
git commit -m "feat: review DXF imports before opening"
```

---

### Task 5: Provenance display and raw-source unit reinterpretation

**Files:**
- Modify: `src/domain/upid/upidDocument.ts`
- Modify: `src/domain/upid/__tests__/upidDocument.test.ts`
- Modify: `src/features/editor/EditorInspectorPanel.tsx`
- Modify: `src/features/editor/EditorStatusBar.tsx`
- Modify: `src/features/editor/EditorUpidExportPreview.tsx`
- Create: `src/domain/dxf/reimportDxfProjectUnits.ts`
- Create: `src/domain/dxf/__tests__/reimportDxfProjectUnits.test.ts`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/app/useWorkbenchAppController.ts`
- Modify: `src/__tests__/appDxfProjects.test.tsx`

**Interfaces:**
- Produces: applied-unit fields in `UpidGCodeExportDocumentTrace`.
- Produces: `prepareDxfProjectReimport` and `commitDxfProjectReimport`.
- Reuses: import confirmation dialog in destructive reimport mode.

- [ ] **Step 1: Write failing trace/display tests**

```ts
expect(trace).toMatchObject({
  sourceUnits: rawUnits,
  appliedUnits: { label: 'millimeters', scaleToMillimeters: 1, basis: 'user-confirmed' }
});
```

UI assertions show raw declaration, applied label, scale, basis, and override warning.

- [ ] **Step 2: Write failing reimport tests**

```ts
it('rebuilds changed-scale geometry from raw DXF', async () => {
  const prepared = await prepareDxfProjectReimport(workbench, project);
  const result = await commitDxfProjectReimport(workbench, project, prepared, inchDecision);
  expect(result.pathDocument.segments[0].end.x).toBeCloseTo(originalRawX * 25.4);
});

it('confirms legacy scale-1 millimetres without replacing edited geometry', async () => {
  const result = await commitDxfProjectReimport(workbench, editedLegacyProject, prepared, millimeterDecision);
  expect(result.pathDocument.segments).toEqual(editedLegacyProject.upid!.document.segments);
});
```

Also block absent/unreadable raw source and show destructive warning when scale changes.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/dxf/__tests__/reimportDxfProjectUnits.test.ts src/domain/upid/__tests__/upidDocument.test.ts src/__tests__/appDxfProjects.test.tsx
```

Expected: FAIL on missing trace/reimport behavior.

- [ ] **Step 4: Implement trace, read-only UI, and raw rebuild**

Find the DXF via `project.source.files`, read through the workbench adapter, and call the same preparation path. For a real scale change, rebuild the full UPID from raw and warn that geometry-derived edits are replaced. Only scale-1 legacy confirmation updates metadata in a clone.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run Step 3. Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/domain/upid/upidDocument.ts src/domain/upid/__tests__/upidDocument.test.ts src/features/editor/EditorInspectorPanel.tsx src/features/editor/EditorStatusBar.tsx src/features/editor/EditorUpidExportPreview.tsx src/domain/dxf/reimportDxfProjectUnits.ts src/domain/dxf/__tests__/reimportDxfProjectUnits.test.ts src/features/editor/EditorPage.tsx src/app/useWorkbenchAppController.ts src/__tests__/appDxfProjects.test.tsx
git commit -m "feat: preserve and revise DXF unit provenance"
```

---

### Task 6: G20 safety, end-to-end coverage, and verification

**Files:**
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/post/templateModalPolicy.ts`
- Modify: `src/domain/upid/upidDocument.ts`
- Modify: `src/domain/upid/__tests__/upidDocument.test.ts`
- Modify: `src/__tests__/appDxfProjects.test.tsx`
- Create: `e2e/dxf-import-units.spec.ts`
- Modify: `e2e/app-shell.spec.ts`

**Interfaces:**
- Consumes: compensation plan’s template word scanner/policy.
- Produces: `post-inch-units-unsupported` blocking diagnostic for real G20 words.

- [ ] **Step 1: Write failing G20 lexical safety tests**

```ts
it.each(['G20', 'G90G20G40'])('blocks millimetre UPID output under %s', (header) => {
  const result = composeUpidGCodeExport(document, { header, footer: '', lineEnding: 'lf' });
  expect(result.canDownload).toBe(false);
  expect(result.blockingDiagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'post-inch-units-unsupported' })
  ]));
});

it.each(['(G20) G21', '; G20\nG21', 'G200 G21'])('does not false-positive on %s', (header) => {
  expect(composeUpidGCodeExport(document, { header, footer: '', lineEnding: 'lf' }).canDownload).toBe(true);
});
```

- [ ] **Step 2: Add failing Playwright import-confirmation coverage**

Cover declared units, unitless confirmation, machine change, cancel, reopen provenance, and editor navigation only after confirmation. Update existing shell flow to confirm the new dialog.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/upid/__tests__/upidDocument.test.ts src/__tests__/appDxfProjects.test.tsx
```

Expected: FAIL on missing diagnostic/flow updates.

- [ ] **Step 4: Implement lexical G20 gating and finish E2E flow**

Use interpreted G-code words, not substring matching. Machine `preferredDxfImportUnit: 'inches'` must not change output coordinates or templates.

- [ ] **Step 5: Run complete verification**

```bash
npm test -- --run src/domain/dxf
npm test -- --run src/domain/upid src/domain/machine
npm test -- --run src/__tests__/appDxfProjects.test.tsx
npm test -- --run
npm run build
npm run test:e2e -- e2e/dxf-import-units.spec.ts e2e/app-shell.spec.ts
git diff --check
```

Expected: all tests/build/E2E pass; only the known Vite chunk-size advisory may remain.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/domain/path-intel/types.ts src/domain/post/templateModalPolicy.ts src/domain/upid/upidDocument.ts src/domain/upid/__tests__/upidDocument.test.ts src/__tests__/appDxfProjects.test.tsx e2e/dxf-import-units.spec.ts e2e/app-shell.spec.ts
git commit -m "feat: complete safe DXF unit confirmation"
```
