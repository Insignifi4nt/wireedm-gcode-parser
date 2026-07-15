# Browser 3D Simulation Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for production behavior. Independent Tasks 1 and 2 may run in parallel; integration follows after their interfaces exist.

**Goal:** Deliver a runnable, smooth, geometrically faithful 3D Wire EDM simulation spike without modifying the active editor workflow composition.

**Architecture:** Optional project and workbench simulation settings feed a pure timeline compiler based on exact posted moves. A standalone Dashboard-launched React Three Fiber workspace renders the timeline and persists configuration through existing storage adapters.

**Tech Stack:** React 19, TypeScript, Vitest, Three.js WebGL, React Three Fiber 9, Drei, Tailwind CSS.

## Global Constraints

- Work only in `/home/cristian/code/WireEDM_app/.worktrees/3d-simulation-spike` on `codex/3d-simulation-spike`.
- Do not modify `EditorPage`, workflow lifecycle/routing, editor workflow panels, Program Lines/header ownership, or the editor control ledger.
- Preserve browser-cache, directory, and memory storage behavior.
- Simulation playback duration must be labeled visual playback and must not claim machining-time accuracy.
- Project simulation machine selection must never silently mutate the project's export machine snapshot.
- No real-time per-frame CSG and no predictive EDM physics in this spike.
- Use tests for domain and persistence behavior; WebGL pixels are verified by browser smoke testing rather than brittle DOM tests.

---

### Task 1: Persistent simulation configuration

**Files:**
- Create: `src/domain/simulation/simulationConfig.ts`
- Create: `src/domain/simulation/__tests__/simulationConfig.test.ts`
- Create: `src/domain/storage/updateSimulationSettings.ts`
- Create: `src/domain/storage/__tests__/updateSimulationSettings.test.ts`
- Modify: `src/domain/workbench/types.ts`
- Modify: `src/domain/storage/workbenchStorage.ts`

**Interfaces:**
- Produces `ProjectSimulationSettings`, `WorkbenchSimulationSettings`, `MachineSimulationSettings`, `defaultProjectSimulationSettings(project, bounds)`, `normalizeProjectSimulationSettings(value, project, bounds)`, `normalizeWorkbenchSimulationSettings(value, machineProfiles)`, `updateProjectSimulationSettings(workbench, projectId, settings)`, and `updateWorkbenchSimulationSettings(workbench, settings)`.
- Project settings include `schemaVersion: 1`, `machineProfileId`, `stock.{widthMm,lengthMm,thicknessMm,originX,originY,topZMm,material}`, `entryHoleDiameterMm`, and `visualPlaybackSpeed`.
- Machine settings include `upperGuideZMm`, `lowerGuideZMm`, `tankDepthMm`, `defaultWireDiameterMm`, and `fixtureClearanceMm`.

- [ ] Write failing normalization tests for legacy missing values, finite positive dimensions, bounds-derived stock padding, and configured-machine filtering.
- [ ] Run `npm test -- --run src/domain/simulation/__tests__/simulationConfig.test.ts` and confirm failure because the module is missing.
- [ ] Implement typed settings and pure normalization/default functions.
- [ ] Run the focused normalization tests and confirm they pass.
- [ ] Write failing storage tests proving project settings update only the target `project.json`, workbench settings update `workbench.json`, and adapter write failures do not return a falsely updated workbench.
- [ ] Run `npm test -- --run src/domain/storage/__tests__/updateSimulationSettings.test.ts` and confirm the expected failures.
- [ ] Implement the two storage update functions using the existing adapter and manifest patterns.
- [ ] Run both focused test files and confirm they pass.

### Task 2: Deterministic simulation timeline

**Files:**
- Create: `src/domain/simulation/simulationTimeline.ts`
- Create: `src/domain/simulation/__tests__/simulationTimeline.test.ts`

**Interfaces:**
- Produces `SimulationTimeline`, `SimulationTimelineMove`, `SimulationCursorState`, `compileSimulationTimeline(document, machine)`, and `sampleSimulationCursor(timeline, progress)`.
- Each move carries `id`, `kind`, `command`, `reason`, `operationId`, `segmentId`, `programLineNumber`, `start`, `end`, sampled `points`, `lengthMm`, `startDistanceMm`, and `endDistanceMm`.
- The compiler returns `status: 'ready' | 'blocked'`, diagnostics, total distance, cut/rapid distance, and operation summaries.

- [ ] Write failing tests for a mixed rapid/line/arc document, stable trace IDs, posted program-line mapping, arc-length sampling, accumulated distances, and cursor interpolation at boundaries.
- [ ] Run `npm test -- --run src/domain/simulation/__tests__/simulationTimeline.test.ts` and confirm failure because the module is missing.
- [ ] Implement compilation using `composeUpidGCodeExport` and existing path-segment geometry, with no UI or Three.js dependency.
- [ ] Run the focused tests and confirm they pass.
- [ ] Add blocking tests for invalid documents and blocked machine posts.
- [ ] Implement blocking propagation and confirm all focused tests pass.

### Task 3: Three.js scene and playback controls

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/simulation/SimulationScene.tsx`
- Create: `src/features/simulation/SimulationTransport.tsx`
- Create: `src/features/simulation/simulationPlayback.ts`
- Create: `src/features/simulation/__tests__/simulationPlayback.test.ts`

**Interfaces:**
- `SimulationScene` consumes a ready `SimulationTimeline`, `ProjectSimulationSettings`, `MachineSimulationSettings`, cursor progress, camera preset, and grid/tank visibility.
- `SimulationTransport` owns no domain data and emits progress/playback/camera/view callbacks.
- `advanceSimulationProgress(current, elapsedSeconds, speed, totalDistanceMm)` is a pure tested helper.

- [ ] Install `three`, `@types/three`, `@react-three/fiber@^9`, and `@react-three/drei`.
- [ ] Write and fail focused playback tests for pause, wrap/stop, zero distance, and speed scaling.
- [ ] Implement the pure playback helper and pass its focused tests.
- [ ] Implement a memoized R3F scene with orthographic camera, orbit controls, adaptive DPR, stock plate, bed/tank context, guides, vertical wire, completed/active path treatments, and isometric/top/front/right presets.
- [ ] Implement a transport bar with reset, play/pause, progress range, visual speed, camera presets, fit, grid, and tank controls.
- [ ] Run the focused test and `npm run build`.

### Task 4: Standalone simulation workspace and persistence UI

**Files:**
- Create: `src/features/simulation/SimulationWorkspace.tsx`
- Create: `src/features/simulation/SimulationSetupPanel.tsx`
- Create: `src/features/simulation/SimulationTelemetryPanel.tsx`
- Create: `src/features/simulation/__tests__/SimulationWorkspace.test.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/ProjectListPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Dashboard exposes Simulate only for `dxf` and `upid` project rows.
- `SimulationWorkspace` receives `workbench`, `projectPath`, `onClose`, and update callbacks; it loads the project, compiles the timeline, manages the visual cursor, and renders setup/scene/telemetry/transport regions.

- [ ] Write a failing component test proving only path projects expose Simulate and launching it loads the requested project.
- [ ] Implement the Dashboard action and full-screen workspace overlay without adding an editor active view.
- [ ] Write failing component tests for invalid setup, successful save, blocked post, play/pause, scrub, and close.
- [ ] Implement the setup and telemetry panels with technical labels and accessible controls.
- [ ] Run focused component tests and the production build.

### Task 5: Settings tab, integration, and first-shot verification

**Files:**
- Create: `src/app/SimulationSettingsPanel.tsx`
- Modify: `src/app/WorkbenchSettingsDialog.tsx`
- Modify: `src/app/appServices.ts`
- Modify: `src/app/useWorkbenchAppController.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/workbenchSettings.test.ts` or add a focused settings-panel test as appropriate.

**Interfaces:**
- The settings dialog adds a `3D Simulation` section with a machine-profile dropdown sourced only from the existing machine library and fields for that machine's reusable visual settings.
- Saving calls `updateWorkbenchSimulationSettings`; it does not change the active export machine or verification fingerprint.

- [ ] Write a failing UI/service test for machine selection and persistent machine-specific values.
- [ ] Add the settings section, controller service, and save status handling while preserving existing storage and machine-output behavior.
- [ ] Run focused settings and storage tests.
- [ ] Run `npm test -- --run` and require zero failures.
- [ ] Run `npm run build` and require exit code 0.
- [ ] Start the Vite server and perform a headed browser smoke check of project launch, scene rendering, playback, scrub, orbit, camera presets, configuration save/reload, resize, and console output.

