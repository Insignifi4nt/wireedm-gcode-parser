# Arc-stop numerical corrections

These corrections ship in app release `0.0.701`, whose release record carries the compatibility warning and checklist below.

## Explicit compatibility warning

Corrected circular stop distances and circle stop/partial-range endpoints change some execution-plan points, source ranges and hashes. Engine-1 and engine-2 saved revisions whose canonical plans change are deliberately rejected, even when their own stored hashes are internally consistent. Old arithmetic is not retained as a compatibility mode. Circular sampling, numerical arc playback and motion-audit corrections can also change displayed positions and whether installed-post circular output passes auditing. Unrepresentable whole-contour boundary stops now fail explicitly. Newly applied rotations/reflections retain coordinate precision, and endpoint tangencies use a local arithmetic bound. Continuous positioning stays threaded in simulation; corrected clearance checks can expose additional warnings.

Installed posts can observe changed circular points, source-range boundaries and different audit acceptance. No physical-controller verification follows from these changes. Inspect affected output and check the exact post's conformance fixtures before machining.

Saved revisions and installed packages remain untouched. A reviewed editable project can create a separate engine-3 revision through the hosted **Generate controller artifact** flow. This is a new revision, not an automatic migration or a promise of byte-identical historical output.

## Compatibility checklist

| Area | Behavior |
| --- | --- |
| App release | Ships in `0.0.701`. |
| Calculation provenance | New revisions and artifacts use saved-job/generating engine `3`. Artifacts retain `sourceRevisionEngineVersion` for accepted engine-1/2 sources. Older apps whose parser accepts only engines `1` and `2` reject new engine-3 revisions on load and verified backup. |
| Schemas and engine API | UPID, post, machine package, execution plan, saved revision and storage schema numbers are unchanged. Post `engineApiVersion` remains `1`. |
| Capabilities and events | Capability declarations and callback vocabulary are unchanged. Serialized motion and stop event shapes are unchanged. Circular source-range values, stop points and partial-range endpoints can change. |
| Audit and output | Circle sampling, circular sweep auditing and simulation interpolation change numerically. Post-owned encoding, line endings, wrappers, numbering and formatting remain authoritative. Source traces and execution-plan hashes can change; controller bytes and audit results can change for affected input. |
| Installation | No package reinstall, replacement, hash update or silent snapshot rewrite. Review affected installed posts through their exact fixtures and artifact diagnostics. |
| Storage and migration | No migration, journal format change, shared-service access or destructive cleanup. Existing engine-1 intent validation remains independent of the corrected arithmetic. |
| Historical loading | Engine `1`, `2` and `3` files require exact corrected canonical-plan and hash matches. An affected engine-1/2 snapshot fails with an explicit warning and hosted recovery instructions, whether the corrected plan differs or can no longer compile. Compile failures include the underlying diagnostic. Unknown engine versions remain rejected. |
| Existing active projects | Startup and catalog ownership checks verify editable projects and revision-file existence. Revision lists read metadata only. An incompatible revision does not by itself block opening an otherwise valid active project. |
| Other consumers | Controller file, inspection and Snapshot JSON actions fully load the chosen revision. Verified backup preparation/restoration and Trash restoration validate every indexed revision. They can fail on preserved old revisions; saving an additional engine-3 revision does not remove that limitation. Trash restoration propagates the parser diagnostic and retains files. |
| Recovery limits | The existing readable recovery export is for retained failed-connection sources. It is not offered for an otherwise healthy connected workbench solely because a revision is incompatible. No automatic historical-revision repair or healthy-workbench recovery download is added. Keep retained originals and existing backups. |

## Focused compatibility verification

Before production warning changes, the saved-revision/catalog suites reproduced eight failures and 55 passes. After implementation, both suites pass all 65 tests, including two additional regressions for historical compile failures and precision diagnostics.

The regression uses the captured old source split `0.4853028997290862` for an accepted radius-1 arc beginning at `0.1` radians with sweep `1e-16`. Corrected compilation splits it at `0.5`. Engine-1/2 snapshots carry a matching stored execution-plan hash yet fail current canonical-plan comparison through both public parse and load operations. Browser-cache and folder tests preserve exact BOM/CRLF originals while persisting a separate corrected engine-3 revision. Compatible engine-1/2 revisions still produce artifacts labelled engine `3` and retain their original source version. Engine `4` remains unsupported.

The Trash restore regression invokes real save, delete, parse and restore operations, checks the displayed incompatibility message and verifies that failed restoration performs no file writes or deletions. This verification is local and does not migrate any real user workbench.

The full local suite passes 2,553 tests in 225 files. TypeScript/build, UPID conformance, both post conformance sets, exact Robofil package validation, documentation contracts and release-record checks pass. The [numerical correction review](../reviews/2026-10-11-arc-stop-numerical-corrections.md) records broader validation, independent review findings and remaining limitations.
