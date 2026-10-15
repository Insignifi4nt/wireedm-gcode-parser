# Independent document-frame review

Reviewed the frozen document-camera repair against `8aef0c5026983b5e3a80bd4b68fc2780e3f34b14`. No actionable finding in this bounded slice.

The sole production change is `key={document.id}` on the solid `CadViewport`. A different document receives fresh camera and initial-fit state. The key remains stable for same-document edits, native rebuilds, selection/inspector changes, and provisional previews. Existing separate reference and first-solid fit flags remain intact.

Unmount already cancels scheduled rendering and pointer ownership, releases OrbitControls and listeners, disposes scene resources and the renderer, and removes the canvas. Released controls identify their own instance, so an old cleanup cannot unregister newly published controls. Disposed renderer captures reject; existing document/version, installed-reference, workflow, build and visual capture checks are unchanged. Controller replacement clears the preceding accepted build and guards new native publication; the new mounted regression explicitly exercises the intervening empty scene before the next document's mesh arrives.

The regressions meaningfully project actual uploaded mesh vertices through real Three cameras into unobscured pixels, reproduce small → large offset → small replacement, and verify current capture identity. The second case preserves an exact human-selected camera through accepted depth changes, inspector opening, actual editor preview and Cancel, with exact accepted session/history restoration. GPU rendering and raster capture are mocked; these cases do not claim real browser/GPU verification or execute native modeling.

Independent Node24.22.0 checks:

- `CadWorkbenchDocumentFrame.test.tsx`, `CadViewport.test.tsx`, and `cadWorkbenchViewport.test.ts`: **66/66 passed**, three full files (`tmp/cad-document-frame-independent-focused.log`). Existing lifecycle, old-control refusal, capture identity and same-size/real-resize cases remain green.
- `npx tsc -b --pretty false`: exit 0 (`tmp/cad-document-frame-independent-types.log`).
- Scoped diff review confirms only the one production key change. Viewport, controller, session and viewport boundary source are unchanged from the reviewed base.

Freeze `tmp/cad-document-frame-freeze.json` SHA-256 `B8017700CC5DF5395AF10F959A9FE45149542DA71A75386DAF6FC6F2CB1C2438`; all seven sealed entries match, including preserved red evidence. Production Workbench: `D0EEBBF0BEE8ACFFD9A82DA254BC9B391738DAC8035AD4795EA1B509772602E5`. New regression: `372DDD4FE32DD8066907E991EF24B5073A7F422BF57D422270C47925411B8EC4`.

No product/test changes, builds, servers, browser actions or native/cache work were performed in this review. Parent checkpoint owns actual browser confirmation and publication. Only this independent review is complete.
