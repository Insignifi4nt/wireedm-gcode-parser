# Independent review: CAD capture publication ownership

2026-10-15. Base `6e2113fa0151ef7d0b378ad3de7635664b2fab82`. Read-only review of the frozen idle-helper/resize repair and the actual public capture lifecycle. No product, existing test, capture guard, E2E helper, server or browser changes by this reviewer.

## First frozen snapshot

The five-file repair correctly separates parent-owned camera publication from helper-owned quantity/hover/gesture/visible-removal publication. Camera synchronization still recomputes exact projection and screen geometry; a real camera change still cancels an active gesture. The parent now publishes genuine resize once and leaves same-size observer notifications quiet. The new resize case exercises the real shared capture boundary and preserves its `STALE_VIEW` refusal. No geometry, scalar binding, source frame or cancellation predicate is weakened.

Independent Node 24.22.0 checks: **83/83** in `cadExtrudeDepthHandle`, `CadViewportDepth`, and `CadViewport` (2.39 s), log `tmp/cad-idle-capture-independent-focused.log`; scoped whitespace check passes. The owner separately reports 133/9, full app types, and the unchanged original first-solid browser test. These checks alone do not certify the complete public enabled-handle capture lifecycle.

| Initial reviewed source/test | SHA-256 |
| --- | --- |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `529DE22C86995FF76415B5CF22491CA2C0B90878E39F7F33780F793271723286` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `5C753795791C6911D8A67D3FD6EF011F462D204C5AFBE835227E3EDCDE8C9C24` |
| `src/features/cad/CadViewport.tsx` | `5149DB573820FB9F37F3A281D8AED33F226FEDFFC41C38E7E392BF01EE172FFE` |
| `src/features/cad/CadViewport.test.tsx` | `15A290AF5573706908961D8C1493E639A8C7AD88655A62783A82D67A1837B1CA` |
| `src/features/cad/CadViewportDepth.test.tsx` | `1759FE5CB851BBC8A8D485CA25651870950DBD6767E38418E83F5E8B73C7FFD0` |

## Proven adjacent public capture race

A complete mounted `useCadController` + `CadWorkbench` + `CadSession` + real Three camera/Orbit/helper + shared controls + public `cadSiteTools` reproduction finds a remaining race. The normal fast operation passes; holding the real PNG SHA-256 completion at its asynchronous boundary lets React publish the capture operation's own busy state. An enabled selected accepted Pad has `Length 10 mm`, exact whitespace-preserving named alias `' depth '`, workflow closed and ready accepted build. The original public tool then follows:

1. Before capture: visible handle, public revision **7**, selected Pad, exact accepted document/version.
2. `useCadController.run` publishes `storageBusy=true`; App's current contract forwards it to Workbench. Workbench removes `currentDepthControl` and disables preview. The handle disappears and its correct visible-removal publication advances revision **8**. Camera, source/frame, quantity and accepted version are unchanged.
3. Original PNG preparation resumes; the unmodified public capture guard rejects **`STALE_VIEW`** because the lock itself changed visible content.
4. Unlock restores the same visible `Length 10 mm` handle, revision **9**.

Ignored reproduction: `tmp/cad-idle-capture-busy-independent.test.tsx`, SHA-256 `29BFA7FE285786AA5DE6D6E690847F3C7ACAC0C63E8E344F818FF1E3FAA0F59A`; config `tmp/cad-idle-capture-independent.vitest.config.ts`, SHA-256 `DC0A851FB74EA08F502DF45960F8375F0C83A4AAED79F4640B5D9494CCE16D86`. Logs: `tmp/cad-idle-capture-busy-independent.log` (fast full-operation pass) and `tmp/cad-idle-capture-busy-independent-delayed.log` (actual delayed-operation red with full before/during/after public metadata). GPU/native build and PNG raster are stubbed; actual SHA-256 runs before its completion gate, while React/controller/tool/editor/geometry/camera and capture guards run normally. This is a scheduling regression reproduction, not a real raster benchmark.

Parent independently observes fast actual CUA enabled public captures succeed with unchanged revision, consistent with the race rather than disproving it. The earlier visible-idle mounted case calls rendered controls directly and therefore does not exercise the controller/App busy publication.

The causal finding is transferred to the same implementation owner before approval. Required invariant: acquiring an internal capture lock preserves the already accepted idle visual owner and exact displayed content, while retaining busy pointer/keyboard/navigation refusal, active-gesture cancellation, workflow/version/store guards and genuine camera/resize stale detection. No source edits by this reviewer; first freeze is **not finally approved** until that correction is independently reviewed.

Parent requested one adjacent check of the same lock effect. A separate ignored complete mounted fixture disables depth handles, leaves feature selection empty, and dispatches an actual pointermove projected through the real Three camera to the body interior. The actual hovered body material is `0xb2d2df`, revision **6**. With no subsequent user pointer/camera/source action, delayed public PNG preparation allows the busy lock to clear that static hover to `0xa3b0bf`, revision **7**, and the original public tool again rejects `STALE_VIEW`. Reproduction `tmp/cad-hover-capture-busy-independent.test.tsx`; log `tmp/cad-hover-capture-busy-independent.log`. This confirms input cancellation currently changes accepted visible hover, even without a depth control. It is transferred to the same owner during the pending correction; real user hover/camera changes must still invalidate capture. No broad display or guard rewrite is requested.

## Final seven-file repair: independent verdict

**Both proven findings are repaired; no remaining actionable defect found in the frozen scope.** Final manifest `tmp/cad-ci-idle-capture-source-freeze.json`, SHA-256 `DAFA58C958F7A479E88B58DABCACA7183B5D5D605032B6730AA534BF12BDC357`, retains the original red base and records the disjoint cache commit `a021bbcce199f3a737610977bb74a1bdf6c5e3f1` as combined head.

Workbench separates otherwise-current visual eligibility from storage input locking. It still checks the same accepted document/control version, selected feature, plane/area/dialog ownership and settings; source picking and editor preview/begin/set-quantity guards are unchanged. The helper's busy snapshot reuse requires an unchanged idle model and definition, with no gesture. Null/model/definition/control changes update normally; model/control loss still removes and publishes. Equivalent reconstructed capability records compare actual kind/reason on unlock, so the same visual no longer creates another publication just because a state object was reconstructed. Quantity, source frame, precision, math and binding semantics remain exact.

Viewport retains stationary feature/face hover only across a busy transition with exactly unchanged scene, source/version, mode, selection, placement and control identities. It discards queued hover work, refuses busy pointer/wheel/selection and depth input, disables Orbit, and cancels a pre-existing gesture with capture release and exact provisional restoration. Real ownership/source/picking changes still clear hover and render normally. Genuine camera/size changes and graphics loss retain the original strict boundary behavior. No tolerance, controller/capture guard, E2E retry/helper or assertion was weakened.

Independent Node **24.22.0** verification on this final freeze:

- **205/205 across 11 full affected suites**, 9.77 s; `tmp/cad-capture-ownership-independent-final-focused.log`. This includes actual public-tool/controller/Session/Workbench + real Three and delayed real WebCrypto cases for idle depth, active interruption, body hover and face hover; existing owner/source/graphics/pointer cancellation and one-Undo tests; and real resize/capture/token refusal.
- Both original ignored independent red fixtures rerun **unchanged** and pass **1/1 each**: `tmp/cad-idle-capture-busy-independent-final-green.log` and `tmp/cad-hover-capture-busy-independent-final-green.log`. Their original failure logs remain preserved. The initial depth fixture's SHA-256 is still `29BFA7FE285786AA5DE6D6E690847F3C7ACAC0C63E8E344F818FF1E3FAA0F59A`; hover fixture is `524D7C0D0DFFF733EAD15E4C6472F391C917D2E4148D928B411D858D16AF94EE`.
- Full app `npx tsc -b --pretty false` exits **0**, log `tmp/cad-capture-ownership-independent-final-type.log` is empty; diff whitespace check passes. Seven changed and six protected file hashes match the final manifest after verification. Historical 51-file manifest remains `D6883757F840F28349C15EB74762AE0D3E422C5D3E7452C3ACFDDE0F88D19709`.

The reviewer performed no production/existing-test edits, browser/server/build/commit operations. Mounted PNG/native/GPU stubs are described above; this verdict does not claim final real raster/E2E or all 15 CI journeys have run on these seven final files. Root owns fresh actual CUA, original-browser and complete CI gates. The separately reviewed geometry cache has its own record and hashes.

| Final reviewed source/test | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `624F3ADCCB83E93F096E33A154E39C8ACB5C372723E16FF0495FA3BCB889F062` |
| `src/features/cad/CadViewport.test.tsx` | `15A290AF5573706908961D8C1493E639A8C7AD88655A62783A82D67A1837B1CA` |
| `src/features/cad/CadViewportDepth.test.tsx` | `1759FE5CB851BBC8A8D485CA25651870950DBD6767E38418E83F5E8B73C7FFD0` |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `DDD6FFA14C287FEB75448452B88C49E34CD5CA5521F3265D42C0E64C2DE994A4` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `D882A3E7930914D8F22AE21BDAFE9F9D94DD1AC0E838B168B02AD3A15D128C9C` |
| `src/features/cad/CadWorkbench.tsx` | `BC8AC2B500EE53C02C9D88416CED0F98B29845B25E59D4254F27B4456C24FBEA` |
| `src/features/cad/CadCaptureDepthLock.test.tsx` | `D2985E54A1427E902DF904FF2AC2038367ACC72F617484229BD0F99E8BE23F0D` |
