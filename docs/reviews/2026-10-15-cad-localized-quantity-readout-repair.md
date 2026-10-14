# Localized nonzero CAD readouts

2026-10-15; follow-on to the frozen18-path UI and two-path dynamic diagnostic repair against `70f45e978c77c67cc3f6f73e2822c5684daba11d`. Parent's prior20-path bounded full gate passes386files/4,094cases in265.59s, unchanged original assertions/timeouts with two workers (`tmp/cad-face-quantity-complete-unit-bounded.log`). Its production/docs checks and actual face Fillet/Chamfer refusal/toast/history proofs remain valid for that stage. The earlier all-worker run's one storage timeout during a concurrent build is retained separately; its unchanged standalone storage rerun passes. This repair neither replaces that evidence nor treats it as certification of the new stage.

## Actual defect and test-first proof

Parent's fresh production UI showed width4e-7 correctly in the repaired annotation/list, while localized Sketch measurements still reported **Area0mm²** and **Width×height0×20mm**. Exact accepted area is8e-6mm². Actual retained worktree receipts/screenshot/fixture: `tmp/cad-face-quantity-linked-readouts.json`, `tmp/cad-face-quantity-linked-annotation.png`, `tmp/cad-face-quantity-browser.cad.json`. Their SHA-256 hashes are respectively `2F21208F6DB905A52041CD03E3C7851C518FE5F48A05A4EE1A944DABAAC4D60C`, `0BC01C49AC9CD82CFDF595EC5F482C6FF839F7D139C7A21C864237C6C1B4CA11` and `E1B21C4DFD273B3AB5798BC54AAA7E51D60B94C4B94B6556C249EC3A5F7E1A1C`.

While the parent's20-path gate was running, tracked sources/tests stayed unchanged. Five ignored mounted probes failed on the localized sketch, curve, inspected topology, parameter and volume readouts (`tmp/cad-localized-quantity-readouts-red.log`;217ms test work). After the source hold was released, six meaningful cases were promoted into existing Measurement, Parameter, TopologyInspector and Workbench suites and failed before production changes (`tmp/cad-localized-quantity-tracked-red.log`). The extra case covers a negative tiny named angle. Source/session acceptance and exact underlying quantities are verified; topology/build responses use the existing DOM suite stubs, so those cases do not claim new physical/native proof.

The fixtures cover a4e-7-wide20mm rectangle and its8e-6 area, a short nondegenerate Curve with tiny placement and ordinary fractional world coordinates, an exact nonzero edge descriptor, valid named ±4e-9° slot angles, and the positive analytic8e-5mm³ volume of a thin Pad. Ordinary curve coordinates require the same four-decimal policy at each vector index, catching accidental `.map` callback-index leakage. Raw parameter edits remain `4e-9`/`-4e-9` and Cancel creates no history.

## Minimal display-only repair

The small canonical module now also exposes `formatCadLocalizedQuantity(value, maximumFractionDigits, useGrouping?)`. Each caller retains its exact old Intl policy: Sketch measurements and solid volume3fraction digits, Curve measurements4, TopologyInspector5, parameter/local-input readouts8with grouping disabled. Default grouping is left unspecified, preserving the locale's own policy rather than forcing grouping.

The helper caches the fixed formatting styles and their localized positive/negative zero labels. It formats the actual value with that native policy and only falls back when a nonzero value's resulting text equals one of those zero labels. A cached native scientific formatter then reports up to six significant digits. There is no guessed `toFixed` threshold, geometry tolerance or decimal-rounding rule. True0/−0, ordinary grouping/fractions/signs and values at native rounding boundaries retain their prior text. No new preference, user-configurable formatter framework or size policy is introduced. The cache follows the default locale of the loaded JavaScript realm; the app has no dynamic locale preference.

Vector callers keep explicit one-argument wrappers with fixed precision, so `.map` cannot supply an index as precision/grouping. The helper is used solely in human measurements/metadata/output text. Editable text, scalar math, source/package originals, API/native quantities, preview keys, SVG/geometric serialization, cursor's two-decimal location caption, dates and file-size displays are untouched. The original six-decimal helper/depth behavior is unchanged.

## Verification and evidence boundaries

Node24.22.0 targeted nine cases pass: six promoted readout workflows and three native-locale groups (`en-US`, `de-DE`, `ar-EG`). Each locale checks3/4/5/8fraction policies, default versus disabled grouping, true±0, positive/negative ordinary values, half-rounding boundaries and positive/negative erased values against native Intl output (`tmp/cad-localized-quantity-targeted-green.log`). These groups also exercise retained cached styles across values.

Eight complete affected suites pass **137/137**,9.72s: Measurements, ParametersPanel, TopologyInspector, Workbench, canonical display helper, prior QuantityReadouts, depth helper and delayed public-capture lock regressions (`tmp/cad-localized-quantity-full-focused.log`). Full app TypeScript and scoped whitespace checks pass (`tmp/cad-localized-quantity-type.log`, empty/exit0). No broad repeated gate, browser, server, application build, commit, push or native-copy installation was performed by this owner. Parent owns fresh actual UI/native and final combined gate.

## Fresh combined27-path freeze

`tmp/cad-final-spec-localized-source-freeze.json` SHA`FC8ED6CEED59FFFED5BE9FA17AD50A6D41E9ECBC1306ADEA97667AD60E1FCD6F` lists all27 combined source/test paths, protected unchanged sources and logs. This stage changes11paths: four prior-stage helper/Workbench source/test hashes, plus four implicated readout components and three existing suites. The other16 prior-stage paths are byte-identical.

Historical artifacts are preserved unchanged:18-path freeze SHA`5F80C9CED1CF9F7050E73FD6C47820926D0DEDC28D751F74AC47974AA765BF0E`; two-path diagnostic freeze SHA`D0573D1A9F34023575F798295D9D68C9DC7CEB7AE7CDCE0DDE8FA8350820DCCA`; parent's20-path combined freeze SHA`EECB37C5379169E179125196C458F52D2B9752413527A6177921DAA6C884846F`. Their prior independent review and green gates remain scoped to those earlier hashes.

| New-stage file | SHA-256 |
| --- | --- |
| `CadWorkbench.tsx` | `5C47A3248EE3A77C1670BA11816831A236BDA566A0DF3C3BDF1A23E8EC041CC6` |
| `CadWorkbench.test.tsx` | `278577443911B22E57B519DF161D63A73A3479F6FC209B30E998255ECB137C89` |
| `cadDisplayQuantity.ts` | `816B1206B3491BE1B615ADE840277B90F7B380B546387EBE51368215B39A856A` |
| `cadDisplayQuantity.test.ts` | `2A05858272A3F0B57736DFE29C99F31E658FFDFFC683D3DB8F13977B9F7B27C8` |
| `CadSketchMeasurements.tsx` | `BCD71228806B4CD5E494EEF399D13315C153C7161D4F94D960F89199397E7F49` |
| `CadCurveMeasurements.tsx` | `1816401BFBF41644CF39D6C340F20CCE2461F9C9737BE1878BC290A0667DD9DA` |
| `CadTopologyInspector.tsx` | `C6393F7EF2E745338D9DC83EA7D8F3B48D595FE781BDD747CDCA7A4E5649E7E2` |
| `CadParametersPanel.tsx` | `6403C57A89CA942EEFAC39F9AFDF094D981A9629F2C46D28FE572AEAA6278FC8` |
| `CadMeasurements.test.tsx` | `C7E055219AFF5E12FB7B61192293217601720487CAFE8EF4D3E5F88618E33887` |
| `CadTopologyInspector.test.tsx` | `B2864AC4B35523668081570B2C6F693707A9ECEE5A50B25213A09D3AE2DFCA0D` |
| `CadParametersPanel.test.tsx` | `87E2D17CFFA51921DA105AC2E9EF144F8BC192DA148F632B0D28E05A7B363040` |

All new-stage product/test sources are frozen for independent review. The original ignored localization red probe/log are retained at SHA`DE620D7F367372CF57355C9FF92346935127B0E2954D9C5F3EEA76CA66C8F407`/`6B0F8AEC5AAD5E1469A1AE70972B53944FEA7B1796BEC5B79234596F51CA0573`. The larger CAD goal remains active.
