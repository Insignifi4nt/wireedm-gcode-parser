# Publication review — 2026-09-22

Scope: release 0.0.687 on `feat/upid-simulation-workbench`, including the final direct-input, review and documentation changes. Release baseline: `87118ca816bdad202d8ff87586fe07cc0e28d3d9` (`origin/main`, app 0.0.686). The prior implementation checkpoint was `f912af8`. This report records local preparation and review; the user subsequently authorized merging and automatic publication through [PR #2](https://github.com/Insignifi4nt/wireedm-gcode-parser/pull/2).

## Standards review

Independent review found no remaining material standards violations. Agent tools reuse shared application validation and installation operations; draft edits remain distinct from saved-project simulation and controller export. Browser-cache and folder paths preserve exact originals and reject conflicting recovery states. Public authoring documentation remains usable without a checkout, while release procedures and assessment evidence stay in maintainer documents.

The final direct-input implementation was reviewed separately after handoff. A failed package preparation invalidates the previous preparation handle, covered by a regression. Cancellation and version checks run immediately before the installation journal begins; once durable work starts, the tool reports the actual installation outcome. Existing package identity, explicit collision choices and transaction recovery remain mandatory.

## Behavior and specification review

The independent review covered simulation, UPID and execution identity, editor changes, normalization and storage. It found one additional defect: released-piece guide checks tested only the wire-end plane, although the rendered guide has a finite height. The scanner now uses the full guide-body vertical interval and samples its entry/exit boundaries. A regression distinguishes a one-millimeter piece intersecting the lower guide from a piece below it. The reviewer ran 243 tests across 26 files successfully.

The dedicated agent file picker is removed. DXF and UPID tools accept supplied text, and machine-package preparation accepts the exact archive bytes as bounded canonical base64. The activity/readiness indicator remains. The public agent guide documents the changed input contract and limits; ordinary import controls remain available.

No Robofil update is justified by the workbench changes. The existing 2.6.0 source, package and installed browser copy remain unchanged. Seven added current-contract regressions cover spatial CW/CCW stops, reviewed partial arcs, simulation independence and unsupported transitions. See the [Robofil assessment](../maintainers/2026-09-22-robofil-assessment.md) for exact identities, supported routes and physical verification limits.

## Native browser verification and images

Verification used the production preview on port 3778 in the native in-app browser. The supplied `Spur gear (45 teeth)-work.upid.json` was imported through the public UPID tool into `spur-gear-45-teeth-work-2026-09-22`. Its source SHA-256 is `cca54cd029d7b486c198fba8301223e10267ec3b4d701bcf036330a5dcd2ba39`. The original Downloads file was only read.

The input had reversed kept-material choices. With the user's approval, the imported project's center-hole operation was changed to keep the outside, and its outer operation to keep the inside. The edits were saved through the shared tools. Both README screenshots show this corrected project: the editor and the simulator's final-part view. They are unedited viewport captures of the actual app, not generated renders. Simulation uses nominal geometry and the visible 20 mm stock thickness.

Direct package preparation accepted the existing Robofil archive and reported an exact collision with the already-installed package. Archive hash: `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`; post hash: `95b530e9a22abbf4ba1f8a80bbdaa1536abd6380ac9165348a82afb1d4c45a5f`. No installation or replacement was performed.

Controller generation for the corrected saved gear succeeded with that exact post and setup. The 8,804-character ISO artifact has SHA-256 `b136b515e00ec7099671be344772bd63969c623cd52081b659d5d4894f60affa`, saved as revision `revision.4570dfae-45d6-4351-a5e4-f29e92e38aa8`. This verifies generation, not execution on a machine. No browser warnings or errors were recorded during the final editor/simulator verification.

## Verification

- Full unit/integration suite before the final source-distribution addition, including the header follow-up: 1,794 tests across 187 files passed.
- Source-distribution and machine-import notice checks: 25 focused tests passed, including 11 new distribution regressions. Final integrated execution is recorded in PR CI.
- Production build and application TypeScript: passed.
- Static documentation build: 17 pages; documentation checks cover 58 generated files.
- UPID executable conformance: all three fixtures passed.
- Post authoring documentation consistency: passed.
- Robofil post conformance: all three fixtures passed; source and archive validation returned matching unchanged identities.
- Independent direct-input review: 55 focused tests and application TypeScript passed.
- Release compatibility check against `origin/main` and `git diff --check`: passed.

## Remaining limits and publication gate

Simulation is a nominal sampled preview with illustrative timing, not a kerf/offset solver or rigid-body simulation. STEP checks detect sampled wire/surface interference; they do not certify guide, solid-containment or released-piece contact with the imported assembly. Assumed waste removal does not emit machine stops or prove material has been physically removed.

The exact Robofil binding remains unverified on the physical machine. Its runtime rejection of unsupported already-separated manual repositioning remains in place. No new controller policy or automatic post upgrade is implied.

The build retains known large-chunk and OCCT browser-externalization warnings. Forced WebGL fallback and full mobile coverage were not rerun in this publication pass. The first complete PR workflow passed 78 Chromium browser tests; one optional smoke test requiring a pre-seeded local project was skipped. Successful checks on the final commit are required before merging. The PR and its linked GitHub Actions runs record the merge and publication outcome; software checks do not imply machine verification.

## Header follow-up

The user's final UI feedback moved Editor/Simulation into the existing header, using a shared pill tab component with a sliding selection, reduced-motion support and roving keyboard navigation. The old workspace-wide tab row is removed. Agent readiness, action history and captured-preview access now live in an Agent tab within the notification popover. Every opening starts on Notifications; Escape restores trigger focus, and outside pointer/focus dismisses it.

Independent review found no substantive behavior or accessibility regression. Native verification covered 320, 520, 641, 1024 and the original 1355 pixel width, including keyboard workspace switching and a viewport-clamped mobile notification panel. The 520 pixel check caught overlapping header controls; the two-row compact header now applies through 640 pixels. Desktop remains one row. Both README screenshots were refreshed after the change, and the browser warning/error log remained empty.

All 128 focused tab, notification, readiness and editor integration tests across five files passed, along with the production build/TypeScript/documentation checks. This follow-up changes presentation only; version 0.0.687 remains the single proposed release for the unmerged branch.

## Source-distribution release review

The final review caught an unfinished checkpoint in the STEP importer's third-party record: its corresponding library source needed to ship alongside the JavaScript/WASM distribution. Production builds now include both complete pinned upstream source archives, exact licenses, checksums and rebuild/relink instructions under `third-party/`. They total 52,618,541 bytes and are optional downloads, never app startup assets. The build verifies source and installed-library hashes and fails on unavailable, changed or incomplete files. User STEP files remain local.

Independent review verified the importer release's exact source commit and OCCT submodule revision, the actual archive bytes, the matching upstream/npm WASM and the loader's line-ending-only difference. All 25 focused distribution/notice tests and the real bundle verification passed. The [third-party record](../thirdparty/occt-import-js.md) documents provenance, build behavior and modification/relinking. Full OCCT recompilation and bit-for-bit reproduction were not performed and are not claimed.
