# CAD plugins and parametric gear verification

Local changes on `feature/parametric-cad-workbench`, extending the unreleased 0.0.697 CAD workspace. No merge or deployment is claimed. Pre-existing datum/Sweep changes remain in this worktree.

## Behavior

Plugin profiles embed an exact API 1 package and scalar inputs. The bundled involute spur gear and installable bounded polygon recipes resolve through existing sketch geometry checks. Package installation preserves exact supplied source, rejects conflicting ID/version originals, and uses existing journaled storage in browser cache and folder adapters. Browser authoring and agent installation use shared validation and mutation guards.

Gear module, teeth, pressure angle, profile shift, backlash, bore and thickness can be driven by named part parameters. Cutter presets require explicit selection between the two numbering conventions; no Romanian cutter convention is assumed. Flanks approximate involutes within the specified tolerance. Radial root extensions do not reproduce generated trochoids or fillets; this limitation appears in the editor, exported sketch DXF and sketch-to-CAM diagnostics.

## Evidence

- Focused plugin, storage, controller, UI and CAD retention checks: six files, 139 passing tests; subsequent controller/UI rerun: three files, 84 passing tests.
- Broad CAD run: 1,022 of 1,023 tests passed. The existing large topology-budget kernel test exceeded its 20-second timeout during the parallel run; its isolated rerun passed in approximately eight seconds. This is not a clean broad-suite result.
- Final portable-handoff regression: ten plugin tests pass, including parsing the generated CAM document through the actual portable UPID validator. Live transfer exposed an unsupported diagnostic details property; removal preserved the existing UPID schema and warning message.
- Final production TypeScript/build, documentation/schema parity across 92 files and corresponding-source distribution pass after the diagnostic correction. Release compatibility validation passed.
- In-app browser: installed a real recipe package, retried the same version idempotently, reopened the durable saved gear, changed 18 teeth to 36 and built one solid, then restored 18 with Undo. Sketch-to-CAM created a separate saved project with gear outline and bore. Its diagnostics visibly retain the gear approximation note. Returned to the saved CAD part and left its parameters visible.

## Compatibility checklist

- Existing posts, controller output, UPID, machine packages and saved CAM revisions are unchanged.
- Plugin profiles extend the unreleased CAD document union; earlier preview readers reject this new arm.
- Installed package versions and saved parts are never silently updated.
- Storage remains additive under `cad/plugins`; full CAD backup/restore and retention cover installed packages.
- API 1 permits bounded polygon recipes and a trusted built-in gear implementation. It is not a general executable custom-feature language.

Independent review and the normal reviewed pull request remain required before shipping.
