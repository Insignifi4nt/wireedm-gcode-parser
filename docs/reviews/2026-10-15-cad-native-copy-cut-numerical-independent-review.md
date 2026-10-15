# Independent addendum: Copy correctness and native Cut measurements

2026-10-15. Stage-one review remains unchanged at `2026-10-15-cad-native-copy-candidate-independent-review.md`, SHA`76151F541FA6E1B9FC49B01B57E1974B165A236DF4F021EBB2A5B198AD21008C`. This addendum reviews the newly investigated native material criterion; no product math, geometry, tolerance, installed artifact, original test or failure was changed. Candidate installation/cache acceptance remains separate.

## What the preserved failure establishes

The new located rational fixtures compare all recorded intrinsic/world coefficients, effective frames, vertices, pcurves, edge parameter/flag/incidence data and mesh arrays exactly before and after true Copy, individual copy-handle mutations and ordinary consuming transforms. Their subsequent Cut values exactly match independently constructed ordinary controls. The revised complete-ownership fixture now finishes every source/candidate/control/tool scope before inspecting and consuming the surviving sibling. Its final **unchanged** `toBeCloseTo(localVolume-5π,8)` still fails. The separate installed `.2` ordinary control contains no Copy call and reproduces the identical values/deviations.

The ideal5π removal is mathematically sound. The radius1 tool lies inside each source's projected material. Its local cylinder spans−2..8mm, covering the full prism: depth5, with the rational surface's lower graph bounded by its positive-weight control heights0..1.25 and upper graph translated5. Both target/tool receive the same rigid transform and subsequent translation. The surface prism's independently expected volume is720mm³. This does not make every numerical native mass query an exact integral.

The absolute5e−9mm³ pass bound arises from this new eight-decimal probe assertion. No corresponding universal product volume-accuracy promise exists in reviewed `docs/site/cad.md`, Model, Import or Cut/Pocket evidence. Existing analytic local tests use relevant expected-value precision; they do not establish that bound for arbitrary imported rational Booleans at every coordinate. Current material guards require valid closed positive solids and actual native-tolerance/area-scale evidence. Existing huge-target Pocket tests deliberately avoid unreliable whole-volume subtraction and inspect confirmed Common/section geometry instead.

## Independent installed-only measurement diagnosis

An ignored derivative of the untouched ordinary control creates the same rational sources and Cuts near the origin and at the original million-millimetre positions. It compares default mass, adaptive Gauss and Gauss-Kronrod on the **same actual shapes**, using existing bindings with diagnostic Eps1e−10. It does not replace or modify a native shape. Repeating the default mass after both queries is bitwise unchanged. Native validity and actual topology tolerances are recorded. No Copy call is made.

The existing Replicad `measureVolume` calls the boolean/default `BRepGProp.VolumeProperties` route. Native adaptive overloads return per-face relative integration error estimates, not an exact geometry or global absolute-error certificate. [Pinned native property contract](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingAlgorithms/TKTopAlgo/BRepGProp/BRepGProp.hxx).

| Fixture/position | Default result minus original local-default expected total, mm³ | Adaptive result minus that total, mm³ | GK result minus that total, mm³ | Result native tolerance, mm |
| --- | --- | --- | --- | --- |
| rational curve, near | +1.14e−13 | +6.82e−8 | −1.06e−7 | 1.00000002e−7 |
| rational curve, far | +6.8784e−9 | +7.47e−8 | −9.92e−8 | 1.00533482e−7 |
| rational surface, near | −6.88945e−5 | +1.45405e−7 | +1.37682e−7 | 5.000001e−6 |
| rational surface, far | −6.89310e−5 | +1.35595e−7 | +1.30059e−7 | 5.000001e−6 |

Surface values against exact720−5π differ from the table by the original local mass's−3.625e−10 offset. The substantial surface discrepancy exists near the origin too; most disappears merely by changing the diagnostic integration method on the same result. It therefore cannot be attributed to Copy or solely to far-coordinate geometry. Neither adaptive method eliminates the residual or certifies exact Cut geometry; actual surface-Cut native tolerance rises from1e−7 to5.000001e−6 in both placements.

Curve mass subtraction within each current target/result is especially informative: default removed-volume error is−5.33e−14 near and+4.737e−10 far. The original far total-mass criterion also includes the placed uncut target's property drift. Adaptive/GK estimates change total mass and retain similar tiny far removal residuals; blindly changing the product's integration route would not establish a universal eight-decimal contract.

**Conclusion:** distinguish strict Copy equivalence from this separately preserved exploratory native-numerical criterion. Evidence explains the dominant measurement contribution and disproves a Copy-specific regression in these controls. It does not prove exact far Boolean geometry or justify silently changing reported properties/tolerances. Any later product property-accuracy work requires its own explicit contract and actual geometry/measurement evidence.

## Evidence and authorization boundary

Independent Node24.22.0 diagnosis: **2/2 cases**,18.18s, each with near/far geometry, unchanged default-query checks, real confirmed-material Cut and full finally cleanup. These are successful diagnostic executions, **not** passes of the preserved eight-decimal material assertion. No native benchmark or application build/server/browser was run.

| Artifact | SHA-256 |
| --- | --- |
| `tmp/cad-native-copy-cut-integration-independent.test.ts` | `29ADFCEF3D9ABAC4F2EC518D4A25B315EA655B0FBE4082487457F1E9437CC89B` |
| matching `.config.ts` | `EB643EC88848885C126CE59653DD99069BBB0E992CDDDDEAB2E65F1E95040BB9` |
| `tmp/cad-native-copy-cut-integration-independent-curve.json` | `E07DC43E13DDE74281DF7CB543F7C07B4777F3423E25384261A87064BDC08A44` |
| matching `-surface.json` | `772FCE41E01A9677DFB131FD5FD04DB57AE613CB7565E661706BBB76EA0D181E` |
| `tmp/cad-native-copy-cut-integration-independent.log` | `55EE5E3CD9FF06BF92DC4A36BF31F5E364835282FDE72D558B634F4C1254E44F` |
| untouched installed ordinary control `.test.ts` | `7A965C9445999582D2056F5DDF9A414F725AB4D48EBE6DDD4190CC6801AB536D` |
| installed ordinary control `.config.ts` | `67457071564C52F6E77D9073BB759D21D2A0D3BB17E641DC6620D20380FF1D7F` |
| installed ordinary `-curve.json` | `55E6DDEB1D0D805593040C18C6AFC7EF2FF901EEF33F3A6F1E48A3F2F8CBB514` |
| installed ordinary `-surface.json` | `8966842B0A1C96EEFBE12EE6A2857289C8C3FCF51FB4665D8F99532C79476B0B` |
| installed ordinary failure log | `7B281B3A77B93CC6857A6C27A66CB0B62BC2F25CB709DAE8BEC6D50EE788A797` |

Root has authorized a **new** physical acceptance variant retaining exact source/coefficient/world/mesh/parameter/incidence/flag/mutation/full-lifetime checks, exact ordinary operation controls and existing confirmed-material guards, while separating the exploratory total-mass assertion. The original generic/complete-ownership/installed numerical failures stay preserved. A separate fresh-unshared compound semantic control is also authorized. Their frozen source and actual independent executions must be reviewed before claiming their scoped success; original generic4/4, exact far Cut, product installation and cache acceptance remain explicitly unclaimed here.

## Final frozen physical and semantic review

**Scoped review complete; no actionable defect found in the authorized variants.** Final manifest `tmp/cad-native-copy-final-physical-freeze.json` SHA`07ED217CA76C70676FA19A98DF6E8384680120213356504F0765F6D52626A14B` has18 new sealed paths. All18, all37 prior supplemental paths and all36 original candidate paths match again after independent execution. The earlier20 protected-original fingerprint checks remain valid and no installed/toolchain/product source was modified.

The physical variant diff against the preserved complete-ownership fixture separates only its final exploratory mass assertion, retains the expected number in evidence, and changes final stage text. Every preceding exact physical/source/operation/mutation/teardown assertion remains. Its real Cut still calls the unchanged shared confirmed-material validation; Cut mass must exactly equal its independently constructed ordinary control. This is the parent-authorized contract split, not a tolerance increase or a native repair.

The new compound semantic fixture constructs genuinely fresh independent unshared box controls at identical placements. Whole mass **and centroid** compare bitwise to those controls, while child mass, meshed physical data, pcurve/range/parameter/incidence/edge flags, source and mutation isolation remain exact against original. Original shared results are retained explicitly. Both variants have separate source/candidate/sibling/control scopes; source scopes include makers, raw shapes, geometry, subshapes and mesh handles. They all finish before the surviving sibling is checked and consumed against another fresh ordinary control. All explicit owners balance after final cleanup.

| Frozen source | SHA-256 |
| --- | --- |
| located rational physical acceptance | `7437A8F1D5303BADDC58071053E1AF68DE9E06DFCAD989D31EFB291B543034FB` |
| separate compound semantic case | `9290C244FD11313B023AE83FDCECAA13A3FD55CD027B8E3F9F6592F9614BAC81` |
| unchanged complete-ownership numerical probe | `12469282ECD170AD77017459EBFE8D50E12A6B4B0FFF906CE01500A41AF2295B` |
| preserved supplemental manifest | `994B03F9A538A28D89062EAD4752BC1AD899A416B7FC10EADC6DF58F524AE015` |

Independent Node24.22.0 replay, using unique evidence labels to avoid overwriting sealed JSON:

- Physical acceptance **2/2 pass**,1.15s; `tmp/cad-native-copy-located-rational-physical-independent.log`, SHA`E7AACD0DA60B102129AEFF69F56C2A9D1B55FD1AD8CFF99441208599CC5FF1F3`. Both reports reach complete physical/source/lifetime stage, with exact ordinary Cut controls and every source/candidate/sibling/control/tool owner released.
- Compound semantic **1/1 pass**,622ms; `tmp/cad-native-copy-generic-semantic-independent.log`, SHA`030A72C52C0833FE87A030E46FB6AE6324BCDC72213F14E3A6EE36534A3E5E98`. Report reaches complete, with exact source/control/survivor comparisons and balanced owners.

Owner's scoped ignored TypeScript gate is green; the earlier independent candidate TypeScript gate also passed. No further broad or heavy test run was needed. Original generic aggregate equality and complete-ownership/installed eight-decimal failures stay byte-identical and honestly red. These are representative nonperiodic rational, analytic and meshed native fixtures, not proof of every OCCT geometry/property or exact far Boolean output. Their seam absence is explicit. Native working-set measurements, packaging, installation and any future cache are separate decisions, not new blockers for the finished published CAD repairs.

**The isolated candidate investigation is now parked at the agreed scope.** No additional capability gates, native experiments, product changes or cache implementation are proposed by this review.
