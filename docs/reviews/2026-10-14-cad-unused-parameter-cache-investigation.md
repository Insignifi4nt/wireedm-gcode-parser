# Native rebuilds after unused parameter edits

Date: 2026-10-14. The initial read-only investigation below measured the native cache, parameter usage policy and query environment. It was followed by an explicitly authorized scoped implementation, recorded at the end. All measurements ran isolated real OpenCascade runtimes with the installed pinned kernel; no browser draft or server was changed.

## Measured behavior

WASM initialization completed before measurement. Each fixture had one initial build followed by three pairs of a same-document cache hit and a changed-parameter build. The table reports local wall-clock medians; build timings include boundary validation. No performance threshold was asserted.

| Fixture | Repeated same-document build | Parameter-change build | Observed geometry after each edit |
| --- | ---: | ---: | --- |
| Literal 20 × 10 × 5 mm stock; unused parameter 1 → 2 → 3 → 4 | 0.41 ms | 6.68 ms | New build and arrays; every mesh value, bounds and 1,000 mm³ volume identical |
| Pinned V3 gear, local module 3, 18 teeth, radius 6 bore, depth 5; unrelated document `module` 99 → 100 → 101 → 102 | 7.15 ms | 715.26 ms | New build and arrays; every mesh value, bounds and 10,681.23 mm³ volume identical |
| Same gear in automatic cutter-tip mode; dormant linked custom tip 0.3 → 0.4 → 0.5 → 0.6 | 4.14 ms | 739.63 ms | New build and arrays; every mesh value and volume identical |
| Generic star recipe with locked editing of linked outer radius 30 → 31 → 32 → 33 | 0.64 ms | 11.17 ms | New geometry, as required: volume 9,184.40 → 9,490.55 → 9,796.70 → 10,102.84 mm³; outer bounds grow with the radius |

The gear fixture keeps all package input defaults except the dormant-tip expression in the third row. The first gear's module input is the local number 3, with no expression link to document `module`. Its unchanged bounds are approximately `[-30, -29.704594, 0]` to `[30, 29.704594, 5]`. All input document bytes remained unchanged.

The dormant built-in input is reported as `editable: false`, `effective: false`; its applied cutter-tip radius remains approximately 1.1398525234 mm. The locked generic recipe uses a field rule enabling outer-radius editing only when `lobes == 3`, while the fixture has eight lobes. It is correctly reported as `editable: false`, `effective: true`; the generator still consumes its stored radius. Disabled editing therefore cannot be used as a generic geometry-dependency rule.

For a query-only parameter, the stock contained `cutHeight = 2` with no feature expression referencing it. Section requests using `offset: "cutHeight"` after changes to 3, 2.5 and 4 rebuilt identical stock geometry every time and returned the correct new offset. The local query timings were 30.33, 6.04 and 6.02 ms. Numeric offsets 2 and 3 on the same accepted document reused its build, demonstrating that different section planes themselves do not require native reconstruction.

These samples establish avoidable reconstruction in the current key. They do not predict latency on another device, benchmark large assemblies, or justify removing validation. The repeated-document gear hit still costs several milliseconds for the existing domain boundary work.

## Existing dependency semantics

`cadKernelRuntime.modelKey` currently includes the entire parameter dictionary. Its full accepted-document key is separate and must remain complete for inspection ownership. Profile labels, dimension intent and parameter organization are already excluded from the geometry key; feature/body names remain included for mesh and STEP labels.

The existing `cadParameters` module provides the necessary expression traversal and semantics:

- `mapCadFeatureScalars` visits typed scalar fields, including sketch/plugin inputs, datum placements, curve paths, feature extents, transforms, patterns and stored topology predicates. It deliberately avoids labels, IDs and embedded source/package text.
- `cadScalarParameterNames` matches the scalar parser's lexical identifiers without mistaking a scientific exponent for a parameter or matching a substring.
- `inspectCadParameters` marks a usage inactive only for a suppressed feature or the explicitly replaced automatic inputs of the exact pinned V2/V3 gear. Generic recipe editing locks retain active usage. A parameter used elsewhere remains active if any of its usages is active.
- Recipe generation sees evaluated package inputs and derived local values, rather than arbitrary access to document parameters. Package identity and definition remain pinned and validated.

A simple lexical scan of nonsuppressed fields would safely remove fully unrelated parameters while conservatively retaining all stored plugin input links. That would address the first two table rows but still rebuild for the known dormant built-in tip. The existing semantic usage inspection can also address the third row while retaining the fourth.

Five warm local collection samples measured a median of approximately 0.01 ms for the lexical gear scan versus 0.64 ms for full usage inspection. Inspection generates the plugin profile as well as returning usage information, so it performs more work; the measured overhead is small relative to the avoided 715–740 ms native rebuild. Reusing the existing semantic inspection is a smaller initial change than creating a second inactivity algorithm. A lightweight shared collector can be extracted later if that cost is measured as significant.

An inactive input is still validated. A separate probe changed the automatic gear's dormant linked cutter tip to 60 mm. The runtime rejected it with `invalid-plugin-inputs` because its pinned static range is 0.00001–50 mm. The preceding accepted build and topology inspection remained usable. An active-parameter cache must retain this complete validation before considering reuse.

## Query environment is a required companion change

`buildCadKernelModel` captures its original `document.parameters`. Its `section` method currently evaluates the requested scalar offset through that captured map. A direct retained-model probe built stock with `cutHeight = 2`, then represented the current document with `cutHeight = 4`. The old model's named request returned offset 2, while a numeric request resolved from the current map returned offset 4. Therefore narrowing the geometry key alone would introduce an incorrect section plane.

`resolveTopologyPicks` also passes the captured parameter map to native selector validation. Its current public request contains only opaque picks and a purpose; generated selectors are literal numeric descriptors, so there is no demonstrated stale named-predicate bug in that route today. Stored parametric selectors used to build fillets/chamfers/shells are different: their scalar references must remain geometry dependencies.

## Proposed minimal contract

1. Parse and validate the complete incoming document first, preserving all current package, geometry, metadata and expression checks. Cache projection must never rewrite an accepted document.
2. Project a sorted name/value dictionary containing parameters with at least one active usage from the existing domain inspection. Continue to key the full feature definitions, units and document ID. Do not prune consumed bodies, upstream dependencies or currently unused source sketches by visibility, and do not infer inactivity from UI editing state.
3. Keep `cached.key` as the full accepted JSON snapshot. A metadata-only or unused-parameter Build can adopt the new full key while reusing geometry. Old full-document inspections and stale caller versions must still reject.
4. Pass the current validated parameter environment explicitly to every parameter-sensitive query. A small compatible internal method extension can let `model.section(request, currentParameters)` evaluate its offset against that map and let `model.resolveTopologyPicks(request, currentParameters)` validate generated selectors against it. Geometry construction continues to use its own immutable build environment. Runtime calls must supply the current map even on a cache hit.
5. An alternative section boundary can resolve the scalar to a numeric offset in the runtime before invoking the cached model. Whichever boundary is chosen, never mutate a model's captured environment just to run a query: a failed query must not alter accepted state.
6. Preserve the current query transaction: malformed or failed section/export requests retain the accepted model and full key; a successful query may adopt its validated current document. Inspections/pick resolution remain unable to create or reconstruct a missing native snapshot.

The first implementation can reuse `inspectCadParameters` directly to avoid duplicating the exact built-in dormant-input policy. If only a conservative lexical projection is chosen initially, its retained dormant references should be documented as an intentional performance limit. Neither approach changes the public CAD schema or tool argument shapes.

Meaningful red-first cases before implementation should cover identical arrays/build for an unused stock parameter and the unrelated gear `module`; a recognized dormant gear driver; a locked generic recipe driver that must rebuild; and a parameter shared by dormant and active fields that must still rebuild. Query cases must verify a newly named section offset uses the current value without rebuilding, invalid/outside queries retain old ownership, accepted new documents invalidate old full-key inspections, genuine geometry changes still rebuild, and caller/pinned package bytes remain exact. Existing runtime transactions and native material checks should remain in the focused verification set.

## Implemented scoped optimization

After the measurements, the root task authorized the semantic active-parameter projection. `cadKernelRuntime` now builds a sorted name/value dictionary from existing usage inspection, retaining any parameter with at least one active use. The complete document is still parsed first. Feature definitions, native names and the complete accepted ownership key remain unchanged. The implementation neither copies inactive-input policy into the worker nor treats generic editing locks as inactivity.

`CadKernelModel.section` and `resolveTopologyPicks` now accept an optional explicit parameter environment. Direct native callers retain the original document environment by default. Runtime query calls always supply the current fully validated document map. No cached closure or build environment is mutated. The existing successful-query adoption and failed-query retention transaction is unchanged.

The red-first run captured **7 failures and 11 passes** across the new cache suite and updated runtime expectations. Five new cases reproduced unused rebuilds or the absent explicit query override; two existing STEP/STL cases were updated to the authorized new contract for query-only parameter edits and failed before implementation. The generic locked-input case already passed and protects the active dependency under the new projection.

The final focused run passed **67 tests in 5 files**, 27.87 seconds:

```text
cadKernelParameterCache.test.ts
cadKernelRuntime.test.ts
cadParameters.test.ts
cadKernelModel.test.ts
cadKernelTopology.test.ts
```

The new suite verifies original build/result/array identity for unused stock and local-module gear edits, canonical parameter-declaration order, real linked module changes, valid dormant gear updates with invalid static-range rejection, and a dormant parameter shared with active extrusion depth. It verifies the disabled generic recipe's independently expected star volume, exact stock STEP material, named gear STEP solid structure, current section offsets on reused geometry, failure retention, old full-key rejection, current exact picks and original document/package bytes. A direct-model case retains default offset 2, uses explicit current offset 4, then returns to default 2, demonstrating that no captured map was overwritten. The app no-emit type check and scoped whitespace check pass. Independent source review remains root-owned after the tree agent was reassigned to the requested icon audit.

A second isolated warm measurement used the same fixture definitions and three edits, with all edits retaining the original build and arrays:

| Edit | Before median | After median |
| --- | ---: | ---: |
| Unused stock parameter | 6.68 ms | 0.62 ms |
| Unrelated document module beside local-module gear | 715.26 ms | 7.57 ms |
| Known dormant automatic cutter-tip driver | 739.63 ms | 6.10 ms |
| Query-only named section height | 6.04 ms | 2.89 ms |

The first section query in each process still took approximately 30 ms; the current named offsets were 3, 2.5 and 4, with the original native build and arrays retained throughout. These local medians are observations, not performance assertions. Validation and plugin inspection still run; the improvement removes unnecessary native reconstruction.

The default-accuracy gear's STEP export was 3,469,018 bytes, larger than the existing 2,097,152-byte solid-import limit. Export succeeds, but reimporting that same file through the bounded application importer is unsupported. This existing limit was exposed while designing the cache regression; it was not relaxed and default geometry/accuracy was not changed. The default gear case verifies native material, sections, named STEP structure and retained model ownership; the stock case independently round-trips STEP material through the supported import boundary. No expanded export/reimport compatibility claim follows from this optimization.
