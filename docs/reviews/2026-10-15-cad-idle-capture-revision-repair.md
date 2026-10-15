# CI regression: idle CAD capture revisions

2026-10-15; reviewed/fixed against `6e2113fa0151ef7d0b378ad3de7635664b2fab82`. The complete GitHub run `38641761933` passed 4,046 unit cases, build and conformance, but 15 browser journeys consistently failed `STALE_VIEW` across retries. Original guards and browser assertions correctly exposed a renderer publication bug introduced with the depth helper.

## Reproduction and cause

Two test-first reds establish the inactive path (`tmp/cad-ci-revision-red.log`): the actual Three helper requests a render on camera changes with no control and no visual; a mounted ordinary viewport using real OrbitControls advances public revision **4 → 5** during capture, with all other public metadata identical. The same unchanged original Chromium journey, **the first solid fits after reference-only viewing while later rebuilds preserve the camera**, reproduces `cad_capture_preview` → `STALE_VIEW` at `cad-workflow.spec.ts:1210` before any production repair (`tmp/cad-ci-invisible-depth-playwright-red.log`).

The helper compared exact camera matrix/projection keys and always published a renderer revision on a key difference. Capture's existing Orbit update can normalize the matrix by a tiny amount without an ordinary view event. Because render/capture also synchronize the helper, this created a new publication from inside every capture, including when the helper was unowned. The strict capture boundary then correctly rejected the before/after identity mismatch.

The first null-only repair fixed that original browser case. A further mounted actual Editor/Session + Three regression showed the enabled, visible, idle control has the same **4 → 5** defect (`tmp/cad-ci-visible-depth-probe.log`, followed by `tmp/cad-ci-visible-depth-publication-red.log`). Its accepted document, exact quantity/alias and gesture state remain unchanged. The issue is camera publication ownership, not an arbitrary pixel tolerance or test retry budget.

## Narrow repair

The viewport owns camera/view revisions and rendering. The helper still synchronizes exact projection, screen target, capability and geometry on every real camera change, but camera-only synchronization does not emit another helper publication from render/capture. Control/state, quantity, hover, gesture and visible removal still request rendering/revision. Null → null updates have no helper visual to publish. Visible → null removal is explicitly checked to publish exactly once; subsequent empty camera updates remain quiet. Real camera changes still cancel owned depth gestures using the existing exact view key. No numerical predicate, hit target, scalar value, source geometry or camera algorithm changed.

Removing that accidental camera publication also revealed a real parent ownership gap: viewport size changes updated projection and pixels but did not explicitly advance revision. A new actual ResizeObserver/real Three test failed **expected 4, received 3** on width 800 → 900 (`tmp/cad-ci-resize-revision-red.log`). `CadViewport` now caches actual width/height, updates projection/resources and advances revision once for a genuine dimension change. Same-size notifications do not reallocate/reset those resources or advance revision; retained context restoration still requests the required redraw. The real shared capture boundary rejects a resize occurring during raster capture with `STALE_VIEW`, and public viewport metadata tokens change for the actual resize. The accepted session remains exact.

## Verification

Node **24.22.0**:

- Five new focused revision/ownership cases pass (`tmp/cad-ci-revision-combined-green.log`): inactive camera sync, repeated ordinary captures, visible idle captures, camera-only sync versus owned hover/quantity, and real resize/capture/token identity.
- Nine full affected files pass **133/133**, 2.69 s: `cadExtrudeDepthHandle`, `CadViewportDepth`, `CadExtrudeDepthHandleEditor`, `CadExtrudeDepthEditor`, `CadSourceReferencePicking`, `CadViewport`, `CadRegionPicking`, `cadRegionSelectionOverlay`, `cadWorkbenchViewport`. Log `tmp/cad-ci-revision-final-focused.log`. These retain loss/cancellation/one-Undo, precise quantities, source/area picking, graphics recovery and unchanged stale-capture guards.
- Full app TypeScript passes (`tmp/cad-ci-revision-final-type.log`, empty, exit 0). Scoped diff whitespace check passes.
- The **same untouched original Chromium journey** passes **1/1** on the final helper/resize source, 7.0 s (`tmp/cad-ci-invisible-depth-playwright-final-green.log`). It also passed after the initial null-only fix; the final run validates the complete owned repair. Playwright's unchanged configured server owns strict port 3107 and its isolated `tmp/playwright-dist` build. No manual application server/build or user-tab interaction occurred; 3107 has no listener after exit.

Capture boundary/controller/tool handlers, E2E spec, capture helper, retries and Playwright configuration are byte-for-byte unchanged from the Git base. The GPU renderer and PNG raster are observed/stubbed in mounted DOM tests; camera/Orbit/helper/editor/session and the resize test's real shared capture guard run normally. Real raster/native evidence comes from the original Chromium journey. Parent owns the additional original browser journeys and complete new CI gate; this record does not claim all 15 failures or the whole CAD goal are independently closed.

## Initial five-file repair freeze

Root independent verification: 51 selected existing cases pass across controller, viewport boundary and bounded E2E capture client (98 unrelated cases filtered out, not removed). Three unchanged original Chromium journeys pass on first attempt: graphics loss/recovery, small far-origin analytic reference arcs and small far-origin native solid face/edge picking (11.4 s). Logs: `tmp/cad-ci-capture-repair-independent-guards.log`, `tmp/cad-ci-capture-repair-independent-e2e.log`. TypeScript/Vite, all 92 documentation checks and pinned native corresponding-source distribution pass (`tmp/cad-ci-capture-repair-production-build.log`). The actual fresh production bundle `main-CpfTv-7o.js` returns three identical real PNG hashes at unchanged public viewport revision; the saved CAD library is unchanged. Complete new-head CI remains required.

`tmp/cad-ci-idle-capture-source-freeze.json` lists all five changed owner files plus byte-verified protected files. Historical `tmp/cad-region-depth-candidate-source-freeze.json` was **not changed**; its hash remains `D6883757F840F28349C15EB74762AE0D3E422C5D3E7452C3ACFDDE0F88D19709`.

| Changed file | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `5149DB573820FB9F37F3A281D8AED33F226FEDFFC41C38E7E392BF01EE172FFE` |
| `src/features/cad/CadViewport.test.tsx` | `15A290AF5573706908961D8C1493E639A8C7AD88655A62783A82D67A1837B1CA` |
| `src/features/cad/CadViewportDepth.test.tsx` | `1759FE5CB851BBC8A8D485CA25651870950DBD6767E38418E83F5E8B73C7FFD0` |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `529DE22C86995FF76415B5CF22491CA2C0B90878E39F7F33780F793271723286` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `5C753795791C6911D8A67D3FD6EF011F462D204C5AFBE835227E3EDCDE8C9C24` |

Protected current hashes: shared capture boundary `C428FB0E6BEDEF00AD259C8063EF6E7EA2289A720B11FDA06BDC93337E36497C`; controller `78E6C21665BDC859E6641D6D6AC0FD0AC468DAD0B360ADAD6B913D54E000D83E`; CAD tools `CFE1BD042A09444DE00DB66DF9C33830EE313C680F68FBFF33E13F7022C11CEB`; E2E spec `DFC94D3D734EB8B51936754391023A7CA036F0A3A751ACDAC764D3916F076C30`; E2E capture helper `A8FA9A73A88DB3041E8CBDD12359E8D1ED5F52CEA67BB8717C44876958DE399F`; Playwright config `02D5B5E93072ABC03D5A80A291B1EDD1000452F8DA2FE672DB3BD148F86F7DBD`.

## Delayed public capture: separate visual ownership from busy input

Independent review established a second real race after the first five-file repair. In an actual mounted Session/controller/Workbench/Three/shared-tool workflow, holding completion of real WebCrypto PNG hashing lets React publish `run()`'s storage lock before the capture receipt is checked. The enabled idle handle disappeared and public revision changed **7 → 8**, then **9** on unlock. The strict public call correctly returned `STALE_VIEW`. The tracked promoted red is `tmp/cad-ci-capture-depth-lock-red.log`; the independently retained initial probe is `tmp/cad-idle-capture-busy-independent-delayed.log`. Fast actual captures passed, so those alone did not close this async boundary.

The same independent delayed-hash probe, with depth disabled and no selected feature, proved ordinary stationary body hover was also cleared by the busy lock: material `0xb2d2df → 0xa3b0bf`, public revision **6 → 7**, `STALE_VIEW` (`tmp/cad-hover-capture-busy-independent.log`). No pointer, camera, accepted document or history changed. Both failures concern temporary input-lock publication, rather than source/model acceptance or geometry.

`CadWorkbench` now qualifies the render owner independently of storage input locking, retaining an otherwise current idle depth control. The original editor `previewEnabled`, begin/set-quantity checks and shared `BUSY` operation guards are unchanged. `CadViewport` receives the explicit `busyInputLocked` flag, blocks pointer/wheel input, cancels begun gestures and discards queued hover work. Stationary feature/topology hover is retained only across a busy transition with the same scene, selection, source/mode, placement and control identities. Ordinary ownership/content changes still cancel and clear; true camera and size changes retain their existing publication/strict capture rejection.

The depth helper preserves only an unchanged idle model/definition snapshot during input locking. A different control, changed model/definition or null state updates normally. Equivalent capability records compare kind/reason on unlock, avoiding a new visual publication solely for an identical reconstructed state. Busy hover/begin/move are refused; a pre-existing gesture is cancelled, restores its exact provisional source, and cannot resume from a late pointer. The accepted document, full quantities and expressions remain untouched.

The new `CadCaptureDepthLock.test.tsx` contains four meaningful mounted workflows: delayed public capture with idle depth and refused physical mutation/agent edit; newly busy active drag interruption; and delayed public capture with real body and face hover while subsequent hover/navigation input is blocked. Only native build, GPU renderer and valid PNG raster are stubbed. Session, controller, editor control, shared tool execution, real Three ray/camera/Orbit and actual WebCrypto hashing run normally. The gate holds hash completion rather than inserting a sleep or extending a timeout. Camera equality is measured after capture's existing Orbit normalization, then required exactly during busy input; public viewport identity is required exactly before/during/after capture except the truthful busy flag.

Node **24.22.0** final focused gate: **205/205 across 11 files**, 9.61 s (`tmp/cad-ci-capture-input-lock-final-focused.log`). It includes all previous nine affected suites, full Workbench integration and the new four public-lock workflows. Full app TypeScript and scoped diff check pass (`tmp/cad-ci-capture-input-lock-final-type.log`, empty, exit 0). The helper's additional lock regression requires unchanged idle visuals/no publication, blocks input, then proves real model and owner loss still update. Capture guards/controller/tools/E2Es/retries/config remain byte-for-byte unchanged from the original red base.

## Final seven-file capture repair freeze

Original red base remains `6e2113fa0151ef7d0b378ad3de7635664b2fab82`; current combined head is the separately reviewed cache commit `a021bbcce199f3a737610977bb74a1bdf6c5e3f1`. That disjoint cache commit does not replace the capture red evidence. The final separate `tmp/cad-ci-idle-capture-source-freeze.json` records these seven files and all protected hashes. The historical 51-file manifest remains unchanged at `D6883757F840F28349C15EB74762AE0D3E422C5D3E7452C3ACFDDE0F88D19709`.

| Changed file | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `624F3ADCCB83E93F096E33A154E39C8ACB5C372723E16FF0495FA3BCB889F062` |
| `src/features/cad/CadViewport.test.tsx` | `15A290AF5573706908961D8C1493E639A8C7AD88655A62783A82D67A1837B1CA` |
| `src/features/cad/CadViewportDepth.test.tsx` | `1759FE5CB851BBC8A8D485CA25651870950DBD6767E38418E83F5E8B73C7FFD0` |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `DDD6FFA14C287FEB75448452B88C49E34CD5CA5521F3265D42C0E64C2DE994A4` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `D882A3E7930914D8F22AE21BDAFE9F9D94DD1AC0E838B168B02AD3A15D128C9C` |
| `src/features/cad/CadWorkbench.tsx` | `BC8AC2B500EE53C02C9D88416CED0F98B29845B25E59D4254F27B4456C24FBEA` |
| `src/features/cad/CadCaptureDepthLock.test.tsx` | `D2985E54A1427E902DF904FF2AC2038367ACC72F617484229BD0F99E8BE23F0D` |

No additional build, server, browser, commit or push was performed for this final busy-lock extension. Parent owns fresh combined native/browser proof and the complete new-head CI gate. The earlier Chromium and actual bundle checks above describe the initial five-file repair, not an unperformed final seven-file proof.

Root final combined verification: all 384 files / 4,071 unit cases pass; the same four unchanged original Chromium journeys pass on the final seven-file capture plus reviewed cache source (11.5 s, first attempt). Final production build/docs/native sources pass. Actual `main-C1gEeMx5.js` preserves empty-workspace and enabled-depth public captures, complete accepted source, exact physical drag/Cancel and saved metadata; test preference is restored. Full evidence and honest pending fresh-head CI are recorded in `2026-10-15-cad-region-depth-browser-checkpoint.md`. The seven source/test and six protected hashes remain equal to the final independent review freeze.
