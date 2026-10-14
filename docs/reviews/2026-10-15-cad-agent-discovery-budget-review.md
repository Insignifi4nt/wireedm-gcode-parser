# Initial CAD agent discovery budget repair

Date: 2026-10-15. Owner: `/root/sketch_reference_research`. Scope is two existing discovery files only; no tests, budgets, public APIs, argument bounds/enums, validators, handlers, geometry, saved data, migration, browser/server or build changed.

## Actual red and measured repair

The complete region/depth candidate gate passed 4033 cases in 380 files and failed one existing agent-discovery case: `cadAgentJourney.test.tsx:59` measured 54587 UTF-8 bytes against the unchanged 50 KiB/51200 limit. Log: `tmp/cad-region-depth-integrated-unit.log`. This is an actual initial agent-context regression, not a hypothetical performance limit or a source-file import cap.

An isolated catalog measurement invokes actual `cadSiteTools` and serializes the exact test metadata projection (`name`, `description`, `inputSchema`, `annotations`) without invoking any application operation. Before/after reports and complete metadata snapshots are in ignored `tmp/cad-tool-discovery-measure-before.json`/`after.json` and `tmp/cad-tool-discovery-metadata-before.json`/`after.json`.

The repair shortens 11 repeated initial tool descriptions and the same sketch-envelope description repeated by two new tools. Exact initial metadata is **54587→50770 bytes**, removing 3817 bytes and leaving 430 bytes within the existing budget. Full feature semantics/schemas remain available through authoritative `cad_describe_features`; the hosted guide contains the complete region/proposal contract. The compact new descriptions retain exact-reference/chunk guidance, identical version/proposal pinning, read-reference/schema pointers and source-preflight-only meaning. The existing inspection/construction descriptions keep their scope, local units, closed/open behavior and no-native-certification boundary. Viewport/capture descriptions retain exact token paging, stale-summary refresh and current-layer/local-artifact meaning.

| Tool metadata | Before bytes | After bytes |
| --- | ---: | ---: |
| `cad_inspect_sketch_regions` | 2287 | 1542 |
| `cad_read_sketch_region_reference` | 2094 | 1572 |
| `cad_construct_path` | 2039 | 1698 |
| `cad_construct_curve` | 1965 | 1668 |
| `cad_get_viewport` | 1463 | 1157 |
| `cad_capture_preview` | 1097 | 624 |
| `cad_inspect_sweep` | 1050 | 724 |
| `cad_inspect_loft` | 1032 | 716 |
| `cad_inspect_plane` | 894 | 635 |
| `cad_inspect_plugin` | 732 | 633 |
| `cad_get_context` | 498 | 365 |

`cad_edit_document` remains 8118 bytes and plugin installation 1259 bytes, inside their existing separate 8 KiB/2 KiB discovery checks. Tool names/order, annotations and registration schemas excluding their descriptive strings compare exactly before/after. `tmp/cad-tool-discovery-parity.mjs` also reconstructs the preceding two frozen complete source files by restoring only those strings, then independently matches their original SHA-256. This proves that actual strict execution schemas, full feature-authority descriptions, controller checks, reply behavior and authored limits were not altered to satisfy the budget.

## Verification and freeze

Node 24.22.0 `tmp/cad-tool-discovery-budget-green.log`: **142/142 cases in 3 files**, covering the full existing agent authoring journey/budget, tool boundary/discovery and controller suites, 14.52s. Every assertion and test source is unchanged. Full `tsc -b --pretty false` passes (`tmp/cad-tool-discovery-budget-types.log`), and scoped diff checking passes. The broader candidate's geometry/UI cases were not rerun solely for text changes. Parent owns the required reviewed rebuild/browser proof; no candidate bundle is claimed updated here.

Final source is frozen for independent review:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/cadSiteTools.ts` | `CFE1BD042A09444DE00DB66DF9C33830EE313C680F68FBFF33E13F7022C11CEB` |
| `src/features/cad/cadToolSchemas.ts` | `A666D6E5F959EA2CB19B481F3EC08D72F565A1F8B56BC2294F18557892E823A3` |

Preceding frozen hashes restored exactly by description-only reconstruction: `3ED21E9C9A6146F7BCA81DE4EA64C1823D0AE23E73D77FEA2952A3B253913E8A` and `6E043329FC74E1F47A3DAD97079DA83C4F581EC3B487718BD0782D538731F8EE`. All other region domain/API source/test hashes remain unchanged. No overall CAD completion is implied.

Independent tree-owner review is clean: AST source-literal reconstruction restores both complete preceding source hashes; metadata primitive/schema/annotation/order parity differs only in descriptions. Its full Journey/SiteTools gate passes 25/25 and the selected existing controller proposal, oversized-reference, viewport receipt/stale cases pass 8/8. Record: `2026-10-15-cad-discovery-description-independent-review.md`, SHA-256 `EBFA00C5E389454628C5E469B5404308B7C476B8A034FD09D4851692C3FE9FFC`. No product/test edits were made by the reviewer, and the two final production hashes above remain frozen.
