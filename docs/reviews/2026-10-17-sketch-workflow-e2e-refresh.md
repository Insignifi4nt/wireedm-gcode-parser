# Existing CAD workflow E2E refresh

Scope: `e2e/cad-workflow.spec.ts` only, against the unchanged production build. No product, native, build, or deployment changes.

The mixed-path failure was an early accepted-state read after asynchronous Close profile, followed by an obsolete legacy-profile expectation. The test now awaits workflow completion and verifies the exact three graph points, CCW semicircle support and shared closing-line endpoint IDs. Its area, perimeter, bounds, Pad volume, rendered capture, invalid-through-point protection and foreign-edit guard remain covered. Undo now compares the entire blank feature snapshot; Redo restores the entire accepted sketch. The added measured bound uses the same eight-digit physical comparison as area/perimeter; exact source coordinates remain exact assertions.

The rectangle test also assumed legacy profile geometry and its Width editor. It now selects the actual horizontal graph edge, adds its ordinary distance driver through the human Dimension form, and checks all point/entity identities and original four H/V records. Width, unchanged height, exact Undo/Redo, workflow guards, native Pad volume and saving remain verified.

The datum Loft failure was the documented rendered-view invalidation during capture after Fit. The test now uses the existing `captureCadPreview` helper, which retries only `STALE_VIEW` once with the same accepted document version. Native rebuild volume, fitted-body pixel checks, STEP export and saving remain unchanged.

Author-run verification: Node 24, `PLAYWRIGHT_USE_EXISTING_BUILD=true`, Playwright Chromium, one worker, grep `datum Loft preflight|human mixed path drawing|human sketch drawing and dimensions`. Final **3/3 passed**, 20.8 s; `tmp/sketch-workflow-graph-repairs-final.log`. `git diff --check -- e2e/cad-workflow.spec.ts` is clean. No sleeps, timeout increases or broad error retries were added.

Separately, read-only rereview of the context-menu overlap repair found no further issue: direct pointer targeting requires one full candidate; multiple point/edge hits retain the chooser, while explicit keyboard identity and the existing selected-single-entity rule remain available. The mounted overlap case now enables the real context-menu factory and exercises both chosen-edge focus and Points-filter singleton Dimension. This is source/test review, not another independent execution claim.
