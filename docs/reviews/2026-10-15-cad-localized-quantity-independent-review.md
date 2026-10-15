# Independent review: localized nonzero CAD readouts

2026-10-15; bounded read-only review of the frozen localized follow-on against `70f45e978c77c67cc3f6f73e2822c5684daba11d`. **No actionable defect found.** This completes this review only. The earlier 18-path UI and two-path diagnostic reviews remain historical, with their exact manifests and evidence retained. The native Copy candidate is disjoint and uninstalled. Root owns fresh application/native/browser and complete CI verification; this reviewer made no owner source/test, build/server/browser, package or commit changes.

## Behavior and precision boundaries

The localized helper retains each caller's original native Intl policy: three fraction digits for Sketch measurements and solid volume, four for Curve measurements, five for inspected topology, and eight with grouping disabled for parameter/local-input readouts. Omitted grouping remains omitted. Cached formatters use the loaded realm's default locale; the current CAD UI has no dynamic number-locale preference. The finite, fixed internal caller styles do not depend on document size, geometry or user-provided formatting options.

Fallback compares the actual native label against that same formatter's positive and negative zero labels, including localized signs and digits. Only a nonzero value actually erased by that policy gets native scientific notation with six significant digits. True zero/negative zero keep their existing localized labels; ordinary values and native half-rounding boundaries keep the original text. There is no guessed decimal threshold, tolerance change, numeric rounding of stored data or sign parsing. The existing compact six-decimal helper and depth label rule are unchanged.

Curve and topology vector callers retain one-argument wrappers with fixed precision, so Array.map's index cannot become formatting precision or grouping. Parameter list/local-input outputs use the new helper, while the parameter editor still opens with full `String(parameter.value)` and retains raw draft text. Measurement resolution, topology requests/selection, accepted geometry, scalar aliases, candidate/history behavior, native/API values, SVG coordinates and preview identities are untouched. Cursor, date and file-size formatting are outside this change.

The new regressions exercise accepted tiny sketch width/area, nondegenerate Curve length/placement with ordinary fractional world coordinates, inspected edge summary/coordinates/list, signed tiny named angles and positive thin-Pad volume. They retain exact session/source/descriptor data and Cancel assertions. Topology/build responses use the existing DOM-suite stubs; the volume fixture establishes analytic expected volume and presentation behavior, not an additional native thin-solid certificate. Parent's actual prior-bundle evidence of Area0/Width0 is recorded in `2026-10-15-cad-face-quantity-browser-checkpoint.md`; fresh fixed-bundle proof remains parent-owned.

## Independent checks

Node **24.22.0**:

- The original ignored five-red fixture was rerun **byte-for-byte unchanged: 5/5 pass**, 3.73 s; `tmp/cad-localized-quantity-original-independent-green.log`. Fixture SHA-256 `DE620D7F367372CF57355C9FF92346935127B0E2954D9C5F3EEA76CA66C8F407`; original red log `6B0F8AEC5AAD5E1469A1AE70972B53944FEA7B1796BEC5B79234596F51CA0573` remain exact.
- **137/137 in eight complete affected suites**, 9.54 s; `tmp/cad-localized-quantity-independent-focused.log`: Measurements, ParametersPanel, TopologyInspector, Workbench, display helper, prior QuantityReadouts, depth helper and delayed public-capture locks. Three locale cases cover en-US/de-DE/ar-EG, all four fraction policies, default/disabled grouping, true ±0, ordinary signed values, native half-rounding boundaries and signed erased values. Counts overlap original/targeted regressions and are not summed.
- Full app `npx tsc -b --pretty false` exits **0**, with empty `tmp/cad-localized-quantity-independent-type.log`. Scoped whitespace check passes.

All **27 changed + 12 protected + three preserved-manifest** hashes match `tmp/cad-final-spec-localized-source-freeze.json`, SHA-256 `FC8ED6CEED59FFFED5BE9FA17AD50A6D41E9ECBC1306ADEA97667AD60E1FCD6F`. Protected renderer/capture/controller/tools/schema/operations/native/E2E/config/packages are also Git-identical to the base. All 16 unaffected prior-stage source/test paths match the preserved 20-path manifest; only helper/test and Workbench/test are superseded. Both original prior-stage red evidence hashes and the prior independent record remain unchanged. The first prior-manifest check addressed a nonexistent `changedFiles` property and counted zero; it was corrected to the actual `files` array, explicitly required 20 entries and verified the expected 16 preserved paths.

| New-stage file | Reviewed SHA-256 |
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

Owner record SHA-256: `5C7C3EA8FD8A4429D8BDB568C637E7C1B99C0C8ABD8109EE301E73BB65ECF55D`. No physical browser/native success or complete new-head CI is inferred from these source, DOM and type checks. No further review expansion is required for this frozen slice; the overall CAD goal remains active.
