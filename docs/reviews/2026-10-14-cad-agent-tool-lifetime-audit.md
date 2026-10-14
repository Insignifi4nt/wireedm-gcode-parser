# CAD agent-tool lifetime audit

Read-only audit on 2026-10-14 of the fixed production QA checkpoint. No product code, browser state, server or tool registration was changed by this audit.

## Finding

No app-owned per-render registration churn was found. The app already uses stable mounted registration with a current-handler indirection. The observed gateway message, `registration is stale`, is consistent with the browser's documented discovered-handle lifetime. Refreshing tool discovery is the supported recovery at that boundary. The evidence does not justify adding automatic app re-registration, an extra tool service or a second CAD state owner.

The coordinator's actual production journey discovered the WebMCP family, constructed a linked Pad and Move through the shared API, then changed the displayed Pad Length through the human editor. After native preview completed, an older discovered `cad_get_context` object was rejected by the tool gateway before an application JSON envelope was returned. Fresh discovery restored calls without navigation, reload, a CAD error or loss of the pending document version. The browser also briefly timed out while checking an already visible Apply control. These are coordinator-supplied observations, not a local reproduction or evidence that the application's native tools were unregistered.

The public CUA documentation supplied by the coordinator explicitly permits discovered handles to expire between agent turns while the page stays unchanged. It requires fresh discovery before the first call in each turn and after navigation, available-tool changes or stale/invalid handle errors. That object lifetime is separate from the page's `document.modelContext` registration lifetime.

## Application source evidence

- [App](../../src/App.tsx#L49) creates descriptor arrays during each render and supplies `cadSiteTools(() => cadRef.current)`. Descriptor allocation alone does not call native registration. The App-level hook survives ordinary CAD document, preview, viewport and editor changes; the CAD workspace boundary is below that owner.
- [useSiteTools](../../src/features/webmcp/siteTools.ts#L128) registers in a mount-only effect with an empty dependency list. Its layout effect updates `latest.current`. Every originally registered execute wrapper resolves the same tool name in that current list, then invokes the current handler. Descriptor changes do not unregister and re-register tools on every render.
- [registerSiteTools](../../src/features/webmcp/siteTools.ts#L95) owns one registration AbortController for the mounted tool family. Its registration signals are aborted on cleanup or partial registration failure. Each execution has a separate controller; cleanup aborts active calls deliberately. Normal native preview and scalar edits do not call registration disposal.
- [cadSiteTools](../../src/features/cad/cadSiteTools.ts#L59) obtains the current controller when executing. `cad_get_context` reads the current Session snapshot and controller build state. It does not return a frozen discovery-time document. The tool definitions are stable in name, description and schema through ordinary CAD edits.
- [useCadController](../../src/features/cad/useCadController.ts#L144) retains shared busy, storage, workflow and expected-version checks. Asynchronous operations capture their store/document identity and recheck before publishing or writing. Stable registration cannot substitute for these guards, and rediscovery must not weaken or replace them.

Actual App unmount/navigation ends the registration lifetime. Development StrictMode can dispose an initial registration and mount its replacement; that is covered separately and does not imply continuous production registration churn. A source or schema change during development can also require a genuinely new page/registration. The QA observation did not establish either event.

## Browser contract

OpenAI documents page-bound tools and notes that closing/navigating can make them unavailable. Its browser checks each invocation against the originating page and registration, and supports a subset of WebMCP. Those rules do not promise perpetual validity for a previously discovered browser-agent handle. [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp)

Chrome documents registration removal through its registration AbortSignal and a distinct execution cancellation signal. The `toolchange` event announces changes to available tools. [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

The WebMCP draft distinguishes an in-page caller's `getTools`/`executeTool` API from the browser agent's internal discovery mechanism. Its execute algorithm validates the active document, expected origin, current tool name and exposure. It does not define CUA's discovered-handle cache or this gateway error wording. A fresh in-page dictionary and a browser-agent tool object therefore cannot be assumed to have identical lifetime semantics. [WebMCP draft](https://webmachinelearning.github.io/webmcp/)

## Verification and next seam

Existing [AgentActivity coverage](../../src/features/webmcp/AgentActivity.test.tsx#L110) renders fresh descriptors, executes stored registered callbacks, changes the context version, re-renders and receives version 2 through the existing registration path. Its activity updates themselves trigger more renders. Separate cases cover StrictMode replacement, pending sequential registrations, failure/unmount and concurrent calls. [siteTools tests](../../src/features/webmcp/siteTools.test.ts#L98) cover registration-signal disposal, execution cancellation, partial registration failure, schema validation and mutation receipts after late cancellation. CAD tool/controller tests cover their shared version/workflow/store boundary.

The focused run passed **121 tests in four files**:

`npm test -- --run --project browser src/features/webmcp/siteTools.test.ts src/features/webmcp/AgentActivity.test.tsx src/features/cad/cadSiteTools.test.ts src/features/cad/useCadController.test.tsx`

This audit did not add a test that models browser-gateway identity using an invented mock. Such a test would not reproduce the reported transport error. The existing hook test verifies fresh callback state but does not explicitly assert a constant native registration count or unchanged lifetime signals across the complete real CAD editing journey. If stronger app regression coverage is needed, the smallest useful addition is an App/CAD integration case that records the public `registerTool` boundary once, drives Session changes plus human candidate waiting/ready/blocked/cancel states, and verifies that the same registered context callback reports current versions while the original registration signals stay live. After a human workflow opens, a stored mutation callback must still reject it; after acceptance, the same callback must reject an old expectedVersion. Store replacement and unmount must retain their cancellation/stale-write checks. No production instrumentation is needed for that seam.

For further transport diagnosis, use fresh handles according to the public CUA contract and correlate a failed gateway call with the existing visible Agent activity. A call rejected before the registered wrapper should produce no new application activity entry. Registration count/signal churn at the public application boundary would be evidence for an app fix; no such churn is established here. Do not auto-retry mutations after an ambiguous transport result. Read context and reuse committed receipts before deciding whether a write is still needed.

Descriptor memoization could later reduce ordinary JavaScript allocation, provided all handlers still resolve current controller/state and dynamic tool catalogs are handled deliberately. It is an allocation optimization, not a repair for the observed stale browser handle. No product change is recommended from this audit.
