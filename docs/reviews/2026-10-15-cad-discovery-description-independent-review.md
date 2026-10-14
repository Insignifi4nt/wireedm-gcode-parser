# Independent CAD discovery-description review

2026-10-15; base `fba236e004fb863e29d81bfc029be36b001397ac`, dirty candidate worktree. The reviewed delta is Research's frozen description-only repair, compared against `tmp/cad-region-depth-candidate-source-freeze-before-discovery-repair.json`, not against the older Git base which lacks the candidate's region tools.

**Conclusion: no actionable discovery or execution regression found.** All 45 tools remain available in the same order. Initial registration is **50,770 bytes**, down from 54,587; the existing **51,200-byte** invariant is unchanged. This saves 3,817 bytes and leaves 430 bytes of headroom; it is a bounded text repair, not new capacity for arbitrary future tool expansion.

## Independent parity proof

`tmp/cad-discovery-description-independent.mjs` compares every metadata key, primitive, array order, schema and annotation. Its only allowed differences are string values at `description` paths. It finds 11 top-level tool description changes and two repeated sketch-envelope description occurrences, originating from one definition.

The script independently parses both source files with the TypeScript AST. Each changed literal must be a `tool` call's description argument or a property named `description`. It replaces only those 12 source literals with the previous metadata text; both entire UTF-8 source hashes then equal the prior frozen hashes. This exact reconstruction also proves that imports, handlers, validators, response projection, annotations, bounds, enum values and argument order were not changed by this repair. Report: `tmp/cad-discovery-description-independent.json`, SHA-256 `44E44CEC0D0826FB30E0122CE2503EC12FA73FFEC116833E4663132413F9DC61`.

## Semantic review

Proposed region inspection and chunk reads explicitly remain **source preflight only**, without edits or native work. They require a complete same-ID sketch and/or numeric parameter additions/overrides. Complete authoring schemas are still discoverable with `cad_describe_features(kind=sketch)`; execution's strict full-schema validation is unchanged. Detailed whole-history/atomic-batch/native-build distinctions remain in the public agent guide and the existing edit/build discovery contracts. The descriptions do not promise downstream or native certification from a source proposal.

Exact region references remain the material selector. Omitted references still have a named read operation; UTF-16 chunk concatenation through `nextOffset=null` and identical version/sketch/boundary/proposal ownership remain explicit. The `extrude`/`pocket` feature definitions, unchanged by this repair, explain complete boundary/void/ancestor references, neighbor cancellation, absent whole-sketch behavior and rejection of changed topology.

Viewport registration retains exact collection totals/omissions, version plus viewport-token paging, `STALE_VIEW` refresh and principal-plane glyph identity. Capture still requires current build/reference layers and returns actual browser-local PNG/version/view/SHA-256 metadata; it neither writes CAD storage nor promises a public image URL. Plane, Loft and Sweep descriptions distinguish exact placement/eligibility preflight from native certification and retain complete feature-discovery/build routes. Path/Curve construction retains direction, signed major/minor arcs, closure semantics and the existing strict arguments.

## Verification

Independent Node **24.22.0** runs:

- Full `cadAgentJourney.test.tsx` and `cadSiteTools.test.ts`: **25/25 passed** (two files; 2.32 s), including the unchanged 50 KiB registration guard, complete schemas, envelope-only rejection and actual authoring journeys. Log: `tmp/cad-discovery-description-independent-tests.log`.
- Existing controller cases selected by `preflights proposed source cells|oversized-cell|truthful viewport|pins ID pages|reference visibility`: **8/8 passed**, 109 unrelated cases deliberately excluded (4.63 s). These verify correlated source proposals followed by one atomic public edit, oversized exact reference reconstruction, real receipt budgets, complete viewport-ID reconstruction and stale-token rejection. Log: `tmp/cad-discovery-description-independent-receipts.log`.
- AST/metadata parity proof passes; scoped diff whitespace check passes. The journey test file has no Git diff. Current source/test hashes still match the frozen candidate after verification.

Research separately reports 142/142 across the full Journey/SiteTools/Controller gate and full app TypeScript; that owner evidence is not recounted as this reviewer's run. No product or test files, limits, browser, server, build or commit were changed by this review. Parent owns current-bundle physical QA and the final combined gate.

## SHA-256 snapshots

| File | Current hash | Reconstructed prior frozen hash |
| --- | --- | --- |
| `src/features/cad/cadSiteTools.ts` | `CFE1BD042A09444DE00DB66DF9C33830EE313C680F68FBFF33E13F7022C11CEB` | `3ED21E9C9A6146F7BCA81DE4EA64C1823D0AE23E73D77FEA2952A3B253913E8A` |
| `src/features/cad/cadToolSchemas.ts` | `A666D6E5F959EA2CB19B481F3EC08D72F565A1F8B56BC2294F18557892E823A3` | `6E043329FC74E1F47A3DAD97079DA83C4F581EC3B487718BD0782D538731F8EE` |

Verified test snapshots: `cadAgentJourney.test.tsx` `D81CB467E7319E300B3D091FC0FD66271D04B65F5B8B7A7E43FDDEBC605C990C`; `cadSiteTools.test.ts` `B62C83E3F8EAF3932B14D89174CE7C805FD2E1C8F4E0D3078525D0A05EBF246B`; `useCadController.test.tsx` `CAD70CEEF7F67A2822FB490ED8E27C3418B03B862DD920D3620CB7FC05A9DBFF`.
