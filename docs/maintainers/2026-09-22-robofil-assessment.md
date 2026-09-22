# Robofil 100 package assessment — 2026-09-22

The simulation/workbench changes do **not** require a Robofil post upgrade. Keep `cristian.robofil-100.v2-candidate@2.6.0` and its complete machine package unchanged. This assessment adds regression coverage and documents limits; it does not publish a package, rewrite an installation, change controller commands or verify the physical machine.

Assessed the current branch after baseline `f912af8`, against the source, archive and evidence in [`robofil-100-v2`](../../tests/fixtures/machine-packages/robofil-100-v2/README.md). Post schema 2, engine API 1, execution-plan schema 1 and machine-package schema 1 remain compatible. `manifest.authoredFor.appVersion: 0.0.686` records the authoring target, not a minimum version or machine-verification claim. Legacy 2.5.0 and current 2.6.0 still install side by side.

| Area | Evidence and supported boundary |
| --- | --- |
| Compensation | Existing golden tests retain `G41`/`G42`, then `G38 D0`, across same-side continuous and supported manual-rethread transitions. A side change emits the new side and `G38 D0`; final cancellation remains `G40`, `G39`, `M02`. Every operation requires controller compensation. Wire-centre/centerline-only jobs remain unsupported by this package. |
| Leads and threading | Absent or reviewed-none leads emit no invented geometry; explicit reviewed leads remain motion. The candidate supports separating `G0` during positioning, followed by its existing `M00` manual-rethread pause. Continuous movement across known finished material remains blocked by the compiler. Manual separation before positioning and automatic threading are rejected by capability preflight. |
| Already-separated manual travel | A distinct repositioning move with `manual` + `already-separated` passes generic capability preflight but is rejected by the package's runtime guard while compensation is active. No controller artifact is returned. This is an existing supported-route/diagnostic limitation, not evidence for another controller sequence. Do not describe all manual-threading constructions as supported. |
| Stops and partial geometry | New tests post a quarter-circle spatial stop in both directions: motion reaches the stop, `M00` retains the correct event trace, then the remaining arc continues. A reviewed 270° active span emits only that span with its explicit wire side and original source range. Existing tests distinguish a user stop from a threading pause; both requested pauses deliberately produce two `M00` blocks. Partial cuts still need their own entry/exit reviews and compensation choice. |
| Arc and file rules | Absolute `I`/`J`, explicit `G2`/`G3` direction, three decimals and full-circle splitting remain unchanged. Serialization remains `.iso`, ASCII, CRLF, final newline, leading `%` and `N10` numbering in increments of 10. Unicode stop notes do not leak into controller bytes. No feeds, technology selection, taper axes or additional passes were added. |
| Simulation | Stock, support, gravity, retained/removed waste and final-part visibility are separate scenario assumptions. Tests run both retention and waste modes, seek forward/backward, then reproduce the exact same controller program and post hash. Assumed waste removal does not generate a machine stop or imply physical removal. Author an explicit program stop when one is required. |
| UPID and saved revisions | Corrected derived bounds/identity validation can reject malformed historical input or change previously incorrect derived execution geometry; see the [UPID compatibility record](2026-09-21-upid-compatibility.md). Preserve originals and review/save a new revision. Do not change a post to reproduce a corrupt saved plan. Current saved-revision generation still uses its exact machine/setup/post snapshot. |
| Installation and storage | Source validation and archive validation produce the same complete-package hash. The installer/storage fidelity fixes preserve exact catalog before-images, BOMs and conflicting recovery data; they do not upgrade installed post content. No browser installation or saved revision was changed by this assessment. |

## Exact identities

- Post canonical SHA-256: `95b530e9a22abbf4ba1f8a80bbdaa1536abd6380ac9165348a82afb1d4c45a5f`.
- Complete package/archive SHA-256: `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`.
- The existing 2.5 compatibility test verifies its published hash `525dda778a52a9f54a424fd4313d9c998613caaf8502573cfd519dd46a8a1d38` after removing only 2.6 authoring provenance and restoring its version.

## Verification and remaining evidence

- Existing Robofil suite: 12 tests, including golden output, ordinary conformance installation, exact persisted-revision export and setup-bound output evidence.
- Added current-contract suite: 7 tests covering spatial CW/CCW stops, reviewed partial arcs, simulation independence and three unsupported transition constructions.
- CLI post conformance: all three bundled fixtures passed. Both machine-package source and existing archive validate, with matching hashes and no rebuild/write.
- Broader contract check: 126 tests across 14 post/runtime, execution-plan and saved-revision files passed; application TypeScript passed.

The exact machine binding remains `unverified`. Bundled operator reports and candidate programs support the candidate policy; firmware/serial identity, physical rapid separation, `M00` behavior and mixed-side modal transitions have not been verified on this exact Robofil 100 by a supervised run. The machine definition retains only its evidenced 150 mm X / 200 mm Y travel and manual-threading hardware declaration. A future controller-policy change requires new evidence, a new post/package version and exact setup, fresh conformance, explicit installation review and a compatibility note; never mutate 2.6.0 in place.
