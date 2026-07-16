# Guided Workflow and Production Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved guided editor architecture and the G92, entry/exit, and partial-contour production capabilities without weakening local-first or controller safety.

**Architecture:** A pure command/session layer owns mutating-tool availability and transitions, while versioned local layout persistence remains separate. Additive typed UPID setup, transition, and participation models flow through normalization, history, planning, validation, posting, and guided UI in coherent vertical slices.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS.

## Global Constraints

- Preserve browser-cache startup and optional File System Access persistence.
- Preserve source geometry and existing controller/post verification boundaries.
- One mutating tool session owns canvas interaction; one completed workflow creates one labelled document transaction.
- G92 is reviewed project setup intent, never a machine-profile constant or geometry transform.
- Program stops are typed, profile-authorized events; enabled stops emit canonical `M00`, never implicit `M01`.
- Manual and automatic rethreading are explicit transition policies; automatic controller codes require exact verified machine support.
- Machine-program-to-UPID conversion remains deferred.
- Never mutate the external Prisma DXF or folder-backed saved project as test setup.

---

### Task 1: Command and Tool-Session Foundation

**Files:**
- Create: `src/features/editor/commands/editorCommands.ts`
- Create: `src/features/editor/commands/editorToolSession.ts`
- Test: `src/features/editor/commands/editorCommands.test.ts`
- Test: `src/features/editor/commands/editorToolSession.test.ts`
- Modify: `src/features/editor/EditorPage.tsx`

**Interfaces:**
- Produces `EditorCommandDefinition`, `EditorCommandAvailability`, `evaluateEditorCommand`, `EditorToolSession`, `editorToolSessionReducer`, and `canStartEditorToolSession`.
- The reducer accepts `advance`, `back`, `reset`, `escape`, `apply`, and `cancel`; `apply` yields a typed commit request and history label.

- [x] Write failing tests proving a selected-operation command reports a concrete missing-selection reason, a conflicting active session reports the active command, Escape steps back before cancel, and Apply is unavailable before completion.
- [x] Run `npm test -- --run src/features/editor/commands/editorCommands.test.ts src/features/editor/commands/editorToolSession.test.ts`; expect failures for missing modules.
- [x] Implement the typed registry helpers and pure reducer with exhaustive event handling.
- [x] Run the focused tests; expect all command/session tests to pass.
- [x] Integrate one existing canvas mutation (`Set Start`) through the reducer and existing labelled history boundary, retaining current geometry behavior.
- [x] Run `npm test -- --run src/features/editor/commands src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`; expect pass.

### Task 2: Workflow Menus and Persistent Layout

**Files:**
- Create: `src/features/editor/workspace/editorWorkspaceLayout.ts`
- Test: `src/features/editor/workspace/editorWorkspaceLayout.test.ts`
- Modify: `src/features/editor/EditorHeaderBar.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Test: `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx`

**Interfaces:**
- Produces `EditorWorkspaceLayoutV1`, `readEditorWorkspaceLayout`, `normalizeEditorWorkspaceLayout`, and `writeEditorWorkspaceLayout`.
- Menu commands call `showOrFocusWorkspacePanel(panelId)` and consume the central registry's availability.

- [x] Write failing layout tests for invalid JSON fallback, obsolete panel removal, dock-order de-duplication, floating-rectangle clamping, and round-trip persistence.
- [x] Run the layout test; expect missing exports.
- [x] Implement versioned local-storage serialization and pure normalization without persisting active sessions.
- [x] Replace `EditorPage` layout-only initial state with the normalized record and debounce writes after placement, order, geometry, or width changes.
- [x] Add Project, Geometry, Machining, Construction, View, Machine, and Export menus that open/focus remembered panels and expose disabled reasons.
- [x] Remove duplicate Path Actions reorder/Undo/Redo controls, move Perpendicular/Tangent discovery to Construction, and keep Cut Sequence as reorder home.
- [x] Run workspace component tests and `npm run build`; expect pass.

### Task 3: Project Initial Wire Position and G92

**Files:**
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/upid/projectUpid.ts`
- Modify: `src/domain/upid/validateUpidDocument.ts`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: `src/features/editor/EditorPage.tsx`
- Modify: `src/features/editor/EditorWorkspacePanels.tsx`
- Test: `src/domain/upid/__tests__/validateUpidDocument.test.ts`
- Test: `src/domain/post/__tests__/upidMachinePost.test.ts`
- Test: `src/domain/path-editor/__tests__/pathDocumentOperations.test.ts`

**Interfaces:**
- Adds `PathProjectSetup.initialWirePosition` with geometry-linked and manual variants.
- Produces `resolveInitialWirePosition(document)`, `setInitialWirePosition`, and transform invalidation/update behavior.
- `postUpidForMachine` initializes tracked position and G92 from the same resolved point.

- [x] Add failing tests for reviewed manual G92, geometry-linked circle center resolution, manual review invalidation after transform, missing/stale G92 export blocking, and no zero-length first rapid.
- [x] Run the focused UPID/path/post tests; expect assertion failures against hardcoded `G92 X0 Y0`.
- [x] Add the setup types, legacy normalization, structural validation, and pure resolver.
- [x] Add atomic path operations to set/review the point and update or invalidate it during every geometry transform.
- [x] Replace Robofil hardcoded G92 and initial position with the resolved reviewed setup; preserve generic and older post safety behavior.
- [x] Add the Initial Wire Position session/panel with semantic circle-center selection, exact X/Y, review acknowledgement, route preview, and explicit G92 preview.
- [x] Run focused tests, `npm run build`, and the full test suite.

### Task 4: Per-Operation Entry and Exit

**Files:**
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/upid/projectUpid.ts`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: `src/domain/path-intel/planOperations.ts`
- Modify: `src/domain/compensation/validateCompensatedExport.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`
- Test: corresponding path-editor, planning, compensation, post, and editor component test files.

**Interfaces:**
- Adds `OperationEntry`, `OperationExit`, and `PathOperationTransitions` while normalizing legacy `leadIn` overrides.
- Produces `operationEntryPoint`, `operationExitPoint`, and `setOperationTransitions`.

- [x] Write failing tests for lossless legacy lead migration, actual strategy labels, manual entry/exit persistence, route endpoints, transform review invalidation, metrics, compensation validation, and post trace.
- [x] Run focused tests; expect failures against the old `leadIn`-only model.
- [x] Implement typed transitions and legacy normalization without claiming unsupported strategies.
- [x] Update planner, metrics, transforms, validation, and post to consume configured exit/entry points.
- [x] Replace compact Start/Pierce UI with the Entry/Exit tool session supporting circle-center and reviewed manual-straight geometry.
- [x] Run focused tests, build, and full suite.

### Task 5: Threading and Rethreading Transitions

**Files:**
- Create: `src/domain/path-intel/threadingTransitions.ts`
- Test: `src/domain/path-intel/__tests__/threadingTransitions.test.ts`
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorUpidExportPreview.tsx`
- Test: corresponding machine, post, save/load, and editor component test files.

**Interfaces:**
- Adds `ThreadingMode`, `WireSeparationStrategy`, `OperationThreadingTransition`, and `MachineThreadingPolicy`.
- Produces `resolveOperationThreadingTransition(document, operationId, machine)` and traceable `wire-separation`, `position-for-threading`, `manual-rethread`, and `automatic-rethread` blocks.

- [x] Write failing tests for project-default and per-operation override resolution, plus rejection of continuous threading across separate closed contours.
- [x] Add failing golden tests for `G39 → G40 → G0 next entry → M00 → G41/G42 → lead-in` and the two-stop `manual-before-positioning` variant.
- [x] Add failing tests proving automatic mode is blocked for legacy/manual-only profiles and emits no inferred M50/M59/M60 codes.
- [x] Run focused threading/machine/post tests; expect missing type and behavior failures.
- [x] Implement normalized threading policy with legacy projects defaulting to reviewed manual rethreading for multi-operation controller posts.
- [x] Extend machine profiles with explicit manual/automatic capabilities and exact verified automatic command sequences; controller-sensitive edits reset verification.
- [x] Emit manual stops only after positioning at the next entry, with an additional pre-position stop when manual wire separation is configured.
- [x] Add project default and per-transition UI showing physical sequence, entry target, disabled reasons, and exact posted blocks.
- [x] Run focused tests, build, and full suite.

### Task 6: Configurable Program Stops

**Files:**
- Create: `src/domain/path-intel/programStops.ts`
- Test: `src/domain/path-intel/__tests__/programStops.test.ts`
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/machine/machineProfiles.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorUpidExportPreview.tsx`
- Test: corresponding machine, post, and editor component test files.

**Interfaces:**
- Adds `OperationProgramStop`, `OperationProgramStopPlacement`, and `MachineProgramStopPolicy`.
- Produces `resolveProgramStopPoints(operation)`, `validateProgramStops(operation, machine)`, and stable post blocks with kind `program-stop`.

- [x] Write failing tests for canonical M0/M00 normalization, before-entry, after-contour, after-exit, and exact remaining-cut-distance placement across line/arc segments.
- [x] Add failing tests proving invalid/duplicate distances and unsupported compensation-active stops block output atomically.
- [x] Run focused program-stop/machine/post tests; expect missing type and behavior failures.
- [x] Implement pure arc-length placement and source-preserving executable split points, then normalize legacy profiles to program stops unsupported.
- [x] Add an explicit editable machine policy for supported stop placements and modal states; controller-sensitive edits reset verification.
- [x] Emit traceable standalone `M00` blocks only at validated boundaries and preserve compensation state across the stop.
- [x] Add per-operation Program Stop authoring with enable/disable, placement, remaining millimetres, reason/note, and exact route preview.
- [x] Run focused tests, build, and full suite.

### Task 7: Lossless Partial-Contour Machining

**Files:**
- Create: `src/domain/path-intel/machiningParticipation.ts`
- Test: `src/domain/path-intel/__tests__/machiningParticipation.test.ts`
- Modify: `src/domain/path-intel/types.ts`
- Modify: `src/domain/path-intel/planOperations.ts`
- Modify: `src/domain/path-editor/pathDocumentOperations.ts`
- Modify: `src/domain/compensation/intent.ts`
- Modify: `src/domain/compensation/validateCompensatedExport.ts`
- Modify: `src/domain/post/upidMachinePost.ts`
- Modify: `src/features/editor/EditorPreview.tsx`
- Modify: `src/features/editor/EditorPathNavigatorPanel.tsx`
- Modify: `src/features/editor/EditorPage.tsx`

**Interfaces:**
- Adds `MachiningSpan`, `MachiningParticipation`, stable span IDs, and `deriveActiveMachiningOperations`.
- Adds explicit open-operation kept-side intent and participation edit commands for whole segments and parameterized sub-spans.

- [x] Write failing tests for whole-segment disable/re-enable, stable split-span identity, preserved provenance, contiguous active-chain derivation, intentional-open diagnostics, direction, explicit kept side, and posting only active spans.
- [x] Run focused participation/planning/post tests; expect missing-module and behavior failures.
- [x] Implement normalized participation overlay and pure active-chain derivation without mutating source segments.
- [x] Integrate atomic participation edits, planning, validation, compensation intent, metrics, trace, and post filtering.
- [x] Add canvas/tree participation authoring and distinct active, inactive, entry/exit, and rapid rendering.
- [x] Add a repository-safe Prisma-derived fixture or copy to a temporary test workbench and assert both holes plus only the toothed top span are posted.
- [x] Run focused tests, build, full Vitest, and relevant Playwright flows.

### Task 8: Interaction Cleanup and Production Verification

**Files:**
- Modify: `src/features/editor/EditorPreview.tsx`
- Modify: `src/features/editor/EditorUpidExportPreview.tsx`
- Modify: `src/features/editor/EditorProgramTextPanel.tsx`
- Modify: `e2e/editor-layout.spec.ts`
- Create: production acceptance test/artifact files only under repository-owned test or artifact paths.

**Interfaces:**
- Native wheel/touch listeners use `{ passive: false }` only where default prevention is required.
- Export preview exposes reviewed G92, active operations/spans, transitions, and blocking diagnostics.

- [x] Reproduce and test the passive-listener warning path, then move default-preventing handlers to explicit native listeners.
- [x] Expand export and Machine Program preview so normal Path Projects expose exact generated controller text without manual editing.
- [x] Run the complete Prisma acceptance against a copy and audit modal state, excluded edges, route, G92, configured M00 placement, and output bytes.
- [x] Run `npm test -- --run`, `npm run build`, and relevant Playwright tests; expect all pass and no application passive-listener warning.
- [x] Review the final diff for deferred machine-program-to-UPID scope, fixture mutation, mock UI, and controller-policy regressions.
