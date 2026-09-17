# WebMCP integration

## Shipped scope

The app registers seven read-only workbench tools and seven temporary package-authoring tools. `siteTools.ts` owns the small browser adapter, runtime TypeBox argument validation, 32 KiB result limit, registration lifetime and execution cancellation. No server, relay, polyfill, dependency or separate editor state owner is added.

Package calls use the existing UI actions and cancellable worker. A file must be selected in this page; no arbitrary URL/path retrieval is exposed. Worker termination stops conformance when aborted. Reports stay visible, and only a successful current build can request an archive download.

`EditorPage` publishes a read snapshot when its draft/workflow changes. The workbench adapter reads that snapshot without controlling the editor. Saved reads use the existing catalog-owned loader and return a document hash for dependent queries. Revision listing uses the existing bounded summary reader.

The original Astra plan proposed four phases. This implementation covers its read-and-validation phase plus the subsequently added, storage-free authoring workbench. Reviewed editor writes, imports, package installation, saved-job creation, controller generation and deletion are not registered. Implement them only through shared application commands; this release does not build a generic approval/receipt framework in anticipation of them.

## Browser contract and evidence

- [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp): top-level JavaScript registration; built-in browser supports a subset, not declarative forms or iframe tools.
- [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api): `document.modelContext.registerTool`, registration AbortSignal and a separate execution AbortSignal.
- [Draft](https://webmachinelearning.github.io/webmcp/): evolving browser API, not a universal browser support guarantee.

Verified 2026-09-17 in the Codex in-app browser, against a production build on the configured local preview port 3778. Calls used the browser's actual WebMCP capability rather than injected mocks. Both tool sets were discovered; package inspect/reuse/build reproduced archive SHA-256 `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`; an old input version was rejected. Workbench context, project and revision listing, saved/current project reads, exact geometry and invalid UPID validation executed successfully. A fixture translated by 1 mm through the UI appeared as an unsaved draft through WebMCP, while its old version was rejected. No production workbench was modified.

Unit tests cover schema rejection, output bounds, partial-registration cleanup, cancellation/worker termination, draft freshness, ordered geometry, package staging and successful-build download requirements. Existing UI tests exercise the unsupported-browser path. This is evidence for this in-app browser session, not a claim of standalone Chrome/Edge interoperability or origin-trial enrollment.
