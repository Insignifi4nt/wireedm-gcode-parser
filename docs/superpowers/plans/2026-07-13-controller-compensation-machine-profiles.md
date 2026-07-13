# Controller Compensation and Machine Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build portable reusable machine profiles and reversal-safe controller compensation, then reproduce the physically verified Robofil 100 z39 dialect from a project-snapshotted editable profile: G92/G60/G38, derived G41/G42 D0, G90, absolute I/J, M02, CRLF, and three decimals.

**Architecture:** Machine profiles own versioned controller/post policy and are snapshotted into projects. UPID operations own semantic kept-material intent and a document-level geometry basis; a pure resolver derives actual winding and G41/G42 from final oriented refs. A machine-aware post converts canonical geometry into the snapshot's arc-centre convention and lifecycle. Generic explicit-linear/G40 behavior and the verified Robofil program-level G38 lifecycle are separate policies.

**Tech Stack:** TypeScript, React, Vite, Vitest, Playwright, local-first storage adapters.

## Global Constraints

- Programmed DXF coordinates are finished-contour geometry only when `geometryBasis` is `finished-contour`.
- Legacy documents and legacy machine profiles remain G40 centreline output.
- New verified compensation-capable profiles enable compensation by default for eligible closed contours.
- Store kept-material intent, never literal G41/G42, in UPID.
- Compute winding from final `PathOperation.segmentRefs`; never trust `PathOperation.direction` or persisted contour orientation.
- Reversal must flip G41/G42 without changing kept-material intent.
- D selects a controller table entry only; never emit or mutate the table value.
- Automatic explicit leads require a finite positive lead length and conservative maximum-offset envelope.
- Rapid/cancellation invariants are profile-specific: generic ISO uses G40 boundaries; the verified Robofil program-level lifecycle omits G40 and blocks unsupported rapids or additional compensated operations.
- G20, header/footer literal G41/G42, unsafe transitions, and unresolved compensation block export. The Robofil preset additionally rejects conflicting G21/G17/G54/G40/M30 without making those words globally invalid.
- The verified Robofil preset emits G92 X0 Y0, G60, G38, derived G41/G42 D0, then G90; omits G21/G17/G54/G40/M30; uses absolute I/J; and ends only with M02.
- All setup words, arc-centre mode, lifecycle, end code, precision, and line endings are editable versioned profile policy and are read from the project snapshot.
- Existing external G-code remains source-preserving and is never reposted.
- Machine-profile import resets controller verification and never changes project snapshots.
- Keep browser-cache and directory-backed workbenches supported.
- Use test-driven development and separate reviewable commits.
- Do not access the unplugged `D:` drive; the durable evidence is this specification and checked-in regression fixtures only.

---

### Task 1: Portable machine-profile model and codec

**Files:**
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/workbench/defaultProject.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Create: `src/domain/machine/machineProfileFile.ts`
- Modify: `src/domain/machine/__tests__/machineProfiles.test.ts`
- Create: `src/domain/machine/__tests__/machineProfileFile.test.ts`

**Interfaces:**
- Produces: `MachineControllerPolicy`, `MachineCompensationPolicy`, `MachineProfileVerification`, and the expanded `MachineProfile`.
- Produces: `createBlankMachineProfile(id?: string): MachineProfile`.
- Produces: `createCharmillesRobofilClassicProfile(id?: string): MachineProfile`.
- Produces: `machineProfileVerificationFingerprint(profile): string` and normalization that resets stale verification.
- Produces: `serializeMachineProfileFile(profile, now?): string`.
- Produces: `parseMachineProfileFile(text): MachineProfile`.
- Produces: `planMachineProfileImport(existing, imported): { kind: 'already-installed' | 'add' | 'copy'; profile: MachineProfile }`.

- [ ] **Step 1: Write failing profile-model tests**

Add tests that demonstrate the required API before implementation:

```ts
it('creates a blank editable G40-only machine profile', () => {
  expect(createBlankMachineProfile('new-wire-machine')).toMatchObject({
    id: 'new-wire-machine',
    name: 'Untitled Wire EDM',
    controller: { family: 'custom', verification: { status: 'unverified' } },
    compensation: { supported: false, enabledByDefault: false },
    templates: { header: '', footer: '' }
  });
});

it('normalizes legacy profiles without enabling compensation', () => {
  expect(normalizeMachineProfile(legacyProfile).compensation).toMatchObject({
    supported: false,
    enabledByDefault: false
  });
});

it('resets verification when controller-sensitive settings change', () => {
  const verified = markMachineProfileUserVerified(createCharmillesRobofilClassicProfile(), now);
  expect(normalizeMachineProfile({
    ...verified,
    compensation: { ...verified.compensation, offsetSelection: { address: 'D', index: 1 } }
  }).controller.verification.status).toBe('unverified');
});
```

- [ ] **Step 2: Write failing portable-codec tests**

Cover round trip, maximum size, malformed JSON, unsupported schema, NUL templates, invalid IDs, invalid enums/numbers, unknown-key stripping, semantic duplicate, and ID collision copy:

```ts
it('round-trips one versioned portable profile and resets imported verification', () => {
  const text = serializeMachineProfileFile(verifiedRobofil, now);
  const parsed = parseMachineProfileFile(text);
  expect(parsed.id).toBe(verifiedRobofil.id);
  expect(parsed.controller.verification.status).toBe('unverified');
});

it('imports a conflicting ID as a deterministic copy', () => {
  expect(planMachineProfileImport([existing], changed)).toMatchObject({
    kind: 'copy',
    profile: { id: `${existing.id}-2`, name: `${existing.name} (2)` }
  });
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run src/domain/machine/__tests__/machineProfiles.test.ts src/domain/machine/__tests__/machineProfileFile.test.ts
```

Expected: FAIL because the new types/functions do not exist.

- [ ] **Step 4: Implement the profile types, constructors, normalization, fingerprint, and codec**

Use these required shapes:

```ts
export interface MachineProfileVerification {
  status: 'unverified' | 'user-verified';
  verifiedAt?: string;
  verifiedFingerprint?: string;
}

export interface MachineControllerPolicy {
  family: 'generic-iso' | 'charmilles-robofil-classic' | 'custom';
  verification: MachineProfileVerification;
  blockFormatting: 'spaced' | 'compact';
  coordinateSystem: 'template-managed' | 'work-offset' | 'wire-position-g92';
  programEnd: 'M02' | 'M30' | 'template-managed';
}

export interface MachineCompensationPolicy {
  supported: boolean;
  enabledByDefault: boolean;
  offsetSelection: { address: 'D'; index: number };
  activation: 'linear-lead' | 'charmilles-g38';
  cancellation: 'linear-lead-out' | 'charmilles-g39';
  validationLeadLengthMm: number;
  expectedMaximumOffsetMm: number | null;
}

export interface PortableMachineProfileDocument {
  format: 'wire-edm-machine-profile';
  schemaVersion: 1;
  exportedAt: string;
  profile: MachineProfile;
}
```

Strictly reconstruct imported fields before calling normalization. Enforce the documented 256 KiB file cap, stable ID/name limits, template/notes limits, output enums, precision 0–6, and positive nullable work area.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 3. Expected: all focused profile tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/domain/workbench/types.ts src/domain/workbench/defaultProject.ts src/domain/machine/machineProfiles.ts src/domain/machine/machineProfileFile.ts src/domain/machine/__tests__/machineProfiles.test.ts src/domain/machine/__tests__/machineProfileFile.test.ts
git commit -m "feat: add portable machine profile policies"
```

---

### Task 2: Atomic profile-library persistence

**Files:**
- Create: `src/domain/storage/updateMachineProfileLibrary.ts`
- Create: `src/domain/storage/__tests__/updateMachineProfileLibrary.test.ts`
- Modify: `src/domain/storage/workbenchStorage.ts`
- Modify: `src/domain/storage/updateWorkbenchSettings.ts`
- Modify: `src/app/appServices.ts`

**Interfaces:**
- Consumes: profile normalization and portable import plan from Task 1.
- Produces: `addMachineProfile`, `duplicateMachineProfile`, `deleteMachineProfile`, `setActiveMachineProfile`, and `importMachineProfile` storage operations.
- Preserves: manifest projects and every existing `project.machine` snapshot.

- [ ] **Step 1: Write failing atomic-persistence tests**

```ts
it('adds an inactive blank profile without rewriting active template mirrors', async () => {
  const before = connectedWorkbench();
  const result = await addMachineProfile(before, createBlankMachineProfile('new-wire-machine'), now);
  expect(result.manifest.machineProfiles.map((profile) => profile.id)).toContain('new-wire-machine');
  expect(result.manifest.activeMachineProfileId).toBe(before.manifest.activeMachineProfileId);
  expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe(before.header);
  expect(result.manifest.projects).toEqual(before.manifest.projects);
});

it('deletes the active profile using a deterministic fallback but never the final profile', async () => {
  const result = await deleteMachineProfile(twoProfileWorkbench, activeId, now);
  expect(result.activeMachineProfile.id).toBe(otherId);
  await expect(deleteMachineProfile(oneProfileWorkbench, onlyId, now)).rejects.toThrow('final');
});
```

Also test duplicate IDs/names, semantic import no-op, import-as-copy, active selection mirror writes, inactive edits not rewriting mirrors, and deep-cloned project snapshots.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/storage/__tests__/updateMachineProfileLibrary.test.ts
```

Expected: FAIL because the library operations do not exist.

- [ ] **Step 3: Implement one persistence boundary**

Use an operation union and one writer so state mirrors cannot drift:

```ts
export type MachineProfileLibraryAction =
  | { kind: 'add'; profile: MachineProfile }
  | { kind: 'replace'; profile: MachineProfile }
  | { kind: 'delete'; profileId: string }
  | { kind: 'select-active'; profileId: string };

export async function updateMachineProfileLibrary(
  workbench: ConnectedWorkbench,
  action: MachineProfileLibraryAction,
  now = new Date()
): Promise<ConnectedWorkbench>;
```

Inactive changes write `workbench.json` only. Active changes also update top-level output and header/footer compatibility files. Always normalize/deep-clone profiles and preserve `manifest.projects` byte-for-byte.

- [ ] **Step 4: Run focused storage tests and existing storage regressions**

```bash
npm test -- --run src/domain/storage/__tests__/updateMachineProfileLibrary.test.ts src/domain/storage/__tests__/updateWorkbenchSettings.test.ts src/domain/storage/__tests__/workbenchStorage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/domain/storage/updateMachineProfileLibrary.ts src/domain/storage/__tests__/updateMachineProfileLibrary.test.ts src/domain/storage/workbenchStorage.ts src/domain/storage/updateWorkbenchSettings.ts src/app/appServices.ts
git commit -m "feat: persist machine profile libraries safely"
```

---

### Task 9: Expand the versioned post policy from verified Robofil 100 evidence

Execute this task immediately after Task 2 and before Task 3. Task 1 predated the physical-machine evidence; this is an additive schema/preset correction, not a global dialect change.

**Files:**
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/workbench/defaultProject.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Modify: `src/domain/machine/machineProfileFile.ts`
- Modify: `src/domain/machine/__tests__/machineProfiles.test.ts`
- Modify: `src/domain/machine/__tests__/machineProfileFile.test.ts`
- Modify: `src/domain/storage/__tests__/workbenchStorage.test.ts`

**Interfaces:**
- Adds editable/versioned controller policy for `postVersion`, units-code emission, plane-code emission, work-offset emission, distance mode, arc-centre mode, lifecycle scope, pre-activation codes, and program-end cancellation.
- Produces `createVerifiedCharmillesRobofil100Profile(id?, verifiedAt?): MachineProfile` while keeping generic/legacy normalization safe and preserving the blank profile.
- Extends the verification fingerprint to every setting that can change emitted controller text: controller setup fields, compensation lifecycle/D selection, header/footer, line ending, and coordinate precision. Output extension remains outside the fingerprint because it does not change program text.

- [ ] **Step 1: Write failing verified-preset and migration tests**

Assert the new preset is snapshottable and contains:

```ts
expect(createVerifiedCharmillesRobofil100Profile('robofil-local', verifiedAt)).toMatchObject({
  id: 'robofil-local',
  name: 'Charmilles Robofil 100 / Classic (verified 2026-07-13)',
  controller: {
    family: 'charmilles-robofil-classic',
    postVersion: 1,
    verification: { status: 'user-verified' },
    coordinateSystem: 'wire-position-g92',
    unitsCode: 'omit',
    planeCode: 'omit',
    workOffsetCode: 'omit',
    distanceMode: 'G90',
    arcCenterMode: 'absolute',
    programEnd: 'M02'
  },
  compensation: {
    supported: true,
    enabledByDefault: true,
    offsetSelection: { address: 'D', index: 0 },
    activation: 'charmilles-g38',
    cancellation: 'program-end',
    lifecycleScope: 'program',
    preActivationCodes: ['G60']
  },
  templates: { header: '', footer: '' },
  output: { extension: 'iso', lineEnding: 'crlf', coordinatePrecision: 3 }
});
```

Also prove legacy profiles normalize to generic version-1 defaults without becoming verified or compensation-capable; strict portable parsing accepts valid new fields, rejects invalid enums/unsafe multiline pre-activation blocks, strips unknown keys, resets imported verification, and round-trips the preset. Editing arc-centre mode, setup emission, lifecycle, D index, templates, line ending, or precision resets verification; changing only ID/name/notes/extension does not.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/machine/__tests__/machineProfiles.test.ts src/domain/machine/__tests__/machineProfileFile.test.ts src/domain/storage/__tests__/workbenchStorage.test.ts
```

Expected: FAIL because the verified policy fields/preset do not exist.

- [ ] **Step 3: Implement additive normalization, strict codec reconstruction, and verified preset**

Keep the portable wrapper at schema version 1 because the new profile fields are additive and legacy normalization is explicit. Pre-activation blocks are profile data, limited to 16 single-line printable blocks of at most 64 characters; they are parsed/validated again by the post and never concatenated unsafely. Use the fingerprint helper to create the verified record—never hard-code its fingerprint.

- [ ] **Step 4: Run focused tests, full suite, and build**

```bash
npm test -- --run src/domain/machine/__tests__/machineProfiles.test.ts src/domain/machine/__tests__/machineProfileFile.test.ts src/domain/storage/__tests__/workbenchStorage.test.ts
npm test -- --run
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 9**

```bash
git add src/domain/workbench/types.ts src/domain/workbench/defaultProject.ts src/domain/machine/machineProfiles.ts src/domain/machine/machineProfileFile.ts src/domain/machine/__tests__/machineProfiles.test.ts src/domain/machine/__tests__/machineProfileFile.test.ts src/domain/storage/__tests__/workbenchStorage.test.ts
git commit -m "feat: model verified Robofil post policy"
```

---

### Task 3: Selectable/editable profile UI and import/export

**Files:**
- Modify: `src/app/workbenchSettings.ts`
- Modify: `src/app/workbenchSettings.test.ts`
- Modify: `src/app/MachineOutputSettingsPanel.tsx`
- Modify: `src/app/WorkbenchSettingsDialog.tsx`
- Modify: `src/app/useWorkbenchAppController.ts`
- Modify: `src/app/appServices.ts`
- Modify: `src/__tests__/appWorkbenchDashboard.test.tsx`
- Modify: `src/domain/post/downloadProgramFile.ts`
- Modify: `src/domain/post/__tests__/downloadProgramFile.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 profile and storage APIs.
- Produces: profile selector, New Blank, Duplicate, Delete, Set Default, Import, Export, verification acknowledgement, and structured controller/compensation fields.
- Export MIME: `application/json;charset=utf-8` and filename `<safe-id>.wireedm-machine.json`.

- [ ] **Step 1: Write failing settings/UI tests**

```tsx
it('creates and edits an inactive blank profile without changing the default', async () => {
  click(screen.getByRole('button', { name: 'New blank machine profile' }));
  expect(screen.getByLabelText('Machine profile selector')).toHaveValue('new-wire-machine');
  expect(workbench.manifest.activeMachineProfileId).toBe('default-wire-machine');
});

it('exports the selected profile and imports a conflict as a copy', async () => {
  click(screen.getByRole('button', { name: 'Export machine profile' }));
  expect(downloadTextFile).toHaveBeenCalledWith(expect.objectContaining({
    fileName: expect.stringMatching(/\.wireedm-machine\.json$/),
    mimeType: 'application/json;charset=utf-8'
  }));
  uploadProfile(conflictingPortableText);
  expect(screen.getByLabelText('Machine profile selector')).toHaveValue('robofil-2');
});
```

Also cover verification reset after sensitive edits, invalid inline errors, safe delete fallback, import malformed errors, blank header/footer preservation, and no fake navigation-only controls.

- [ ] **Step 2: Run focused UI tests and verify RED**

```bash
npm test -- --run src/app/workbenchSettings.test.ts src/__tests__/appWorkbenchDashboard.test.tsx src/domain/post/__tests__/downloadProgramFile.test.ts
```

Expected: FAIL on missing UI/actions.

- [ ] **Step 3: Implement the selected-profile draft and controller wiring**

The draft identity must include profile ID and all structured fields:

```ts
export interface SettingsDraft {
  sourceKey: string;
  profileId: string;
  machineName: string;
  controllerFamily: MachineControllerPolicy['family'];
  postVersion: string;
  verificationStatus: MachineProfileVerification['status'];
  compensationSupported: boolean;
  compensationEnabledByDefault: boolean;
  dRegisterIndex: string;
  activation: MachineCompensationPolicy['activation'];
  cancellation: MachineCompensationPolicy['cancellation'];
  lifecycleScope: MachineCompensationPolicy['lifecycleScope'];
  preActivationCodes: string;
  validationLeadLengthMm: string;
  expectedMaximumOffsetMm: string;
  blockFormatting: MachineControllerPolicy['blockFormatting'];
  coordinateSystem: MachineControllerPolicy['coordinateSystem'];
  unitsCode: MachineControllerPolicy['unitsCode'];
  planeCode: MachineControllerPolicy['planeCode'];
  workOffsetCode: MachineControllerPolicy['workOffsetCode'];
  distanceMode: MachineControllerPolicy['distanceMode'];
  arcCenterMode: MachineControllerPolicy['arcCenterMode'];
  programEnd: MachineControllerPolicy['programEnd'];
  // existing template/output/work-area fields remain
}
```

Use real file input for import and the generalized download helper for export. Keep imported profiles inactive until Set Default is chosen.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/app/workbenchSettings.ts src/app/workbenchSettings.test.ts src/app/MachineOutputSettingsPanel.tsx src/app/WorkbenchSettingsDialog.tsx src/app/useWorkbenchAppController.ts src/app/appServices.ts src/__tests__/appWorkbenchDashboard.test.tsx src/domain/post/downloadProgramFile.ts src/domain/post/__tests__/downloadProgramFile.test.ts
git commit -m "feat: manage portable machine profiles"
```

---

### Task 4: UPID geometry basis, compensation intent, and pure resolver

**Files:**
- Modify: `src/domain/path-intel/types.ts`
- Create: `src/domain/compensation/intent.ts`
- Create: `src/domain/compensation/resolveControllerCompensation.ts`
- Create: `src/domain/compensation/__tests__/intent.test.ts`
- Create: `src/domain/compensation/__tests__/resolveControllerCompensation.test.ts`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: `src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`
- Modify: `src/domain/upid/validateUpidDocument.ts`
- Modify: `src/domain/upid/__tests__/validateUpidDocument.test.ts`
- Modify: `src/domain/upid/manualDecisions.ts`
- Modify: `src/domain/upid/__tests__/manualDecisions.test.ts`
- Modify: `src/domain/editor/__tests__/saveEditorProgram.test.ts`

**Interfaces:**
- Produces: `PathPlanningDocument.geometryBasis: 'finished-contour' | 'wire-centre'`.
- Produces: optional `PathOperation.compensationIntent`.
- Produces: `initializeProjectCompensationIntents`, `setManualCompensationIntent`, and `resolveControllerCompensation`.
- Legacy absence normalizes to wire-centre/G40; no literal code is persisted.

- [ ] **Step 1: Write failing intent and migration tests**

```ts
it.each([
  ['exterior', 'inside'],
  ['island', 'inside'],
  ['hole', 'outside']
])('suggests %s as keep-%s only for eligible finished contours', (classification, keptMaterial) => {
  expect(suggestCompensationIntent(eligibleContour(classification))).toMatchObject({
    mode: 'controller', keptMaterial, source: 'automatic'
  });
});

it('preserves manual intent when contour role changes', () => {
  const manual = setManualCompensationIntent(document, operationId, 'outside');
  const changed = setPathOperationClassification(manual!, operationId, 'exterior');
  expect(changed!.plan.operations[0].compensationIntent).toMatchObject({
    keptMaterial: 'outside', source: 'manual'
  });
});

it('treats legacy documents as wire-centre without adding G41/G42 intent', () => {
  const normalized = normalizeLegacyProjectUpidDocument(legacyDocument);
  expect(normalized.geometryBasis).toBe('wire-centre');
  expect(normalized.plan.operations[0].compensationIntent).toBeUndefined();
});
```

- [ ] **Step 2: Write failing resolver tests for all mappings and mutations**

```ts
it.each([
  ['inside', 'ccw', 'right', 'G42'],
  ['inside', 'cw', 'left', 'G41'],
  ['outside', 'ccw', 'left', 'G41'],
  ['outside', 'cw', 'right', 'G42']
])('maps keep-%s %s to %s/%s', (keptMaterial, winding, wireSide, code) => {
  expect(resolveControllerCompensation(input(keptMaterial, winding))).toMatchObject({
    status: 'ready', winding, wireSide, code
  });
});

it('reversal flips code while start rotation preserves it', () => {
  expect(resolve(reversed).code).not.toBe(resolve(original).code);
  expect(resolve(rotatedStart).code).toBe(resolve(original).code);
  expect(resolve(reversed).keptMaterial).toBe(resolve(original).keptMaterial);
});
```

Cover lines, arcs, circles, mixed geometry, missing refs, open paths, stale contour orientation, non-finite and degenerate signed area.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/compensation src/domain/path-editor/__tests__/pathDocumentOperations.test.ts src/domain/upid/__tests__/validateUpidDocument.test.ts
```

Expected: FAIL on missing types/functions.

- [ ] **Step 4: Implement semantic state and pure resolution**

Use exact area from `signedAreaOfPath(operation.segmentRefs, segmentsById)`. Return a discriminated union:

```ts
export type CompensationResolution =
  | {
      status: 'ready';
      signedArea: number;
      winding: 'cw' | 'ccw';
      keptMaterial: 'inside' | 'outside';
      wireSide: 'left' | 'right';
      code: 'G41' | 'G42';
    }
  | {
      status: 'blocked';
      reason: 'wire-centre' | 'missing-intent' | 'open-path' | 'missing-segment' | 'degenerate' | 'ineligible-topology';
    };
```

Structural validation checks legal shapes only. Export readiness remains a later layer. Reversal preserves intent and naturally changes resolution from refs.

- [ ] **Step 5: Run focused and persistence tests**

```bash
npm test -- --run src/domain/compensation src/domain/path-editor/__tests__/pathDocumentOperations.test.ts src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/upid/__tests__/manualDecisions.test.ts src/domain/editor/__tests__/saveEditorProgram.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/domain/path-intel/types.ts src/domain/compensation src/domain/path-editor/pathDocumentOperations.ts src/domain/path-editor/__tests__/pathDocumentOperations.test.ts src/domain/upid/validateUpidDocument.ts src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/upid/manualDecisions.ts src/domain/upid/__tests__/manualDecisions.test.ts src/domain/editor/__tests__/saveEditorProgram.test.ts
git commit -m "feat: model reversal-safe wire compensation"
```

---

### Task 5: Exact tangent transitions and compensated export validation

**Files:**
- Create: `src/domain/compensation/pathTangents.ts`
- Create: `src/domain/compensation/linearTransitionGeometry.ts`
- Create: `src/domain/compensation/validateCompensatedExport.ts`
- Create: `src/domain/compensation/__tests__/linearTransitionGeometry.test.ts`
- Create: `src/domain/compensation/__tests__/validateCompensatedExport.test.ts`
- Modify: `src/domain/path-intel/intersections.ts` if a currently private classifier must be exported
- Create: `src/domain/post/templateModalPolicy.ts`
- Create: `src/domain/post/__tests__/templateModalPolicy.test.ts`
- Modify: `src/domain/path-intel/types.ts`

**Interfaces:**
- Consumes: Task 4 resolution and Task 1 profile policy.
- Produces: exact oriented endpoint tangents and `generateLinearCompensationTransition`.
- Produces: export-readiness diagnostics for geometry/profile/template state.

- [ ] **Step 1: Write failing tangent/transition tests**

```ts
it('generates tangent lead-in and lead-out around a smooth closed contour', () => {
  const result = generateLinearCompensationTransition(validInput);
  expect(result).toMatchObject({
    status: 'ready',
    leadIn: { end: operation.startPoint },
    leadOut: { start: operation.startPoint }
  });
  expect(distance(result.leadIn.start, result.leadIn.end)).toBeCloseTo(2);
});

it('blocks a sharp manual start instead of relocating it', () => {
  expect(generateLinearCompensationTransition(sharpManualStart)).toMatchObject({
    status: 'blocked', reason: 'sharp-manual-start'
  });
});
```

Cover line/arc/circle tangents, sharp closure, self/other contour collision, maximum-offset envelope collision, work-area extent, coordinate-precision collapse, deterministic alternate automatic start, missing envelope, and circle-centre radial lead rejection.

- [ ] **Step 2: Write failing modal-policy/readiness tests**

```ts
it.each(['G41 D0', 'G42D0', 'G20'])('blocks conflicting UPID templates containing %s', (word) => {
  expect(validateTemplateModalPolicy({ header: word, footer: '' })).toMatchObject({ valid: false });
});

it('does not match compensation words in comments or G200', () => {
  expect(validateTemplateModalPolicy({ header: '(G41) G200 G21 G40', footer: '' }).valid).toBe(true);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/compensation/__tests__/linearTransitionGeometry.test.ts src/domain/compensation/__tests__/validateCompensatedExport.test.ts src/domain/post/__tests__/templateModalPolicy.test.ts
```

Expected: FAIL on missing generators/validators.

- [ ] **Step 4: Implement exact tangents, candidate scoring, collision envelope, and policy validation**

Required result shape:

```ts
export type LinearTransitionResult =
  | {
      status: 'ready';
      effectiveRefs: OrientedSegmentRef[];
      startPoint: Point2;
      leadIn: { start: Point2; end: Point2 };
      leadOut: { start: Point2; end: Point2 };
      selectedCandidateIndex: number;
      reason: 'manual-start' | 'automatic-safe-start';
    }
  | {
      status: 'blocked';
      reason: 'missing-envelope' | 'sharp-manual-start' | 'collision' | 'outside-work-area' | 'precision-collapse' | 'no-safe-candidate';
    };
```

Use exact oriented tangents for lines/arcs/circles and existing exact intersection classification. Permit only the intended endpoint contact. Expand collision bounds by `expectedMaximumOffsetMm`. Treat work area as extent-only because no absolute coordinate window exists.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run Step 3. Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/domain/compensation src/domain/path-intel/intersections.ts src/domain/path-intel/types.ts src/domain/post/templateModalPolicy.ts src/domain/post/__tests__/templateModalPolicy.test.ts
git commit -m "feat: validate compensation transitions"
```

---

### Task 6: Structured machine-aware G-code post

**Files:**
- Modify: `src/domain/path-intel/postGcode.ts`
- Create: `src/domain/post/upidMachinePost.ts`
- Create: `src/domain/post/__tests__/upidMachinePost.test.ts`
- Modify: `src/domain/upid/upidDocument.ts`
- Modify: `src/domain/upid/projectUpid.ts`
- Modify: `src/domain/upid/__tests__/upidDocument.test.ts`
- Modify: `src/domain/upid/__tests__/validateUpidDocument.test.ts`
- Modify: `src/domain/path-intel/__tests__/pathPlanning.test.ts`

**Interfaces:**
- Produces: `GcodePostedBlock` union and `postUpidForMachine(document, machine, options)`.
- Preserves: existing `moves`, metrics, centreline `postPathPlanToGcode`, and line maps.
- Produces both generic explicit-linear lifecycle and the verified, profile-selected Robofil single-operation G38 lifecycle.
- Converts canonical arc centres to incremental or absolute I/J according to the project-snapshotted profile.

- [ ] **Step 1: Write failing golden post tests**

```ts
it('posts one compensated operation with rapid, activation lead, contour, lead-out, and G40', () => {
  const posted = postUpidForMachine(compensatedSquare, verifiedProfile, { coordinatePrecision: 3 });
  expect(posted.status).toBe('ready');
  expect(posted.body.split('\n')).toEqual([
    'G40',
    'G0 X-2.000 Y0.000',
    'G42 D0 G1 X0.000 Y0.000',
    'G1 X10.000 Y0.000',
    'G1 X10.000 Y10.000',
    'G1 X0.000 Y10.000',
    'G1 X0.000 Y0.000',
    'G40 G1 X2.000 Y0.000'
  ]);
});

it('audits that no rapid occurs while compensation is active', () => {
  expect(postUpidForMachine(invalidSequenceFixture, verifiedProfile).status).toBe('blocked');
});
```

Also test reverse G41/G42 swap, D formatting, mixed centreline/compensated operations, an unverified Robofil copy blocked, G20/header compensation blocked, body empty on failure, and compatibility centreline output unchanged.

Add a verified Robofil golden case with this exact structured sequence and no forbidden generic words:

```gcode
G92 X0 Y0
G60
G38
G41 D0
G90
... contour with absolute I/J ...
M02
```

Reverse must derive `G42 D0` without changing kept-material intent. Assert omission of G21, G17, G54, G40, and M30, CRLF composition, three decimals, M02-only ending, and blocking of a second compensated operation until a verified multi-operation lifecycle exists.

- [ ] **Step 2: Run focused post tests and verify RED**

```bash
npm test -- --run src/domain/post/__tests__/upidMachinePost.test.ts src/domain/upid/__tests__/upidDocument.test.ts src/domain/path-intel/__tests__/pathPlanning.test.ts
```

Expected: FAIL on missing machine-aware post/blocks.

- [ ] **Step 3: Implement structured blocks and final modal audit**

```ts
export interface GcodePostedBlock {
  bodyLineIndex: number;
  kind: 'rapid' | 'compensation-activation' | 'lead-in' | 'contour' | 'lead-out' | 'compensation-cancellation' | 'operation-boundary';
  text: string;
  operationId: string | null;
  segmentId: string | null;
  startPoint: Point2 | null;
  endPoint: Point2 | null;
  compensationBefore: 'G40' | 'G41' | 'G42';
  compensationAfter: 'G40' | 'G41' | 'G42';
}
```

Keep existing moves as the motion-block subset. After rendering, audit against the selected lifecycle: generic G0-under-compensation/unmatched activation/non-G40 boundaries, or Robofil program-scope ordering, single-operation limit, forbidden generic words, and M02 ending. Audit metrics/line-map consistency for both.

- [ ] **Step 4: Run post, UPID, and validation tests**

```bash
npm test -- --run src/domain/post src/domain/upid src/domain/path-intel/__tests__/pathPlanning.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/domain/path-intel/postGcode.ts src/domain/post/upidMachinePost.ts src/domain/post/__tests__/upidMachinePost.test.ts src/domain/upid/upidDocument.ts src/domain/upid/projectUpid.ts src/domain/upid/__tests__/upidDocument.test.ts src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/path-intel/__tests__/pathPlanning.test.ts
git commit -m "feat: post safe compensated wire paths"
```

---

### Task 7: Operation review UI, transition preview, and real gear acceptance

**Files:**
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorUpidExportPreview.tsx`
- Modify: `src/domain/editor/previewGeometry.ts`
- Modify: `src/domain/editor/__tests__/previewGeometry.test.ts`
- Modify: `src/__tests__/appDxfProjects.test.tsx`
- Modify: `src/__tests__/editorPathNativeDraft.test.tsx`
- Add: `DXF-test-subjects/z39motocicleta.dxf`
- Create: `src/domain/dxf/__tests__/z39Compensation.test.ts`
- Create: `e2e/compensated-gear-export.spec.ts`

**Interfaces:**
- Consumes: Task 4 intent editing/resolution, Task 5 transition results, Task 6 posted blocks.
- Produces: geometry-basis control, keep-inside/outside/centreline control, actual winding/code display, `lead-out` preview role, and complete export trace.

- [ ] **Step 1: Write failing UI review tests**

```tsx
it('shows automatic kept side and updates G41/G42 after reversal', async () => {
  expect(screen.getByTestId('compensation-kept-material')).toHaveTextContent('inside · automatic');
  const before = screen.getByTestId('compensation-code').textContent;
  click(screen.getByRole('button', { name: 'Reverse path operation' }));
  expect(screen.getByTestId('compensation-code').textContent).not.toBe(before);
  expect(screen.getByTestId('compensation-kept-material')).toHaveTextContent('inside');
});
```

Cover geometry basis, manual override persistence, unresolved ambiguous contour, lead-in/out preview, structured export rows, unverified profile gating, and download disabled on failures.

- [ ] **Step 2: Copy the real fixture and write failing z39 acceptance tests**

Copy `/mnt/c/Users/cristian/Downloads/z39motocicleta.dxf` to `DXF-test-subjects/z39motocicleta.dxf`, then assert:

```ts
expect(document.segments).toHaveLength(156);
expect(document.plan.operations).toHaveLength(1);
expect(operation.classification).toBe('exterior');
expect(operation.metrics.cutLength).toBeCloseTo(178.637007, 5);
expect(contour.area).toBeCloseTo(1216.888483, 5);
expect(forward.intent).toMatchObject({ keptMaterial: 'inside' });
expect(reverse.code).not.toBe(forward.code);
expect(reverse.keptMaterial).toBe(forward.keptMaterial);
expect(auditRapidWhileCompensated(post.blocks)).toEqual([]);
```

The only import diagnostic remains missing/confirmed unit metadata as applicable.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm test -- --run src/domain/dxf/__tests__/z39Compensation.test.ts src/domain/editor/__tests__/previewGeometry.test.ts src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx
```

Expected: FAIL because the review UI/preview roles are missing.

- [ ] **Step 4: Implement review controls and previews**

Add a visible project geometry-basis selector and operation compensation selector. Render actual resolution from executable refs, never persisted literal code. Extend preview travel roles to include `lead-out`; render automatic transition geometry without mutating the UPID document. Map every posted block to an inspectable export row.

- [ ] **Step 5: Run focused UI and real-fixture tests**

Run Step 3. Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/features/editor/EditorPathNavigatorPanel.tsx src/features/editor/EditorPage.tsx src/features/editor/EditorUpidExportPreview.tsx src/domain/editor/previewGeometry.ts src/domain/editor/__tests__/previewGeometry.test.ts src/__tests__/appDxfProjects.test.tsx src/__tests__/editorPathNativeDraft.test.tsx DXF-test-subjects/z39motocicleta.dxf src/domain/dxf/__tests__/z39Compensation.test.ts e2e/compensated-gear-export.spec.ts
git commit -m "feat: review compensated Robofil operations"
```

---

### Task 8: Configure the selected Windows workbench and verify the compensation milestone

**Files:**
- Modify outside git: `/mnt/c/Users/cristian/Documents/Wire_EDM_local/workbench.json`
- Optional portable artifact: `/mnt/c/Users/cristian/Documents/Wire_EDM_local/machines/charmilles-robofil-100-local.wireedm-machine.json`

**Interfaces:**
- Consumes: Tasks 1–7 final profile schema and codec.
- Produces: one inactive editable local profile without changing the active profile, template mirrors, output mirrors, or projects.

- [ ] **Step 1: Verify the folder is still safe to edit**

```bash
node -e "const fs=require('fs');const p='/mnt/c/Users/cristian/Documents/Wire_EDM_local/workbench.json';const w=JSON.parse(fs.readFileSync(p,'utf8'));if(w.projects.length!==0)process.exit(2);console.log(w.activeMachineProfileId,w.machineProfiles.length)"
```

Expected: the current active ID and profile count are printed; if projects are no longer empty, preserve them and edit only the profile array.

- [ ] **Step 2: Append the local profile with `apply_patch`**

Use the exact normalized schema from Task 1. Required settings:

```json
{
  "id": "charmilles-robofil-100-local",
  "name": "Charmilles Robofil 100 / Classic (verified 2026-07-13)",
  "controller": {
    "family": "charmilles-robofil-classic",
    "postVersion": 1,
    "verification": { "status": "user-verified", "verifiedAt": "2026-07-13T00:00:00.000Z", "verifiedFingerprint": "generated-by-profile-codec" },
    "blockFormatting": "spaced",
    "coordinateSystem": "wire-position-g92",
    "unitsCode": "omit",
    "planeCode": "omit",
    "workOffsetCode": "omit",
    "distanceMode": "G90",
    "arcCenterMode": "absolute",
    "programEnd": "M02"
  },
  "compensation": {
    "supported": true,
    "enabledByDefault": true,
    "offsetSelection": { "address": "D", "index": 0 },
    "activation": "charmilles-g38",
    "cancellation": "program-end",
    "lifecycleScope": "program",
    "preActivationCodes": ["G60"],
    "validationLeadLengthMm": 2,
    "expectedMaximumOffsetMm": 0.5
  },
  "templates": {
    "header": "",
    "footer": ""
  },
  "output": { "extension": "iso", "lineEnding": "crlf", "coordinatePrecision": 3 },
  "workArea": { "widthMm": null, "lengthMm": null },
  "notes": "Physically verified on the local Robofil 100 with the z39 gear on 2026-07-13. D0 remains controller table state; confirm its value for each job. Multi-contour compensation remains blocked pending a verified lifecycle."
}
```

Do not change `activeMachineProfileId` or compatibility template/output mirrors automatically.

- [ ] **Step 3: Export the same profile artifact and reconnect through the app**

Serialize with the final codec, compute the verification fingerprint instead of inserting the placeholder above, write the optional `machines/` artifact, reconnect the directory-backed workbench, select the profile, and confirm fields render exactly. Keep it inactive by default so the existing active profile and compatibility mirrors do not change.

- [ ] **Step 4: Run complete verification**

```bash
npm test -- --run
npm run build
npm run test:e2e -- e2e/app-shell.spec.ts
git diff --check
git status --short
```

Also post the real z39 fixture at precision 3 and inspect G92/G60/G38, derived G41/G42 D0, G90, all 78 absolute arc centres, omission of G21/G17/G54/G40/M30, CRLF, and M02-only ending. Confirm maximum formatted start/end arc-radius mismatch is no worse than the observed 0.001106 mm rounding reference.

- [ ] **Step 5: Record the physical-machine handoff**

Report the exact generated sequence and remind the operator to confirm the D0 table value for the job. The preset may record the supplied successful physical verification, but any controller-sensitive edit resets that acknowledgement.
