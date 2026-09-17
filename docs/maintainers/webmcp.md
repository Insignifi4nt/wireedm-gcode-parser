# WebMCP integration

## Shipped scope

The app registers 23 workbench tools and seven temporary package-authoring tools. `siteTools.ts` owns the small browser adapter, runtime TypeBox argument validation, 32 KiB result limit, registration lifetime and execution cancellation. No server, relay, polyfill, dependency or separate editor state owner is added.

Package calls use the existing UI actions and cancellable worker. A file must be selected in this page; no arbitrary URL/path retrieval is exposed. Worker termination stops conformance when aborted. Reports stay visible, and only a successful current build can request an archive download.

`EditorPage` publishes its current draft and two narrow edit/history callbacks. `projectEdits.ts` applies atomic typed batches through existing domain operations; the editor owns undo and rendering. Saved reads use the catalog-owned loader and return a document hash for dependent queries. Revision listing uses the bounded summary reader.

`useWorkbenchActions` adapts DXF preview/commit, portable UPID import, opening, editing, saving, package preview/installation, setup activation and audited controller generation/download. The app controller owns the mutation lock and workbench state. Agent uploads use a browser file input, never arbitrary path/URL reads. Draft/workbench versions, package fingerprints and saved-content comparison prevent stale writes. Dirty/workflow guards also apply in the shared controller export path. Once storage commits, a late cancellation must not turn its receipt into a false cancellation result.

This completes the core machining workflow from the original Astra plan. It deliberately leaves drawing construction, external G-code text editing, storage switching and deletion to the UI. There is no generic approval framework or second state store.

## Browser contract and evidence

- [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp): top-level JavaScript registration; built-in browser supports a subset, not declarative forms or iframe tools.
- [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api): `document.modelContext.registerTool`, registration AbortSignal and a separate execution AbortSignal.
- [Draft](https://webmachinelearning.github.io/webmcp/): evolving browser API, not a universal browser support guarantee.

Verified 2026-09-17 in the Codex in-app browser, against a production build on the configured local preview port 3778. Calls used the browser's actual WebMCP capability rather than injected mocks. Both tool sets were discovered; package inspect/reuse/build reproduced archive SHA-256 `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`; an old input version was rejected. Workbench context, project and revision listing, saved/current project reads, exact geometry and invalid UPID validation executed successfully. A fixture translated by 1 mm through the UI appeared as an unsaved draft through WebMCP, while its old version was rejected. No production workbench was modified.

Unit tests cover schema rejection, output bounds, partial-registration cleanup, cancellation/worker termination, draft freshness, ordered geometry, package staging and successful-build download requirements. Existing UI tests exercise the unsupported-browser path. This is evidence for this in-app browser session, not a claim of standalone Chrome/Edge interoperability or origin-trial enrollment.

Full native workflow verified on 2026-09-17: import a two-circle millimeter DXF, configure finished contours, initial wire, compensation, leads, manual rethread during positioning and an after-contour stop; reject a stale edit and dirty export; review 21 execution events; save; upload/validate/install Robofil 2.6.0; generate/read/download a 337-character ASCII/CRLF `.iso`; request portable UPID export. Output SHA-256: `8e140b03f39c570c8abdc628eaf0dd0a3dbd628ebab9ce2c8ec3e56e7a0d2c51`. Output contains `N70 M00`, `N80 G0 X12.000 Y0.000`, `N90 M00`, `N100 G42`. No browser errors were logged. The test project/package live only in the localhost preview cache; production user data was untouched. Download evidence is the browser request, not an on-disk receipt.

The machining batch also undid/redid as one history step. After a reload, reopening the saved project and generating through the normal human export dialog produced the same controller program. Final checks: 147 test files / 1,380 tests, 26 focused regressions, production build, generated contract parity and release gate.
