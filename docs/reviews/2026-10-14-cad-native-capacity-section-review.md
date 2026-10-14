# CAD native capacity, section and pagination review

Independent review on 2026-10-14 against fixed baseline `09795ec5e0e404f5ce69ff2173dea119a69f66ce`, including the current working-tree changes. Scope covers exact topology inventories, model/preview construction, native mesh extraction, worker reply integrity, analytic sections/CAM and complete CAD pagination. The user-directed policy removes guessed local CAD capacity ceilings while retaining exact geometry and resource ownership. Public guides, release/checklist files, browser state and servers were not edited by this reviewer.

## Confirmed findings and repairs

Three remaining policy seams rejected supported complete data after the capacity change. The worker reply guard still refused more than 256 bodies; the complete-document reader still refused offsets beyond 16 MiB; and shared workbench page fields still limited CAD body/feature page offsets to 100,000. Red-first regressions reproduced all three failures. The guard now validates every body without a count ceiling, and CAD-specific offsets use nonnegative safe-integer range checks. Shared workbench pagination is unchanged. Reply rows still use the 50-row/24 KiB response budget, and document text chunks remain at most 4,096 UTF-16 code units. Invalid offsets, stale versions and actual past-end document reads still fail.

A separate P2 integrity defect was reproduced during that review. `Array.every` skipped a missing body, and `Set(sparse.map(...))` counted the hole's `undefined` as one distinct ID, allowing a 257-row reply with its last body absent. Sparse diagnostics likewise skipped validation. Top-level body/diagnostic validation now uses `for...of`, and an incremental ID Set both rejects duplicate body identities and avoids the previous mapped-array allocation. Tests preserve complete 257-body results, reject missing/corrupt/duplicate tail records, and terminate the worker for an invalid tail index instead of publishing a partial model. Dense numeric and topology-group guards already use `for...of`; triangle index `every` remains safe after that complete numeric validation. Repeated legitimate group keys retain their existing semantics.

The meshing cleanup test still guessed that 3,000,003 triangles must reject. Its red failure confirmed that the fabricated count fits the physical WASM heap and that the removed policy no longer rejects it. The replacement cases test actual integrity failures: negative, fractional, nonfinite and invalid-stride counts; unaligned, fractional, invalid signed/unsigned and out-of-heap pointers. Every case verifies `invalid-mesh`, extraction/transform cleanup, source volume and a successful exact-topology retry. No meshing production code was changed by the reviewer.

## Native and modeling conclusions

The removed 10,000/25,000 topology and 8,000,000 scalar ceilings do not replace native validity checks. Mesh counts remain safe integers with correct coordinate/triangle/group strides. Pointers must be legal 32-bit representations, aligned and within the current WASM heap before copying. Vertices/normals must match. Worker validation checks every finite numeric value, triangle index bounds, contiguous complete group coverage, cross-kind keys, volume, bounds and optional positive safe-integer solid counts.

Native inventories use indexed maps with `IsSame` identity and locations, retain every exact face/edge and resolve hash collisions. The strengthened real compound case uses 2,084 cubes and retains all 37,512 distinct elements. Its edge page at offset 25,000 returns the final eight of 25,008 edges and null continuation; the exact end returns no descriptors and beyond-end rejects. Inventory disposal is followed by a normal box build. Client/controller body/build/version and page-count/continuation checks remain authoritative, and stale/disposed model picks cannot authorize edits.

The larger 60- and 120-tooth native gear cases retain requested accuracy and source documents, with native volume checked against the unchanged analytic boundary. Four native 2,000-edge bodies all survive construction beyond the former aggregate topology policy and remain exportable. The model still validates positive-volume components and the complete native solid before committing consumed bodies. Failed features retain only preceding valid previews, report diagnostics and block full exports/sections; an incomplete retained preview cannot be exported as the requested model. STEP/STL export uses the exact active BReps, not preview arrays, and scoped cleanup releases temporary export resources.

Section capacity changes remove the 8,192-edge policy while preserving interior/tangent checks, exact line/circular-arc extraction, native approximation disabled, closed degree-two outlines and complete analytic CAM conversion. The larger section DTO/CAM cases preserve all 8,193 lines and reject a corrupt tail. These domain cases are not a claim that a real native 8,193-edge section was measured. Existing native gear/model section behavior remains separate evidence. Unsupported section curves and STL multishell semantics are unchanged. Pattern, Loft and Sweep operation policies were deliberately outside this review's repair scope.

No further correctness regression was confirmed in the reviewed capacity/section changes. Two resource questions remain for measurement before optimization: topology inspection currently allocates/filters the full inventory for each requested page, and section vertex degree validation performs a linear search for each endpoint. The latter can grow quadratically; it remains intact until a replacement preserves tolerance, insertion-order and touching/branching rejection semantics. This review does not claim browser peak-memory or large-section latency certification.

An adjacent API issue was confirmed after the coordinated source owner removed parameter-count serialization limits. A real accepted 1,001-parameter document is 84,220 UTF-8 bytes, but the public `cad_get_context` operation returns `OUTPUT_TOO_LARGE` because context embeds the entire parameter map. The read-only offline reproduction is `tmp/cad-context-capacity-review.ts`; its live Session and version remain unchanged. Source inspection shows that several successful mutation receipts also spread this context, so receipt sizing needs a separate bounded-summary repair. This issue was reported to the parent for the next owned API seam; it was not silently repaired inside the frozen native review.

## Verification

- Initial review gate: the obsolete meshing expectation failed; 49 other tests in seven suites passed.
- Three policy seam regressions failed before repair. The sparse missing-tail regression then failed before its integrity repair.
- The expanded real native/model/topology/gear/section/API gate passed **78 tests in nine suites** before the final sparse-guard refinement.
- Final protocol, meshing, client, pagination, tool and topology-action gate passed **54 tests in six suites** after that refinement.
- `npx tsc -b --pretty false` and the scoped diff check passed.

Reviewed source SHA-256 identifiers:

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadTopology.ts` | `35a07a30f3c195e01ec6453f6847b3dd77e4fcb3b35f3b8db7c96391275441ee` |
| `src/domain/cad/cadSection.ts` | `d3ce8161c42f8ec2e3c65a8216a87334c348bac81a1b401e79afceb4bd9ff5f5` |
| `src/domain/cad/cadCam.ts` | `9797551e2a0180f312e3c9cedda7b9e25601f88d20c255375a438c408098ba1f` |
| `src/features/cad/kernel/cadKernelTopology.ts` | `8537e8187bdcad79f8f03b510c2374e0debd8f006bd6f389dbac73c77afa3a2b` |
| `src/features/cad/kernel/cadKernelModel.ts` | `9f8b6b982d4a87725a84641b6652215d760b238a6e778915694c52286367251f` |
| `src/features/cad/kernel/cadKernelMeshing.ts` | `b45a0fe292b9f5b2313b956b50ef826a313f9f2b34f3e4f446b558306202304c` |
| `src/features/cad/kernel/cadKernelProtocol.ts` | `1de041c558e06d8e5299bb0f351850bc76a4a55a26772a76e375387f722419ac` |
| `src/features/cad/kernel/cadKernelSection.ts` | `a38c2fa990f9ec960bcb5979e7b697a699c56831782a1304e487abe9d124ebdb` |
| `src/features/cad/cadSiteTools.ts` | `69d61d5c78b09d4a76404605c72883fc44a2b17423216722c276e96ce08860da` |
| `src/features/cad/kernel/cadKernelMeshing.test.ts` | `95809e7b9c55ad787d2f2c749b81c04d1dc5b57a5f474da6ed94cd9ee1e8d73d` |
| `src/features/cad/kernel/cadKernelTopology.test.ts` | `f0d8ae85f4b3328ac08f47610ed2d290b80fb8b466a96a817859724d6efbca8d` |
| `src/features/cad/kernel/cadKernelGeneratedGear.test.ts` | `3121729ce0f0574326ee82af09d8f58b8163ab13edea5b380df25ff7e7e43cc2` |
| `src/features/cad/kernel/cadKernelLocalResources.test.ts` | `60ec5d437b307078bf0c44caa988571859cd9bc826125da9a450219fa0868bf1` |
| `src/domain/cad/__tests__/cadSectionCapacity.test.ts` | `cfa0f7dd87c369bceb14b71a90ea2b4d6de12fe93442497c19d729552250fcea` |
| `src/features/cad/cadLargePagination.test.ts` | `dda3403ee789a19ca927c74e8508e94df7c225d96a1a7c28446bd450d577221b` |

The retired `cadKernelLimits.ts` module remains deleted. Source is frozen after this review for the parent's production/browser consolidation.
