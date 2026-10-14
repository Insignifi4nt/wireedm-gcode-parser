# Current-view capture and the two CI retries

Date: 2026-10-14. Scoped diagnosis of GitHub run `38619162496`, checkpoint `25b3994af33d3a7f011651a42603f8dd898af597`. No production edits, guard changes or local browser execution. The downloaded report and decoded JSON remain in ignored `tmp/cad-capture-ci-38619162496`.

## Actual evidence

The decoded report has 124 journeys: 120 expected, one unexpected, two flaky and one existing optional-folder skip. CAD has 32 workflow journeys (29 expected, one unexpected, two flaky) and two passing kernel journeys. Both flaky first attempts fail only when `callCadTool` demands success from the final `cad_capture_preview`: public `STALE_VIEW`, followed by a successful first full-test retry. The first-solid case takes 2.045s before failure; its retry takes 4.018s. Mixed-path takes 5.200s before failure and 8.096s on retry. These durations describe CI execution, not correctness or performance thresholds.

The actual failure screenshots show the fitted tall pin and selected semicylinder. Mixed-path's page snapshot and screenshot show 1,570.796 mm³, consistent with the independently asserted 500π. Both include the capture rejection toast. They establish rendered accepted bodies, not a valid returned PNG or the precise metadata field that changed. No first-failure trace or captured before/after state exists; the configured retry trace records the successful run. Do not claim a specific camera/hover/build event from these artifacts.

## Source boundary

`cadWorkbenchViewport.ts:capture` pins document/version, complete visual metadata, current build and installed references around actual renderer capture. Its identity deliberately excludes `busy` and `dirty`. `useCadController.ts:captureViewport` repeats version/workflow checks after asynchronous PNG SHA preparation and rejects a replaced control or changed view metadata, revoking its provisional blob. Existing capture ownership keeps an earlier successful artifact intact on rejection.

Renderer revision changes include camera framing, hover/selection layers and newly installed references or meshes. First solid Fit is intentional and later rebuilds retain the established camera. Automatic rebuild and explicit `cad_build` can both publish same-version result arrays; a late installation can change renderer revision even though the authored document is unchanged. Locking capture also cancels pointer/hover ownership, which can change displayed pixels. These are possible source paths, not a proved attribution of either CI failure.

No pure storage-lock false invalidation was identified: the full visual identities exclude busy, controls are stable, and the selected datum/profile and reference membership remain intentional visible context. Ignoring revision, build identity, highlights, version or workflow would weaken a valid artifact boundary. Same-version body completion or a successful Fit command does not promise that the subsequent asynchronous capture is immune to a view change.

## Proposed bounded client behavior

Provide an explicitly named E2E capture helper, separate from generic `callCadTool`. Make one public capture at the caller's fixed `expectedVersion`. Only an exact returned `ok:false/error.code:STALE_VIEW` permits reading `cad_get_viewport` again at that same version and making one fresh capture. Propagate every other tool error, thrown transport error, malformed reply, failed viewport refresh and a second stale capture. Do not adopt a new context version, sleep, refit, hide the failure, change the production API or broaden retries to mutations. The returned fresh PNG still passes the existing metadata, independent geometry and actual opaque/body-pixel checks.

Apply that helper only to the two proven capture call sites. A genuine stale document or open human workflow must still fail. Tests should verify normal single-call capture, exact capture/read/capture request order with unchanged version, a refresh that rejects a changed document, a second stale response, and non-view errors receiving no retry. No elapsed-time assertion is required.

## Focused existing checks

Node v24.22.0 capture-focused `cadWorkbenchViewport.test.ts` and `useCadController.test.tsx`: 18 tests pass; 116 unrelated cases are excluded by the name filter. This command runs no browser automation. It verifies current draft/build/reference/hover/version/workflow/cancellation and accepted-artifact guards. Log: `tmp/cad-capture-current-guard-audit.log`. The actual revised E2E must still be run through the coordinator's CI and CUA workflow after any helper repair; no E2E success is inferred from these unit checks.

## Source readback hashes before a client repair

| File | SHA-256 |
| --- | --- |
| `src/features/cad/useCadController.ts` | `0206aca90cde0820f5e5eaee0b70ec4168083a368b278003af7fb814d52101bb` |
| `src/features/cad/cadWorkbenchViewport.ts` | `c428fb0e6bedef00ad259c8063ef6e7ea2289a720b11fda06bdc93337e36497c` |
| `src/features/cad/CadViewport.tsx` | `d3abde1b86bc928b88036c6a9fbc03e00c07379f6cda791ef209684cefbbf8ae` |
| `e2e/cad-tool-helpers.ts` | `228165807ed0d5edb06a075e9277c29c7270c5710d7df5ad862d6f025006b618` |
| ignored decoded `summary.json` | `79a3a5b25b3bc43665b882d99946aef7d5ff5d01da3b4af3b162f3235bfce8dc` |

Overall CAD work remains active. Region selection and optional physical depth controls remain design work rather than existing capabilities.

## Authorized E2E client repair and freeze

The coordinator approved the bounded helper and exactly two observed call sites. `captureCadPreview` uses the normal public browser transport and existing success validation. It returns the normal first capture immediately. An exact rejected `STALE_VIEW` permits one guarded public viewport read followed by one fresh capture, with the same caller-supplied version throughout. There is no catch, timer, loop, Fit, context refresh, mutation or production change. Generic `callCadTool` retains its success semantics through a small shared private result parser; its behavior for every other tool is unchanged.

Both first-solid and mixed-path retain their independent native volume, full geometry/history/workflow and opaque/body PNG pixel checks. They now additionally assert returned document identity, accepted draft version, CAD draft provenance, 3D source and the current captured build version. The unrelated imported-path exact textbox repair is owned and reviewed separately; its scope is not attributed to this capture change.

The new contract suite substitutes only the unavailable browser `page.evaluate` transport. A plain one-request helper first produced three meaningful failures and nine passes: no public viewport refresh, no fresh capture and incorrect error propagation after a stale view. The repaired helper passes all 12 cases. They cover normal capture, exact public request order and pinned version, stale document on refresh, second-stale failure, five non-view errors without retry, thrown transport error, successful error-shaped data and malformed reply. No CAD geometry or production controller behavior is mocked for a success claim.

Node v24.22.0 checks: 12/12 helper cases, dedicated E2E TypeScript, application `tsc -b`, discovery of 34 journeys in two CAD specs, and scoped `git diff --check` pass. Logs are `tmp/cad-capture-client-contract-red.log`, `tmp/cad-capture-client-green.log`, `tmp/cad-capture-client-e2e-tsc.log`, `tmp/cad-capture-client-app-tsc.log` and `tmp/cad-capture-client-e2e-discovery.log`. Discovery does not execute the browser; no revised E2E pass is claimed before the actual next CI gate.

| Frozen owned file | SHA-256 |
| --- | --- |
| `e2e/cad-tool-helpers.ts` | `a8fa9a73a88db3041e8cbdd12359e8d1ed5f52cea67bb8717c44876958de399f` |
| `src/__tests__/cadE2eCaptureClient.test.ts` | `8f8fe8508f916d6bf30c71e04d97fe37000f05dbae23b2db1df193348b41f5af` |

The two precise workflow blocks are recorded separately in ignored `tmp/cad-capture-client-owned-regions.json`, since the full workflow file contains another owner's independent textbox corrections. The three production hashes above remain unchanged after this repair. Independent review and actual browser/CI confirmation are still required by the coordinator.
