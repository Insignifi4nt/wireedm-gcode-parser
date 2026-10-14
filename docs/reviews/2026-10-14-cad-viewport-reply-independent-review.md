# Independent viewport capacity and receipt review

Date: 2026-10-14. Diff baseline: `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. Reviewed the frozen viewport/reference/analytic-closure/tool-reply slice documented in `2026-10-14-cad-viewport-capacity-reply-audit.md`, plus its real controller/control/rendering consumers. No production or test source was changed by this reviewer; only this private review record and an ignored observation harness were written. Section/STEP optimization source remained frozen separately.

## Result

No actionable finding. Internal geometry and capture metadata remain complete. Public response summaries retain complete ID entries with explicit counts and versioned/token-pinned access to the remaining entries. Exact geometry and closure mathematics are preserved. This is a scoped independent review and focused correctness check, not a native rasterization benchmark, full application gate or overall completion claim.

## Geometry and mathematical behavior

`cadReferenceFeatureIds` retains every sorted unique real feature ID and still separates principal planes from document IDs. Removing its old count rejection does not change identity/selection semantics. The actual Workbench regression opens all 257 accepted datum rows, selects the final datum/reference plane and retains the exact accepted document, version and history.

Reference preparation now keeps every authored line and the existing three-degree maximum arc/circle sampling increment, irrespective of other reference outlines. Exact authored start/end points remain the first/last arc samples. Analytic source resolution, signed principal/datum placement, exact bounds used for Fit, suppression and source diagnostics are unchanged. The compatibility Curve wrapper retains its existing source-type filtering. This is display sampling; exact analytic and native geometry remain separate and are not simplified or rewritten.

The closure tolerance change replaces argument flattening/spreading with a running maximum. For the same pure numeric points, it evaluates the same `max(1, |x|, |y|, …)`, eight-epsilon scale and `1e-12` floor. NaN/Infinity behavior and signed-zero treatment are unchanged. Independent replay compared the old bounded expression and current implementation across 104 cases, including empty points, signed zero, NaN/Infinity and varying finite scales; every result matched with `Object.is`. Real accepted 32,769-line Curve cases retain all edges, length and endpoints at both origin and far coordinates; closed Curves still reject under the original diagnostic.

## Receipt budget and token contract

The formatter checks the actual serialized `{ ok: true, data: … }` envelope. Capture supplies its full outer receipt projection, so file/hash/URL/download metadata is included in the same 32 KiB budget. The empty summarized envelope reserves ID-list capacity; complete serialized IDs and comma costs are then counted. Original omission counts can only shrink as entries are included, and the explicit two-byte reserve covers the two booleans changing from `true` to `false`. Small complete collections stay complete. Large summaries retain whole prefix entries, truthful total/omission counts and no shortened identifiers. Unknown reference installation remains unknown rather than a fabricated zero-count collection.

Only returned tool metadata is summarized. Renderer IDs, current complete state, selected topology and the controller's captured `previewArtifact.viewState` remain complete. The native/import/source pathways are not changed. No public receipt budget becomes a geometry or storage capacity policy.

An independent pure formatter sweep used 96-character feature IDs, up to 20,000 body/reference IDs in each collection, optional 64-pick topology metadata validated by the real pick schema, and read/capture receipts including a download-failure recovery receipt. **256 complete envelope cases** passed with exact prefix/count relationships and no input mutation; the largest serialized envelope was **32,766 bytes**. Another **128 unavailable-reference variants** retained missing reference metadata. This ignored diagnostic harness uses typed synthetic metadata to stress the formatter; it is not an actual WebGL/native scene or capture.

The `cad_get_viewport` schema is a strict union: either the existing version-only summary, or the collection arm requiring both collection and token with optional bounded offset/limit. Partial pairs, offset-only extras and unsupported collections reject before a shared operation runs. CAD offsets retain the existing safe-integer range rather than reintroducing a 100,000-row policy. Shared `page` keeps full rows and monotonic next offsets; small row-size limits leave ample envelope room.

The token is based on the complete observed JSON metadata, not its truncated summary. One current identity/token is kept in a WeakMap per actual session, so reconstructing tool descriptors does not reset it. Changes to observed selection, installed reference IDs, build identity, camera/navigation or other metadata invalidate old pages. A changed document version rejects first through the existing controller/session `STALE_STATE` guard. Metadata changes reject `STALE_VIEW`. The documented limitation about an unobserved epoch returning identical observed JSON is accurate; this does not bypass actual capture/source guards.

Full metadata serialization remains proportional to complete ID collections on each observation/page. The current WeakMap retains one complete identity string per session, not a history of scenes. This review establishes correctness and response budgeting, not constant-time pagination or unlimited renderer memory; a separately measured optimization would need to preserve the complete-metadata identity contract.

## Capture publication and ownership

The tool awaits the shared controller's capture and formats its returned metadata afterward. PNG validation/hash preparation, exact document/version/workflow checks, current control-instance comparison, full visual identity and reference-installation checks remain authoritative. Only after these checks does the controller publish the owned blob artifact and optional download request. The successful public receipt now fits without discarding that published complete artifact or returning a contradictory `OUTPUT_TOO_LARGE` failure.

The controller acquires its busy lock before invoking capture, while the Workbench capture snapshots readable bindings synchronously before React publishes that lock to the rendered props. Existing visual comparisons deliberately ignore the caller's busy transition. Reviewing this real consumer seam found no token or ownership bypass; the complete capture state is formatted independently from the current summary, and later changed metadata still rejects paging. Failure/cancellation before publication retains the existing URL cleanup and stale-view checks. The capture tool remains marked as a mutation so the shared envelope preserves a committed receipt rather than replacing it with late cancellation.

## Independent verification and frozen pins

All executions used the installed official Node **v24.22.0** binary. Focused results:

- Five complete source/control/schema suites: **60 tests passed** (`cadViewportReferences`, `cadCurveRendering`, `cadAnalyticSegments.capacity`, `cadWorkbenchViewport`, `cadSiteTools`).
- Controller capture/reference-visibility/receipt/token cases: **7 tests passed**, unrelated cases filtered.
- Actual Workbench last-of-257 datum selection: **1 test passed**, unrelated cases filtered.
- The independent formatter/closure harness described above passed. It is `tmp/cad-viewport-reply-independent.ts`, executed through the installed tsx CLI under Node 24; `tmp/` is ignored.

Total focused Vitest verification: **68 tests in seven files**. No test timeout, assertion, input guard, production source, server, browser or package setting was changed. The scoped diff whitespace check passed. Source hashes were checked before and after verification and match the owner's frozen record:

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadAnalyticSegments.ts` | `8CF3E8CAD9852FE7AB9E72214614248BD0CE981B5A3D5B9A93D6542C97DAB2DF` |
| `src/features/cad/cadViewportReferences.ts` | `FA20030F2CC02C00CE094E892089AB8264CFAE2615C21AB1478DCC42A3657A69` |
| `src/features/cad/cadCurveRendering.ts` | `BB1D03551EC16491322F395ABB9E63F1FEE8FD89E7398A06C6BE5E42047DA061` |
| `src/features/cad/cadViewportToolReplies.ts` | `DDDA5BC93F54EB84D85AFD36AE7E08AB707EE4A7070C42770FC70E180EC36E74` |
| `src/features/cad/cadSiteTools.ts` | `6CCEE0A9E743C2755C0BB0648F038AB000D3BE93450D19BB8923D114469F8EF4` |
| `src/features/cad/useCadController.test.tsx` | `103BE1C1330A53AF2BA761A34681A793A673CD64C2E9738D8FA9ECB00AEE4CF3` |
| `src/features/cad/CadWorkbench.test.tsx` | `5E3D4144A461096853F32FE8C577D3ECEFEB96936CA3973F550CA47FD45CBB63` |
| `src/features/cad/cadViewportReferences.test.ts` | `394269C14E5C84F3D267B5ACCFE33E67F556E4845E96C0E3B288E0A062F92EDE` |
| `src/features/cad/cadCurveRendering.test.ts` | `A810D5F0ADFE5FB19D1DDDEBD44C25A38A3B5F85DC1CB0D8B5C7F32F36B6991A` |
| `src/domain/cad/cadAnalyticSegments.capacity.test.ts` | `DD32C5E17F893A0989FA574C08A646A92209B5B8FD29D3F61BB326016FBCCA7A` |
| `src/features/cad/cadWorkbenchViewport.test.ts` | `9EA1B4E2168F13FAB3A81B745148BA8FACA08AED91BDF09987301657085C55BD` |
| `src/features/cad/cadSiteTools.test.ts` | `47C99A4B46ADCD965998947482D7DF20367C5F285FA4406545182183E1C8254C` |
