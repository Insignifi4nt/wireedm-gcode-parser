# Mission Brief: Invent The DXF-To-Path Intelligence Core

Approach this as a pioneer in computational geometry, CAM path planning, manufacturing intelligence, and local-first engineering tools.

The task is to invent the strongest possible DXF-to-path intelligence core for `WireEDM_app`. Use the GitHub connector to read the repository files directly. The repository tree is included at the end of this prompt so you can jump to known paths without relying on directory listing.

This task is expensive and worth taking seriously. Do not optimize for a quick patch. Think for as long as needed. Design something that could become the foundation of a new class of CAD/CAM workbench, not merely a better converter.

## Core Challenge

Invent a state-of-the-art internal representation and planning engine for transforming DXF files into optimal, editable manufacturing paths.

The current app can parse some DXF geometry and emit G-code, but that is not the real goal. The real goal is to create a new proprietary internal format and intelligence layer:

```text
DXF drawing
  -> geometry understanding
  -> topology understanding
  -> contour and feature intelligence
  -> editable path operation model
  -> optimized manufacturing route
  -> one or more export/post formats, including G-code
```

G-code should be treated as an output/post format, not as the primary model. The primary model should be something better: an internal operation/path document that can be edited, inspected, optimized, transformed, simulated, and exported.

## Repository Orientation

Inspect the repository through the GitHub connector before designing.

Start with:

- `AGENTS.md`
- `README.md`
- `package.json`
- `src/domain/dxf/`
- `src/domain/post/`
- `src/domain/workbench/`
- `src/domain/storage/`

Useful current facts:

- The app is a local-first TypeScript/React workbench.
- Existing DXF parsing is early-stage.
- Current DXF-to-G-code generation is naive: it follows DXF entity order instead of reconstructing intelligent paths.
- The current parser handles basic geometry such as lines, arcs, circles, and lightweight polylines.
- Some DXF geometry can live in `BLOCKS` referenced by `INSERT`, so an excellent solution must not assume the visible `ENTITIES` section is the whole drawing.
- The current workbench direction is bigger than a one-file editor: future workflows may arrange and combine multiple contours/parts into larger operations.

Use the repo to understand constraints and integration points, but do not let the current implementation limit the design.

## What To Invent

Design the internal format and the algorithmic pipeline.

The internal format should be rich enough to represent:

- raw source identity and provenance
- exact geometry where possible
- approximated geometry where necessary
- coordinate systems, units, transforms, and source hierarchy
- blocks, inserts, layers, entity identity, and resolved geometry lineage
- segments that can be reversed, split, joined, transformed, and inspected
- arcs and curves as first-class objects where possible
- topology graph
- endpoint clusters and tolerances
- contours, open chains, islands, holes, nests, and ambiguous components
- feature classification where inferable
- operation order
- start choices
- direction choices
- optional lead-in/lead-out concepts
- compensation/offset concepts
- optimization preferences
- warnings, uncertainty, confidence, and provenance
- metrics for cut length, rapid length, risk, continuity, complexity, and quality
- future user overrides
- future multi-part/multi-contour workbench layouts

Do not merely copy existing CAD/CAM schemas. Use them as inspiration, then design something cleaner and more powerful for a local CAD/CAM workbench.

## What The Planner Should Understand

Here, "planner" means the deterministic geometry/CAM algorithm and internal data model, not an LLM agent. It should reason about DXF geometry as a manufacturing problem, not only a parsing problem.

It should aim to understand:

- which geometric entities belong together
- which segments form closed contours
- which chains are intentionally open
- which contours are holes, islands, exteriors, nested features, or independent parts
- when entity order is irrelevant or harmful
- when a segment should be reversed
- when endpoints should be snapped, healed, or left separate
- when topology is ambiguous and needs an explicit decision or user override
- when geometry should remain exact
- when approximation is acceptable and how to record it
- when path order should optimize continuity, stability, travel, safety, or user preferences
- how to support manual overrides without losing the original reasoning

Think beyond a single hardcoded strategy. The system should support configurable planning modes and preference profiles.

Examples:

- preserve exact CAD order when requested
- minimize rapid travel
- prioritize inside-before-outside cutting
- preserve material stability
- prefer continuous contours
- avoid risky start points
- choose or propose lead-ins
- support future kerf/offset/compensation workflows
- support future multi-part sheet/workbench layouts

## Algorithmic Ambition

Design the best practical algorithmic stack you can.

Consider, improve, or replace ideas such as:

- DXF normalization and block/insert resolution
- geometry kernels
- exact line/arc/circle math
- curve approximation with error bounds
- reversible segment algebra
- graph reconstruction
- spatial indexing
- endpoint clustering
- tolerance modeling
- topology confidence scoring
- contour reconstruction
- ambiguity detection
- self-intersection and overlap detection
- containment trees
- winding/area/feature analysis
- route optimization with constraints
- local search and global heuristics
- user preference scoring
- explainable optimization decisions
- confidence/risk annotations
- reversible operation history
- future external route refinement or learned optimization modules

If existing libraries are useful, evaluate them. If they are insufficient, design what is missing. The goal is not dependency minimalism; the goal is a superior architecture with clear reasoning.

## Output Expectations

Return a high-value artifact, not a shallow proposal.

Ideally include:

1. **The Conceptual Model**
   - What is the internal format?
   - What are its core objects?
   - Why is it better than editing G-code or raw DXF entities?

2. **The Data Schema**
   - TypeScript interfaces or equivalent schema.
   - Include provenance, exact/approx geometry, topology, operations, warnings, metrics, and user overrides.

3. **The Algorithm**
   - End-to-end DXF-to-path pipeline.
   - Explain the stages, inputs, outputs, invariants, and failure modes.
   - Include how each stage handles uncertainty.

4. **The Optimizer**
   - How route/order/start/direction decisions are scored.
   - How preferences alter results.
   - How user overrides remain first-class.

5. **The Export Layer**
   - How the internal document exports to G-code with line and arc support.
   - How other future export/post formats could fit.

6. **Implementation Artifact**
   - Provide files, modules, or archive-style full file contents if useful.
   - Prefer TypeScript because the repo is TypeScript.
   - It is fine if the result is larger than one patch; structure it so another engineer can extract useful parts.

7. **Validation Corpus**
   - Propose difficult DXF/path cases that would prove the design.
   - Include synthetic examples and expected planner behavior.

8. **Research Notes**
   - Summarize relevant prior art, algorithms, and libraries.
   - Explain what you borrowed, rejected, or surpassed.

9. **Integration Strategy**
   - How this would fit into the current repo after someone reviews your artifact.
   - What should be adopted first if the whole design is too large.

## Tone Of Work

Be ambitious and inventive.

Do not limit yourself to what current small CAM tools do.
Do not treat the existing DXF importer as the boundary.
Do not reduce the problem to just sorting line segments.
Do not overfit to simple rectangles.
Do not avoid advanced ideas just because they are not already in the app.

At the same time, make the design intelligible. The result should be something humans can inspect, test, debug, and gradually integrate.

The best answer is not the shortest answer. The best answer is the one that gives this project a genuinely powerful internal path intelligence layer.

## Repository File Tree

```text
.cursorignore
.gitignore
.vscode/settings.json
AGENTS.md
README.md
components.json
docs/superpowers/plans/2026-05-29-workbench-scaffold.md
docs/superpowers/prompts/2026-05-30-gpt55-dxf-to-paths-core.md
docs/superpowers/specs/2026-05-29-local-first-wire-edm-workbench-design.md
docs/superpowers/specs/2026-05-30-dxf-toolpath-planner-intent.md
index.html
package-lock.json
package.json
src/App.tsx
src/__tests__/appDxfProjects.test.tsx
src/__tests__/appTestHelpers.tsx
src/__tests__/appWorkbenchDashboard.test.tsx
src/__tests__/editorImportExport.test.tsx
src/__tests__/editorLineDrawer.test.tsx
src/__tests__/editorMeasurement.test.tsx
src/__tests__/editorPreviewControls.test.tsx
src/app/AppShell.tsx
src/app/WorkbenchSettingsDialog.tsx
src/app/appServices.ts
src/app/useWorkbenchAppController.ts
src/components/StatusToasts.tsx
src/components/ui/button.tsx
src/domain/dxf/__tests__/dxfToGcode.test.ts
src/domain/dxf/__tests__/importDxfProject.test.ts
src/domain/dxf/__tests__/parseDxf.test.ts
src/domain/dxf/__tests__/parseDxfSplineFallback.test.ts
src/domain/dxf/dxfToGcode.ts
src/domain/dxf/importDxfProject.ts
src/domain/dxf/parseDxf.ts
src/domain/dxf/types.ts
src/domain/editor/__tests__/gcodeLineOperations.test.ts
src/domain/editor/__tests__/gcodeParser.test.ts
src/domain/editor/__tests__/gcodeStructure.test.ts
src/domain/editor/__tests__/importExternalProgram.test.ts
src/domain/editor/__tests__/isoNormalizer.test.ts
src/domain/editor/__tests__/loadEditorProgram.test.ts
src/domain/editor/__tests__/measurementPoints.test.ts
src/domain/editor/__tests__/openWorkbenchProject.test.ts
src/domain/editor/__tests__/previewGeometry.test.ts
src/domain/editor/__tests__/saveEditorProgram.test.ts
src/domain/editor/gcodeLineOperations.ts
src/domain/editor/gcodeParser.ts
src/domain/editor/gcodeStructure.ts
src/domain/editor/importExternalProgram.ts
src/domain/editor/isoNormalizer.ts
src/domain/editor/loadEditorProgram.ts
src/domain/editor/measurementPoints.ts
src/domain/editor/openWorkbenchProject.ts
src/domain/editor/previewGeometry.ts
src/domain/editor/saveEditorProgram.ts
src/domain/editor/types.ts
src/domain/post/__tests__/downloadProgramFile.test.ts
src/domain/post/__tests__/gcodeTemplates.test.ts
src/domain/post/downloadProgramFile.ts
src/domain/post/gcodeTemplates.ts
src/domain/storage/__tests__/browserCacheAdapter.test.ts
src/domain/storage/__tests__/browserDirectoryAdapter.test.ts
src/domain/storage/__tests__/connectCachedWorkbench.test.ts
src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts
src/domain/storage/__tests__/updateWorkbenchSettings.test.ts
src/domain/storage/__tests__/workbenchStorage.test.ts
src/domain/storage/browserCacheAdapter.ts
src/domain/storage/browserDirectoryAdapter.ts
src/domain/storage/connectCachedWorkbench.ts
src/domain/storage/connectWorkbenchDirectory.ts
src/domain/storage/fileSystemAccess.ts
src/domain/storage/updateWorkbenchSettings.ts
src/domain/storage/workbenchStorage.ts
src/domain/workbench/__tests__/defaultProject.test.ts
src/domain/workbench/defaultProject.ts
src/domain/workbench/projectNaming.ts
src/domain/workbench/types.ts
src/features/dashboard/DashboardHeader.tsx
src/features/dashboard/DashboardPage.tsx
src/features/dashboard/LatestDxfImportPanel.tsx
src/features/dashboard/ProjectListPanel.tsx
src/features/dashboard/WorkbenchSettingsPanel.tsx
src/features/dashboard/dashboardSettings.ts
src/features/editor/EditorCanvasPanel.tsx
src/features/editor/EditorGuideDialog.tsx
src/features/editor/EditorHeaderBar.tsx
src/features/editor/EditorInspectorPanel.tsx
src/features/editor/EditorPage.tsx
src/features/editor/EditorPreview.tsx
src/features/editor/EditorProgramLinesPanel.tsx
src/features/editor/EditorProgramTextPanel.tsx
src/features/editor/editorGuideContent.ts
src/features/editor/editorGuideHighlight.ts
src/features/editor/editorLineState.ts
src/features/editor/editorPreviewHelpers.ts
src/index.css
src/lib/utils.ts
src/main.tsx
src/types/dxf.d.ts
src/vite-env.d.ts
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
vitest.config.ts
```
