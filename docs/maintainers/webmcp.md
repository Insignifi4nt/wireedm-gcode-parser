# WebMCP integration

## Shipped scope

The app registers 27 workbench tools and seven temporary package-authoring tools. `siteTools.ts` owns the small browser adapter, runtime TypeBox argument validation, bounded issue paths, 32 KiB result limit, registration lifetime and execution cancellation. No server, relay, polyfill or separate editor state owner is added for WebMCP.

Package calls use the existing UI actions and cancellable worker. A file must be selected in this page; no arbitrary URL/path retrieval is exposed. Worker termination stops conformance when aborted. Reports stay visible, and only a successful current build can request an archive download.

`EditorPage` publishes its current draft and narrow edit/history/capture callbacks. `projectEdits.ts` applies atomic typed batches through existing domain operations; the editor owns undo and rendering. `edm_describe_edits` returns a compact edit catalog or one exact accepted schema. Saved reads use the catalog-owned loader and return the shared `workbenchProjectVersion` hash for dependent queries. Revision listing uses the bounded summary reader.

`useWorkbenchActions` adapts DXF preview/commit, portable UPID import, opening, editing, saving, package preview/installation, setup activation and audited controller generation/download. The app controller owns the mutation lock and workbench state. Agent uploads use a browser file input, never arbitrary path/URL reads. Draft/workbench versions, package fingerprints and saved-content comparison prevent stale writes. Dirty/workflow guards also apply in the shared controller export path. Once storage commits, a late cancellation must not turn its receipt into a false cancellation result.

`edm_export_saved_upid` exports an explicitly versioned saved library record without opening it or using an unrelated editor draft. The shared UPID download operation owns the app mutation lock; the domain exporter checks the version against the same record it serializes, avoiding a check/read race. Current-draft UPID export also pins the loaded saved record. Downloads check cancellation and draft/workbench freshness before the browser request.

`edm_export_controller` composes shared audited generation and download. Generation checks cancellation and the agent's versions immediately before the first revision write. Once persistence starts, generation returns its outcome; successful artifacts remain readable/re-downloadable after a late cancellation or download failure. Failed posting includes `savedRevisionId` when persistence already succeeded. Do not retry generation just to retry a download.

`edm_capture_preview` uses the actual active editor SVG/canvas callback, then verifies the PNG signature, IHDR dimensions and 1 MiB/1600-pixel bounds. It checks the draft version again after rendering/hashing and revokes stale captures. It returns a local blob URL, dimensions, source view, exact draft identity and SHA-256; no base64 payload is placed in a JSON reply. The app retains a visible download link and delays URL cleanup to allow pending downloads. This is a preview artifact, not a desktop screenshot or a browser-permission capture.

`useSiteTools` also exposes bounded activity state to `AgentActivity`. Running actions remain visible while context calls complete; failures include tool codes/messages but never arguments or document contents. The unsupported-browser path keeps ordinary controls available.

This completes the core machining workflow from the original Astra plan. It deliberately leaves drawing construction, external G-code text editing, storage switching and deletion to the UI. There is no generic approval framework or second state store.

## Browser contract and evidence

- [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp): top-level JavaScript registration; built-in browser supports a subset, not declarative forms or iframe tools.
- [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api): `document.modelContext.registerTool`, registration AbortSignal and a separate execution AbortSignal.
- [Draft](https://webmachinelearning.github.io/webmcp/): evolving browser API, not a universal browser support guarantee.

Rechecked the browser guides and draft on 2026-09-21. They document ordinary JavaScript/JSON-serializable tool results, without a negotiated MCP image-content response contract. Therefore preview capture returns an honest downloadable PNG receipt instead of claiming inline model-image delivery. Agents may inspect its local URL using their browser's image capabilities; interoperability of such image inspection depends on that browser.

The added unit/integration coverage exercises exact saved-project versions, dirty-draft preservation, real package installation and audited controller export, cancellation before revision writes, stale drafts during generation/capture, committed receipts after late cancellation, download retry without another revision, malformed PNG bounds, edit-schema discovery and visible activity. Native browser evidence below predates these additions and does not by itself validate the new tools.

Verified 2026-09-17 in the Codex in-app browser, against a production build on the configured local preview port 3778. Calls used the browser's actual WebMCP capability rather than injected mocks. Both tool sets were discovered; package inspect/reuse/build reproduced archive SHA-256 `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`; an old input version was rejected. Workbench context, project and revision listing, saved/current project reads, exact geometry and invalid UPID validation executed successfully. A fixture translated by 1 mm through the UI appeared as an unsaved draft through WebMCP, while its old version was rejected. No production workbench was modified.

Unit tests cover schema rejection, output bounds, partial-registration cleanup, cancellation/worker termination, draft freshness, ordered geometry, package staging and successful-build download requirements. Existing UI tests exercise the unsupported-browser path. This is evidence for this in-app browser session, not a claim of standalone Chrome/Edge interoperability or origin-trial enrollment.

Full native workflow verified on 2026-09-17: import a two-circle millimeter DXF, configure finished contours, initial wire, compensation, leads, manual rethread during positioning and an after-contour stop; reject a stale edit and dirty export; review 21 execution events; save; upload/validate/install Robofil 2.6.0; generate/read/download a 337-character ASCII/CRLF `.iso`; request portable UPID export. Output SHA-256: `8e140b03f39c570c8abdc628eaf0dd0a3dbd628ebab9ce2c8ec3e56e7a0d2c51`. Output contains `N70 M00`, `N80 G0 X12.000 Y0.000`, `N90 M00`, `N100 G42`. No browser errors were logged. The test project/package live only in the localhost preview cache; production user data was untouched. Download evidence is the browser request, not an on-disk receipt.

The machining batch also undid/redid as one history step. After a reload, reopening the saved project and generating through the normal human export dialog produced the same controller program. Final checks: 147 test files / 1,380 tests, 26 focused regressions, production build, generated contract parity and release gate.
