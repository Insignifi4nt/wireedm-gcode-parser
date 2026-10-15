# CAD source capacity and unit correctness repair

Scope: STEP/STL/DXF source handling, CAD-specific DXF parsing, portable CAD schema counts, and local STEP/DXF confirmation. This is one bounded part of the active CAD hardening work. Native body/topology/render capacity and worker lifecycle changes are owned and reviewed separately.

## Capacity contract

CAD sources no longer have application policy ceilings on file bytes, STEP transfer roots or imported solids, or STL facets. CAD sketch/Curve import also removes fixed source/result edge, profile and contour counts. Portable CAD parsing removes fixed feature, parameter, metadata and parameter-group counts, and feature discovery describes the same uncapped profile array. Positive safe integers remain required where JavaScript must represent an exact count.

No geometry is dropped or simplified to fit an import budget. Native validity, finite coordinates and volumes, explicit units, complete STEP root transfer, STL manifoldness and closed-shell requirements, contour continuity/nesting, cyclic-reference checks, and strict own-data schema validation remain enforced. Existing pattern/Loft/Sweep authored-operation policies are outside this repair.

| Boundary | Removed policy | Preserved correctness |
| --- | --- | --- |
| STEP/STL source schema and native reply | 2 MiB source and 256 imported solids | Exact source encoding, nonempty data, valid native result and positive safe counts |
| Native STEP transfer | 256 roots/solids | Every declared root transferred; valid oriented closed solids and no loose geometry |
| Native STL parser | 4,000 facets | Complete finite facet records, triangle validity, one connected closed manifold shell |
| CAD DXF source/parser | 2 MiB CAD source and inherited 16 MiB/default parser work policies | Units, exact supported entities, valid inserts and transformations, actual cycles and omitted geometry rejected |
| CAD polygon/path/Curve/sketch | 2,048 per-chain edges, 8,192 aggregate edges, 256 profiles | Existing geometric and dependency validation |
| Portable schema | 256 features, 64 groups, 128 parameters/metadata entries | Strict fields, IDs, expressions, group references, duplicate detection |
| STEP unit validation | 16 conversion-reference depth | Complete iterative chain validation, cycle checks, valid length dimensions, finite positive factors and intermediate scales |

`parseDxf(..., { mode: 'exact-cad' })` is an explicit CAD-only policy. Default CAM parsing and its resource checks are unchanged. Exact CAD marks unsupported SPLINE entities without running a discarded approximation, then the CAD import rejects an incomplete source. The parser does not quietly import only supported entities.

## Resource behavior

Unicode validation counts UTF-8 bytes linearly without allocating an encoded copy. Unpaired surrogates reject before persistence or native transfer. Canonical base64 validation checks alphabet, padding and pad bits linearly, without a full decode/re-encode round trip. Encoding and decoding use aligned bounded chunks; decoding allocates the final byte array once. Client and controller source-byte matching reuse the validated byte count instead of decoding the source again.

STEP and DXF local confirmation use the shared exact UTF-8 Blob reader with cancellation. Both stream-capable files and bounded `Blob.slice` fallback reads preserve BOM, line endings, Unicode and original text. Cancellation rejects while a slice is still pending; its later completion cannot accept a source. Invalid UTF-8 produces `INVALID_ENCODING` and preserves the current draft. The post-read document version and active adapter are checked before applying geometry. STL remains an exact binary byte path.

These changes remove redundant work and static policy rejection. Available browser memory, native representability and actual valid geometry still determine whether a source can be processed.

## STEP nested conversion capability

The iterative source validator resolves a valid 17-reference conversion chain without a depth guess. The native reader has a separate structural limitation: a conversion-based length unit referring to another conversion-based unit is not supported reliably by the pinned OCCT build.

For an exported 20 × 10 × 5 coordinate box, a nested conversion with net 1.5 mm per source unit independently requires 30 × 15 × 7.5 mm and 3,375 mm³. Before the guard, the pinned reader returned 1,000 mm³. The same defect occurs in a shallow two-conversion chain, so accepting chains up to any chosen depth does not solve it. A direct 1.5-to-SI conversion imports with the required 3,375 mm³ and exact bounds.

Pinned OCCT [`STEPConstruct_UnitContext.cxx`](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/DataExchange/TKDESTEP/STEPConstruct/STEPConstruct_UnitContext.cxx), lines 323–345, downcasts the conversion target to an SI unit and returns status 3 when that fails. Its diagnostic path around line 566 describes default-unit fallback. This source evidence matches the measured wrong-scale native transfer. The pinned [`STEPControl_Reader.cxx`](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/DataExchange/TKDESTEP/STEPControl/STEPControl_Reader.cxx) supplies the reader transfer context; the unit sequences needed for `FileUnits` are not bound in this WASM package.

Import now rejects that exact structure before `TransferRoots` with actionable `step-units-unsupported`: re-export using SI length units or a direct conversion to SI. Mathematical invalidity still reports `step-units`. No global scaling, source rewrite, tolerance change, native package change or partial transfer is introduced. Even a nested chain whose net factor happens to equal the native fallback is rejected because coincidentally correct material does not establish supported interpretation. The exact original source remains intact.

This is an intentional correctness compatibility change: previously accepted shallow nested-unit STEP sources can now reject rather than produce wrongly scaled parts. The parent owns its public diagnostic/release record.

## Worked regressions and verification

The unchanged default V3 gear and bore, extruded 5 mm, exports and reimports as real STEP beyond the old 2 MiB source limit and STL with 4,080 facets beyond the old 4,000-facet cutoff. STEP preserves analytic BRep volume. STL is checked against the independently integrated written float facets, whose volume differs from the BRep; the expected material is not weakened to conceal that representation difference. A late malformed facet beyond the former cutoff still rejects.

A real 1,001-root STEP assembly transfers all 1,001 separated unit cubes, then builds through the runtime/model path with 1,001 solids, 1,001 mm³, minimum [0, 0, 0] and maximum [3001, 1, 1]. The exact exported source is retained. This exceeds both former source transfer limits and the former downstream 1,000-instance policy removed by the parent.

CAD DXF regressions include complete text above 16 MiB, an 8,193-edge closed polygon with independently computed material area, a 2,049-edge exact open Curve export/reimport, 257 independent closed profiles, and 20,001 expanded INSERT entities. CAM defaults continue to reject their own bounded-resource cases. Real cycles, unsafe insert counts, unsupported spline approximation and malformed geometry retain their expected failure behavior.

Portable schema coverage reopens 257 features, 65 named groups and 130 parameters with metadata and expressions unchanged; duplicate IDs and missing groups still reject. An actual `add-plugin-profile` operation also crosses the former parameter/group boundaries, preserving 128 existing values and their provenance while adding four gear drivers and the 65th group with valid geometry bindings. Tool discovery and full-import validation agree on capacity while still rejecting semantically malformed imports.

Focused completed runs:

- Source/native import and boundary suites: 219/219 before the later DXF/unit/text phases (`tmp/cad-source-caps-focused-final.log`).
- CAD DXF/native/tool suites: 141/141 (`tmp/cad-dxf-native-tools-final.log`); shared CAM/client/controller/tool/agent boundaries: 239/239 (`tmp/cad-source-dxf-boundaries-final.log`).
- Real unchanged gear source capacity and native import suites after indexed native deduplication: 20/20 (`tmp/cad-source-capacity-native-current.log`). Timing is observational, not a performance threshold.
- Unit chains, portable count and tool discovery: 19/19 (`tmp/cad-step-units-document-counts-final.log`).
- Real 1,001-root assembly runtime/model case: 1/1, 22.91 s (`tmp/cad-source-1001-final.log`).
- Final textual file controller suite: 106/106 (`tmp/cad-source-text-stream-final.log`), including bounded slice fallback, pending-read cancellation, exact originals and invalid UTF-8.
- Parameter operations and semantic integrity: 13/13 (`tmp/cad-source-parameter-boundary-final.log`), replacing the obsolete driver-count rejection with valid scoped plugin creation above the former limits.
- App TypeScript: passed (`tmp/cad-source-capacity-final-tsc.log`). `git diff --check`: passed, with existing CRLF normalization notices only.

The records above cover this source-format repair. They do not claim that the overall CAD goal is complete or that every external representation is supported. Multiple disconnected STL shells, unsupported DXF entities, the documented nested STEP unit structure and genuinely invalid or unrepresentable native geometry remain explicit capability/validity failures.
