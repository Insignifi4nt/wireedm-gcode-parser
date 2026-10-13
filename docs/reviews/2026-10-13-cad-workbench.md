# CAD workspace checkpoint review

Base: stable `3e3fce9` / app 0.0.696. Implementation is isolated on `feature/parametric-cad-workbench`; the existing optimization checkout is untouched. Candidate app version is 0.0.697.

## Delivered behavior

The desktop CAD workspace shares one immutable, versioned model between the interface and WebMCP tools. Named dimensions and bounded arithmetic drive closed rectangle, circle, polygon and slot profiles; ordered features build exact OpenCascade solids with pads, revolves, Boolean operations, whole-body fillets/chamfers, transforms, mirrors and linear patterns. The feature tree, property editor, history and demand-rendered viewport use these application operations.

CAD saves use the existing cache/folder storage lock and file journal with exact stored fingerprints. JSON preserves history; STEP exports BRep; STL exports tessellation; DXF preserves analytic sketch curves. Sketch and final-solid section handoff validate clean millimetre geometry and create detached CAM projects through ordinary portable-UPID import. They do not generate controller output or mutate installed packages or saved CAM revisions.

The agent surface adds schema discovery, bounded complete-document reads, atomic edits, analytic sketch measurements, exact body measurements, section inspection, shared saves/exports/handoffs, viewport commands and real PNG captures. Public instructions work from the hosted app without a checkout or terminal.

## Independent review and resolved findings

GPT-6.1 SOL high agents separately owned domain/storage, exact kernel and desktop interaction work; each reviewed other integration boundaries. The coordinating agent implemented controller, agent-tool and CAM integration and exercised native browser tools.

- Numerical review corrected full-circle classification, normalized whole turns before rotations, preserved close genuine secants while collapsing roundoff tangent duplicates, and rejected ambiguous native section topology. Real-WASM regression cases cover all sketch planes, winding, negative pads, mirrors, revolve limits, large angles and kernel precision failures.
- Worker review added tuple/index/normal consistency, sparse-array and duplicate-body rejection, and an aggregate preview-buffer budget. Cancellation terminates active computation; deadlines, bounded queues, disposal and periodic replacement bound worker lifetime.
- Storage review detached saved fingerprints when changing adapters and prevented switching with a meaningful hidden draft. Draft/version checks run again after asynchronous work and immediately before persistence.
- Final persistence review moved receipt hashing before any durable write, aligned case-insensitive CAD retention reporting with backup protection, and unified CAM context/recovery busy reporting with the CAD operation gate. Cache and folder regressions verify late cancellation, exact rollback, committed cleanup retry and preservation of malformed/BOM/case-variant CAD files. The final affected suites and TypeScript check pass after these fixes.
- Interaction review fixed viewport height, active-workflow publication, keyboard drawing, focus behavior, stale capture guards and renderer callback ownership during solid/sketch switches. Selection recolors existing meshes without rebuilding their geometry.
- Agent review bounded context diagnostics before serialization, preserving truthful success receipts after accepted edits. A committed CAM project whose editor opening fails now retains its receipt and shows an actionable project-ID warning.
- Geometry broadphase uses conservative streaming bounds and preserves the existing exact intersection predicates. Differential tests compare against exhaustive mixed line/arc/circle checks. An 8,192-edge sparse fixture improved from approximately 803 ms to 48 ms in the measured local run; this is a fixture result, not a universal latency guarantee.

## Verification

- Complete Vitest run: 224 files / 2,241 tests pass with four workers. An initial unrestricted run overlapped the production build and timed out one filesystem source-distribution test; the unchanged test passes in the complete bounded-worker rerun.
- Production TypeScript/build passes. Documentation: 29 static pages / 92 checked files. Pinned corresponding-source distribution verifies five CAD archives, installed artifact hashes, complete notices and relink instructions; existing STEP distribution still passes.
- Full production Chromium run: 94 pass, one existing externally seeded-workbench case skipped. Includes real lazy WASM, STEP and binary STL, failed-feature export guards, shared human/agent edits, save/reload, sketch/section CAM handoff and 2D/3D capture, plus the existing CAM suite. The new dashboard action changes the first tab stop; its regression now verifies CAD followed by the existing DXF action. Seven focused CAD/kernel/workflow/focus tests also pass.
- Generated post contract parity, all three portable-UPID conformance examples, all three unchanged Robofil 2.6.0 post fixtures, complete machine-package validation, release compatibility gate and whitespace check pass.
- Native Codex WebMCP verified the exact 60 × 40 × 10 mm rounded plate with 5 mm bore: 23,137.345175425635 mm³, 688 preview triangles, cached rebuild 86 ms. Saved JSON reopens, stale edits fail, STEP exports, solid/sketch PNG captures work, and XY section at `thickness / 2` transfers two analytic contours into CAM. The CAM editor retains its ordinary unresolved threading diagnostic. These are local browser checks, not physical machining verification.

## Compatibility and limits

The app version advances once. New CAD schemas are independent of unchanged UPID/post/package/engine contracts. There is no migration, automatic cleanup or silent rewrite. Backup retains all CAD files, including unrecognized future or malformed documents. Source CAD save and CAM creation are separate commits; failures report that distinction.

Fresh nearly tangent calculations include the numerical intersection correction, so newly calculated geometry can differ at roundoff boundaries. Existing saved geometry, packages and generated bytes are unchanged. Sections reject ellipses, splines, open/branched contours and tangent or ambiguous results rather than silently flattening them.

General geometric constraints, assemblies, freeform surface authoring, arbitrary face sketching and reconstruction of imported STEP feature history remain outside this checkpoint. Dimensions use millimetres and angles use degrees. Initial exact-kernel loading costs a lazy WASM download; builds and meshes have explicit resource limits. The viewport and feature history remain responsive while worker computations run.

## Local continuation in the same PR

The next iteration adds exact topology inspection, face/edge picking, selective fillet/chamfer and single planar-face inward shell. Temporary picks are pinned to an opaque native build identity; persisted features use geometric queries with exact match counts. Independent real-WASM review fixed reflected face normals and rejects incomplete tangent chains that the kernel would otherwise expand automatically. Bounded paging, stale-build rejection and cancellation are covered at domain, worker and application boundaries.

Following user review, CAD now uses the shell's single document header and a compact modeling toolstrip. CAM commands live in File. Sketch contour roles are inferred from analytic nesting, including islands; legacy saved fields remain unchanged until an explicit edit. STEP and closed STL import preserve original source, verify native geometry and units, and become standalone history bodies. DXF import creates exact editable sketch paths, preserving original source and circular arcs. Import/export formats now correspond across CAD JSON, STEP, STL and sketch DXF, subject to documented geometry limits.

The layout now collapses the Properties panel when empty and restores it on selection. Normal commands, tree text and inputs use 12 px text; metadata uses at least 10 px while bar heights remain compact. Literal dimensions no longer repeat their value below the input; expressions still show their evaluated result. File offers Rebuild model to restore exact topology after worker cancellation or recycling.

Independent review reproduced and fixed a lost-update race between the CAD optimistic read and journal capture: the file transaction now optionally verifies its captured original against the caller's exact expected bytes. Both cache and folder adapter tests preserve external edits and leave no journal on conflict. This does not provide filesystem-level compare-and-swap against arbitrary external writers after capture. Other fixes cover timestamp ordering, strict UTF-8 JSON import, immutable draft snapshots, mismatched save receipts, invalid topology responses, malformed tool arguments, import cancellation/disconnection and rebuild on storage reconnect. Imported DXF tests reject nonzero geometry elevation/thickness and adjacent-edge self-intersections without flattening curves.

Final local verification for this continuation:

- Vitest pure-domain: 43 files / 348 tests pass. Browser project: 197 files / 2,098 tests pass. Total: 240 files / 2,446 tests, both with four workers.
- Production TypeScript/build, 29 documentation pages / 92 checked files, CAD/STEP corresponding-source bundles, release gate, generated post contracts and three UPID conformance examples pass.
- Full production Chromium: 100 pass, one existing externally seeded-workbench case skipped. The 11 CAD-specific checks also pass independently, covering exact selected chamfer, real face-click shell, parameterized shell section, STEP/STL/DXF round trips with preserved originals, visible STL unit review, save/reload, sketch capture and human/agent workflow protection. The complete run retains existing CAM, storage, package installation and controller-export behavior.
- Native WebMCP in the Codex browser reopens the original saved plate with unchanged exact volume, lists its 12 native faces, resolves its top planar face into geometric conditions and captures a 1,159 × 734 sketch PNG after the initial-layout timing correction. Real view changes still reject stale captures. The single-header layout and collapsed empty inspector were visually checked.

The local continuation stays on the same CAD branch and existing PR #12; there is no additional app version bump or separate PR. General constraint solving, assemblies, freeform surfaces and arbitrary-face sketching remain future work. At this checkpoint, imported analytic path segment editing was available through typed document operations; its properties panel exposed name and construction state. The follow-up below adds its segment editor.

## Local interaction and performance follow-up

CAD panels now resize with pointer or keyboard input. Preferred widths survive inspector collapse and narrower windows, while desktop resizing reserves a 480 px canvas. Width preferences are presentation state and do not alter documents or pending dimension drafts. Independent review found and fixed a shared rail lifecycle defect: pointer capture, blur, lost capture, released-button detection and unmount cleanup now prevent dragging from continuing after the mouse was released outside the browser. Existing CAM rail behavior has focused regression coverage.

Escape discards pending profile, feature, parameter and part-name edits. Save shortcuts belong to the app even while a draft prevents saving; they neither commit pending fields nor open the browser's Save Page dialog. Text inputs retain native text undo. Composition keystrokes remain with the input method. Exact topology browsing starts collapsed in Body mode, expands for face/edge selection and cancels its request when closed.

Imported analytic paths now expose a bounded line/arc segment editor. Users can enter expressions for endpoints, centres, radii and angles, navigating one segment at a time. Applying validates the entire contour atomically; invalid continuity leaves both the original document and the provisional fields intact. Source DXF bytes remain preserved, and edits never silently repair adjacent joints. Sketch picking uses the unsnapped pointer location, exact boundary distances within six screen pixels and the innermost non-construction interior. Construction profiles remain selectable on their boundaries.

History no longer serializes every retained document on each edit. Incremental immutable document lengths preserve the previous 50-step/8 MiB serialized-character budget, including brackets and commas. Exact-boundary tests cover trimming, undo/redo, failed edits, no-op edits and saved baselines. This is the existing history budget, not a measurement of total browser heap consumption.

Sketch validation prepares each analytic path once per resolution and reuses its edges and exact containment representation. Padded conservative contour bounds discard impossible containment candidates; surviving candidates still use the same analytic predicates. Nothing is cached across parameter changes. Independent comparison against the previous implementation passed 720 mixed-scale, winding, arc, nesting and parameter-change cases. This proves equivalence for those cases, not universal numerical correctness.

Controlled local measurements used Node 22.23.2 on an Intel Core i9-14900HX, alternating before/after order, three warmups and 15 measured pairs, without concurrent builds or test runs. These are separate measurements of each optimization, not an end-to-end frame-rate guarantee:

| Operation and fixture | Before median | After median |
| --- | ---: | ---: |
| Full-history edit, 1,000 imported edges | 119.47 ms | 20.23 ms |
| Full-history edit, 2,000 imported edges | 149.83 ms | 44.16 ms |
| Full-history edit, 64 × 100 imported edges | 382.64 ms | 264.84 ms |
| Region resolution, 20 disjoint 100-edge paths | 12.11 ms | 6.15 ms |
| Region resolution, 20 nested 100-edge paths | 32.53 ms | 18.85 ms |
| Region resolution, 64 disjoint 100-edge paths | 171.82 ms | 46.73 ms |

The ordinary 100-feature region fixture stayed near 0.6 ms; improvements are workload-dependent. Document validation and expression evaluation still contribute to larger edits. Geometry remains exact and the CAD/CAM handoff contract is unchanged.

Follow-up verification: all 246 Vitest files / 2,503 tests pass (348 pure-domain and 2,155 browser tests), with four workers. Production TypeScript/build passes. The affected CAD/kernel/CAM-layout production cases pass across focused runs, including all 11 CAD workflows, an imported line/arc path edited atomically into a 1,250 mm³ solid, pending dimensions surviving panel resizing and real mouse dragging on CAM rails. Browser testing caught and corrected Chromium click events reporting `isPrimary: false` despite a primary pointer sequence; click selection uses the actual button and workflow guards. The former synthetic CAM drag helper omitted pressed-button state and now uses real Playwright mouse input. Sketch panning also ends on blur, lost capture, released original button or unmount and ignores unrelated pointers.

Native browser inspection confirms the original saved plate retains its exact volume and its properties panel resizes without changing the document. The topology inspector stays collapsed until requested. This checkpoint remains local on the same branch and PR, with the same candidate version.
