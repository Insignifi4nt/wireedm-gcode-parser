# App, UPID and post surface review closure

Implementation commit: `836f25c` on `codex/post-processor-architecture`. The original review, reproduction script and captured baseline evidence are in the same commit. No push or deployment was made.

| Finding | Closure | Regression evidence |
| --- | --- | --- |
| F01 | The motion audit uses coordinate and block specific rounding, including prior endpoints and incremental arc centers. Fine cuts cannot inherit a coarse positioning allowance. | `customPostRuntime.test.ts`, `controllerProgram.test.ts`, Robofil decimal DXF test |
| F02 | Finished-contour execution requires an explicit controller compensation or centerline choice. A portable draft may remain incomplete. | `executionPlan.test.ts`, UI workflow tests |
| F03 | The shared runtime checks compensation state after start and before every cut. Preflight enforces packages that require it for every operation. | `customPostRuntime.test.ts`, `postCapabilityPreflight.test.ts` |
| F04 | Manual threading begins with a neutral, unset separation choice. The panel shows the active planning package's supported mechanisms. | `EditorBetweenContoursPanel.test.tsx` |
| F05 | A manually threaded, already-separated wire may cross known finished material; connected continuous travel remains blocked. | `executionPlan.test.ts` |
| F06 | Material interval containment uses exact line, arc and circle geometry and the authored contour classification. Inactive reference spans cannot define a closed material region. | `positioningMaterial.test.ts` |
| F07 | Post schema v2 declares exact separation mechanisms; preflight and conformance check each one. Legacy schema v1 booleans remain readable but do not authorize a specific mechanism. Robofil 2.5.0 declares only automatic separation during positioning. | `postPackage.test.ts`, `postCapabilityPreflight.test.ts`, Robofil conformance and package validation |
| F08 | G60 absolute IJ interpretation is confined to the explicit legacy Robofil parser profile. | `gcodeParser.test.ts` |
| F09 | The published SDK includes `position.separatesWire`, with runtime and SDK payload parity checked across all event fields. | `postAuthoringPayloadParity.test.ts`, generated-doc freshness check |
| F10 | UPID v2 publishes the new threading and stop values. Engine 2 creates revisions; engine 1 revisions retain hashes and exact plan comparison when read. Current readiness is required before generating from an old revision. | `portableUpidProject.test.ts`, `savedWireEdmJobRevision.test.ts`, UPID conformance |
| F11 | History reads a bounded page of 20 revision summaries and loads a full revision only for an operator action. | `revisionSummaries.test.ts`, `ProjectRevisionsDialog.test.tsx` |
| F12 | Motion blocks are indexed once by event ID before audit. | `controllerProgram.test.ts` 10,000-event regression |
| F13 | Deletion tolerates only missing paths owned by the selected revision or archived project, while retaining collision and unrelated-file checks. | `savedWireEdmJobCatalogMutation.test.ts` |
| C01 | Entry and exit distance calculations live in a typed domain API; UI parsing and display use the exact value. | `leadDistances.test.ts` |
| C02 | Large browser-cache compression uses the asynchronous worker path when `Worker` is available; immutable route analyses are memoized. A varied 4,000-segment revision and journal round-trip under quota. | `browserCacheAdapter.test.ts`, existing storage recovery tests |
| C03 | Threading-pair validity is shared by the planner, mutators and validator. The editor is loaded on demand; the initial JS chunk fell from about 1.24 MB to 835 kB, with a separate 416 kB editor chunk. | `threadingIntent.test.ts`, full app suite, production build |

## Verification

- `npm test -- --run`: 134 files, 1,339 tests passed.
- `npm run build`: typecheck and production build passed.
- `npm run post:docs:check`, `npm run post:conformance -- examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json`, `npm run machine-package:validate -- examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-package`, and `npm run upid:conformance`: passed.
- `git diff --check` passed for implementation changes. The review reproduction script's extra blank line was removed in the closure commit.

The Robofil package remains a candidate. Its new separation and compensation sequences still require controller graphics and a supervised dry run before machine use. The main bundle remains above Vite's 500 kB warning threshold; the editor split is the targeted reduction in C03.
