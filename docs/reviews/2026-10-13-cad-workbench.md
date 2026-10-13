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

This is a substantial first CAD checkpoint, not feature parity with CATIA: general geometric constraints, assemblies, freeform surfaces, arbitrary face sketching, individual edge selection and editable imported STEP history are not included. Dimensions use millimetres and angles use degrees. Initial exact-kernel loading costs a lazy WASM download; builds and meshes have explicit resource limits. The viewport and feature history remain responsive while worker computations run.
