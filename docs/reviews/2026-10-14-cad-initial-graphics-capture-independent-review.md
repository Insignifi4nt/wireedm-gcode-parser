# Independent initial graphics-capture review

Date: 2026-10-14. Base checkpoint: `4a16f44774a2a49d9ebfd16a8938f733005b07e2`. Scope is the initial pre-loss capture in the graphics-loss E2E case; concurrent region/depth product work is outside this review. No product, E2E or root-maintained documentation was changed by this reviewer.

No actionable finding. The complete successful GitHub run `38623929179` reported 122 passing browser cases, one flaky graphics-loss case and the existing optional-folder skip. The independent log read at `tmp/cad-capture-complete-ci.log` lines 1726 onward confirms that the first attempt failed at `e2e/cad-workflow.spec.ts:179`, before context loss was requested. Its structured error was `STALE_VIEW` with the public instruction to capture the current view again. This was not the later deliberate unavailable-capture check, nor an observed blank-image or lost-document failure.

The patch applies the existing bounded `captureCadPreview` helper only to that initial call, then checks exact document ID, draft version, `cad-draft` provenance, `3d` source and document/build versions before the unchanged pixel check. The helper responds only to a structured rejected `STALE_VIEW`: it reads the public viewport using the same expected document version and attempts exactly one further capture. It neither adopts a changed accepted version nor loops, sleeps, changes the camera or swallows other failures. The helper's code and all 12 existing contract cases are unchanged from the base checkpoint.

An independent full-file comparison reversed only the new initial-capture block and restored the complete normalized spec to `4a16` byte-for-byte. Therefore all later behavior remains unchanged: real `WEBGL_lose_context` loss, explicit `CAPTURE_UNAVAILABLE`, accepted draft/document/feature preservation, automatic restoration, manual Retry restoration, native 1,000 mm³ body verification, and raster checks requiring more than 1,000 opaque samples and more than 100 fitted-body samples. There are no new retries, timeout changes, removed assertions or skips in the case or elsewhere in the spec. Automatic and manual recovery captures retain their original call sites.

Node 24.22.0 independent checks:

- Existing `src/__tests__/cadE2eCaptureClient.test.ts`: **12/12 pass**, including success without retry, one structured stale-view retry, failed guarded refresh, repeated stale-view rejection, no retry for unrelated CAD errors, exact transport-error propagation and malformed replies. Log: `tmp/cad-initial-capture-independent-client.log`.
- Strict existing E2E TypeScript: `node_modules/typescript/bin/tsc -p tmp/cad-e2e-kernel-tsconfig.json` passed. Log: `tmp/cad-initial-capture-independent-type.log`.
- Playwright `--list` with the unique graphics-loss title discovered exactly one test; no browser/server ran. Log: `tmp/cad-initial-capture-independent-discovery.log`.
- Scoped diff checking passed. No broad gate was repeated against the other owners' changing product source.

Frozen read SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `e2e/cad-workflow.spec.ts` | `DFC94D3D734EB8B51936754391023A7CA036F0A3A751ACDAC764D3916F076C30` |
| `e2e/cad-tool-helpers.ts` | `A8FA9A73A88DB3041E8CBDD12359E8D1ED5F52CEA67BB8717C44876958DE399F` |
| `src/__tests__/cadE2eCaptureClient.test.ts` | `8F8FE8508F916D6BF30C71E04D97FE37000F05DBAE23B2DB1DF193348B41F5AF` |

The successful full CI result belongs to the base checkpoint, while this small subsequent test change has the focused independent evidence above. The next actual browser gate remains parent-owned; this review does not declare the broader CAD work complete.
