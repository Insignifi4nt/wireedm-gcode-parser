# Native Copy resource and stage-timing assay — 2026-10-15

Candidate-only observation against application checkpoint `3f70f4dc32374b44351942ce88289d7c3ce55874`. The matching experimental pair is in `tmp/cad-native-copy-candidate`; nothing was installed, packaged, cached or changed in production. This is a standalone ownership simulation, **not a test of a runtime import-cache lifecycle or approval of generic exactness**.

The single Node `v24.22.0` process ran 00:10:27.949–00:10:55.731 UTC, 27.78 seconds. Research and Explicit held their native execution during this window. No build, browser, server, worker reset, forced GC, allocator calls, native instrumentation or timeout changes were used.

## Inputs and seals

The retained real default-gear STEP is 3,469,018 bytes, SHA-256 `A501C92CAE766D9B4C518B5FD6CC571C89FD5970CF397C115E594AE82B52F182`, with accepted volume `10681.229997581098 mm³`. Three further sources were generated with ordinary native STEP export, retained as new files, and accepted through the current full `loadCadSolidImport` path:

| Source | Exact bytes | Native accepted volume, mm³ | Retained source file |
| --- | ---: | ---: | --- |
| Box 20×10×5 | 15,809 | 999.9999999999998 | `tmp/cad-native-copy-resource-source-box.step` |
| Cylinder r4, h5 | 6,068 | 251.3274122871834 | `tmp/cad-native-copy-resource-source-cylinder.step` |
| Replacement box 8×7×3 | 15,802 | 168 | `tmp/cad-native-copy-resource-source-replacement.step` |

The report records each source's SHA-256. Distinct source hashes, unchanged source JSON/text and accepted solid validity/material are checked. No original was rewritten.

`cad-native-copy-resource-seals-{before,after}.json` independently verifies all **70** rows against existing authoritative records: 36 frozen candidate/control files, 20 original-readiness files, five preserved `.1`/`.2` artifact files, eight package/source archives, and the gear. Both checks pass unchanged. The preserved v1 generic-named source archive belongs to its revision1 manifest; the current generic-named archive belongs to v2. An initial seal-script path-mapping mistake was corrected before the assay; it compared the current v2 archive to the v1 manifest and was not an artifact change. Existing frozen tests, logs, manifests and contracts were untouched.

The candidate WASM hash is `3F8F26244DC7CAB71143A33B801789DEBC9EBC50EAC228C8F8E1DB2E8F518612`; candidate types `0098465BB86CC685019A65239E7DCAD1ADFDE909629DC7EB5C1005056346A3A7`. Installed WASM remains `F3315403717F650C207ECCD2F372AFC380005B4F219BAD31991D6F115FDC1744`.

## Observed stage times

Each source has one excluded warm pair followed by three interleaved measured pairs. Milliseconds below are medians; all individual observations are retained in the JSON. No threshold determines success.

| Source | Ordinary full reread | True Copy construction | Separate copied validity + volume |
| --- | ---: | ---: | ---: |
| Gear | 1,664.708 | 35.545 | 220.283 |
| Box | 13.155 | 0.376 | 1.232 |
| Cylinder | 3.314 | 0.134 | 0.466 |

Ordinary reread includes source parsing/byte creation, virtual-FS writing/unlinking, STEP reading/transfer and complete import analysis. Copy uses `BRepBuilderAPI_Copy(shape, true, true)`, result wrapping and Copy-builder release. Validation is measured separately with the unchanged native validity and volume helpers. These are **different stages**, not an equivalent-work or whole-part benchmark: topology extraction, meshing, section/export, full-document build, worker transfer and UI publication are outside the Copy timing. Initial gear acceptance was 1,024.625 ms, so these modest samples should not be treated as a stable performance distribution.

## Ownership, edits and rollback

The real native scenarios passed:

1. Hold three pristine original sources plus four accepted and four candidate occurrences simultaneously. Both models contain two independent occurrences of the same gear, plus the distinct box and cylinder. Copies have distinct native shape identities; measured semantic snapshots match their originals bitwise.
2. Consume only candidate gear A through a 40 mm translation, comparing its full recorded native snapshot exactly to a separately reread/transformed control. Perform an actual positive-material Cut on the candidate stock and compare it exactly to an ordinary-import Cut control. Accepted bodies, pristine originals and the unmodified candidate gear sibling remain valid and bitwise unchanged in the recorded semantics.
3. Attempt a real nonintersecting Cut on an independent branch. Preserve the actual `cut-no-material` error, release its branch/tool and then the complete candidate model. The previous accepted model is still exact and valid.
4. Accept a fourth distinct immutable STEP source, replace just one repeated gear occurrence, verify the candidate while retaining the old accepted model, and dispose the old model only afterward.
5. Dispose the pristine gear owner while its independent accepted copy survives; check validity and the exact snapshot again. Prepare a model omitting the final gear occurrence, verify it before retiring the previous model, then release all remaining bodies/originals.

Snapshots compare native volume, world vertex coordinates/tolerances, every edge's type/range/tolerance and sampled evaluations, every face's sampled stored surface and edge pcurve evaluations/ranges/tolerances, placement matrix, maximum native topology tolerance and bounds. They do not substitute serialization IDs. They are comprehensive worked-fixture measurements, not exhaustive coefficient coverage of every native geometry class; the separate generic/rational candidate review remains necessary.

The explicit assay ledger balances **1,499,649 created / 1,499,649 disposed / zero remaining** returned or directly constructed native wrappers. Four consumed input wrappers are accounted for separately and their independently returned replacements are owned. Peak simultaneously held explicit wrappers are 2,612, including full snapshot face/edge arrays; peak full-shape wrappers are 15, including independent controls/tools. Unchanged shared import, validation, transform, Cut and export helpers have their own scoped internal allocations, which are not individually intercepted by this ledger. It establishes application-owned disposal in this simulation, not proof of every native allocation.

## What memory measurements establish

| Checkpoint | Explicit shape wrappers | Reserved WASM | Process RSS |
| --- | ---: | ---: | ---: |
| Candidate initialized | 0 | 100 MiB | 212.477 MiB |
| Three pristine + four accepted + four candidate | 11 | 100 MiB | 404.012 MiB |
| Source replacement, old and new models retained | 12 | 100 MiB | 524.141 MiB |
| All explicit owners released | 0 | 100 MiB | 578.059 MiB |

Reserved linear memory remains exactly **104,857,600 bytes** throughout. The OS process-lifetime RSS high-water is **595,416 KiB / 581.461 MiB**, higher than the largest sampled RSS. This is a real process high-water, **not allocated native live bytes**. Full semantic snapshot arrays, source strings/JSON, V8 garbage awaiting ordinary collection, module/loader buffers and native runtime contribute; final `heapUsed` is 306.757 MiB. Snapshot/checkpoint sampling also cannot expose synchronous transient native allocation peaks. Consequently the rising RSS after body disposal is neither a native leak finding nor a cache-capacity measurement.

No supported aggregate native allocator counter was found in the bound declarations. Public instance names expose `wasmMemory`, `_malloc_size` and `_malloc_usable_size`; those allocator functions were not invoked or guessed. The sealed loader's imported `mallinfo` is explicitly a `missing function: mallinfo` stub. **Peak allocated live native bytes remain unavailable.** Fixed reserved capacity and balanced explicit handles cannot substitute for that statistic.

## Decision and reproducibility

True Copy has a substantial observed construction-stage benefit for this gear and workable independent-owner disposal across repeated and distinct sources. It justifies considering adoption only after the remaining generic semantic contract is resolved and an actual runtime candidate receives source/version/rollback and memory review. The retained exact repeated-location compound aggregate failure is separate evidence; this assay does not make it pass or infer universal exactness. Source retention must stay request-scoped with unchanged preflight, original bytes and failed-read transaction behavior; no cache was implemented here.

The ignored script is `tmp/cad-native-copy-resource-assay.ts` (SHA-256 `F826031112B4D8E3FD38219A65F5FFB168F0EEA6CD791B9C6C18FECA79C800ED`). The report is `tmp/cad-native-copy-resource-report.json` (`91B00DFC9850B4D01B7092DF213A0565CC14801B0A3CF0C57467233476CADD51`); log is `tmp/cad-native-copy-resource-assay.log`. Output writes are exclusive to preserve existing evidence. The exact run used:

```powershell
& tmp/toolchains/node-v24.22.0-win-x64/node.exe node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.app.json tmp/cad-native-copy-resource-assay.ts
& tmp/toolchains/node-v24.22.0-win-x64/node.exe node_modules/typescript/bin/tsc -p tmp/cad-native-copy-resource.tsconfig.json --noEmit
```

Scoped typecheck passes. `tmp/cad-native-copy-resource-freeze.json` seals this new script/report/log/source/seal evidence, this record and the exact shared helper inputs. All earlier files remain preserved; the only new tracked file from this investigation is this private audit. No production/native/package/install/cache change or overall CAD completion is claimed.
