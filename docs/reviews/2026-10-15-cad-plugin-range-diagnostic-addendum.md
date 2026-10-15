# Exact dynamic plugin-range diagnostics

Separate two-path addendum against `70f45e978c77c67cc3f6f73e2822c5684daba11d`, 2026-10-15. The frozen18-path face-scope/quantity UI repair is unchanged; its manifest remains SHA`5F80C9CED1CF9F7050E73FD6C47820926D0DEDC28D751F74AC47974AA765BF0E`.

## Proven failure and minimal change

A valid parsed API2 polygon recipe uses a named machining allowance and derives its permitted interval from the nominal outer radius: minimum2e-7, maximum4e-7 mm. The accepted allowance3e-7 produces an actual first vertex at30−3e-7, with the exact ` allowance ` relation stored. Requesting1e-7 is correctly rejected by the same shared rules, but the original error said **“Machining allowance must be between0 and0.”**

The new regression was written and run before editing product code. It failed exactly that message (`tmp/cad-plugin-diagnostic-range-red.log`,23ms test work), after checking valid package/default geometry and exact numerical field bounds. This is a real finite derived interval, not an invalid package or a display-only fake value.

The one-line production repair interpolates exact resolved minimum/maximum values in the dynamic API2 error, matching static-range diagnostics. It adds no feature-layer formatter import or other dependency. Range evaluation, clipping, enabled conditions, comparisons, issues structure, recipe geometry, package/default validation, schema, transport and stored/API scalar quantities are unchanged. No tolerance, precision or capacity policy is altered.

The completed regression also verifies the rejected linked edit retains the identical accepted snapshot/history, the exact upper boundary4e-7 is accepted with the original alias/package intact, and one Undo restores original document data. The embedded package JSON remains unchanged.

## Verification and freeze

Node24.22.0: all **57/57 cases in three complete suites** pass: `cadPluginRules`, `cadPlugins`, `cadPluginStorage` (`tmp/cad-plugin-diagnostic-range-full-green.log`,3.80s). Full app TypeScript and scoped diff check pass (`tmp/cad-plugin-diagnostic-range-type.log`, empty/exit0). No build, browser, server, commit, push or native-copy candidate installation occurred.

`tmp/cad-plugin-diagnostic-range-source-freeze.json` records this separate addendum, the red/green logs and byte-verification of all18 unchanged UI paths:

| Changed file | SHA-256 |
| --- | --- |
| `src/domain/cad/plugins/cadPlugins.ts` | `E3FFBB72D07289A87AA53E9C16D4E5D4F98CF393D8CAD193042E73F4AAEB3C3E` |
| `src/domain/cad/__tests__/cadPluginRules.test.ts` | `44081D445F393FA473FFD958E1242CFA8B6CF8936E8837891B48FBD7FB7B1E8F` |

Production/test sources are frozen for independent review and the parent's combined verification. This record does not replace the green70f45 historical checkpoint or approve the larger pending candidate.
