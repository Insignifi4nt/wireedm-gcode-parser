# G-code inspection review

## Product boundary

The G-code workspace reviews posted text. UPID remains the authoring model for geometry, machining intent, execution readiness and saved revisions. One shared, read-only inspector serves standalone file/paste input, the existing Machine Program draft, and generated controller artifacts. It does not convert arbitrary controller text into UPID or add another machining workflow.

Standalone inspection creates no project. Editable imports retain their cleanup and storage pipeline, and their inspection context explicitly identifies the editable copy. Controller inspection uses the exact generated text, verifies matching post/machine/setup/property hashes, and carries the saved revision context. Saved revisions reproduce output from their own snapshots. Download retries reuse the inspected artifact.

## Interpretation and interface

- A shared command catalog replaces duplicated recognition lists. Recognition, modeled XY behavior, controller-specific meaning and unknown commands are distinct.
- G39 is visible in generic inspection without a universal meaning. Exact post context supplies scoped command effects and arc-center declarations; it does not authorize arbitrary unknown movement.
- Source order, comments, block numbers, wrappers and line endings survive inspection. File decoding preserves the UTF-8 BOM and refuses lossy decoding.
- Source search, command occurrence filtering, source-line navigation, arrow/Home/End navigation and linked preview selection support quick checks. Selected lines expose before/after modal state, diagnostics and interpretation limits.
- Unsupported coordinate blocks, cycles, macros, conflicting modes and coordinate resets cannot silently inherit motion or connect across unknown positions. Extreme numeric extents cannot produce an invalid SVG view box.
- The interactive source limit is 2 MiB / 50,000 lines. Source and command lists are paged, issue rendering is bounded, and large path rendering explicitly discloses its limit. Oversized generated artifacts remain downloadable.
- The inspector loads on demand and reuses the existing preview. Ordinary import parsing does not allocate inspection line snapshots. Diagnostic deduplication uses a set rather than repeated scans.

## Review and regression evidence

Independent source review and executable probes found and resolved inherited unsupported motion, partial coordinate resets, G92 connections, numeric extent overflow and cross-page keyboard focus. Source preservation, exact artifact context, bounded rendering and asynchronous download retry were reviewed separately from implementation.

The integrated regression suite passed 209 files / 2,092 tests. Existing assertions were retained, including the source-bearing malformed-command warning in the original editor. Production TypeScript/build, generated post documentation parity, 26 documentation pages / 84 files and STEP source distribution passed. Three UPID fixtures, all three unchanged Robofil 2.6.0 post fixtures and complete package validation passed. Final review also caught a same-setup Generate action racing a pending inspection; a shared availability guard now prevents it. The delayed-promise regression preserves exact artifact/context/download assertions, and the final 19-test controller-dialog suite and TypeScript pass.

The final native Chromium batch passed all 29 cases: standalone files/paste, compact inspection, the Machine Program draft, original editor layouts and import/save/reload/export, UPID round trips, complete package installation and both controller inspection entry paths. Exact downloads match byte-for-byte and inspection leaves persisted cache files unchanged. Export/revision dialogs stay within 360 pixels and existing editors retain their 320/767-pixel layouts. One new draft assertion initially queried the collapsed Program Text section; the test now opens that section through its existing UI before reading the draft. All original layout assertions remain intact.

## Compatibility

App release 0.0.695 changes no post/package/UPID/engine/storage schema, controller output rule, installed package or saved revision. Shared external G-code preview interpretation is more conservative; programs previously drawn speculatively may have omitted fragments or warnings. The release record and UI diagnostics disclose this behavior change. Inspection is a nominal XY trace, not controller execution verification.

No additional WebMCP tool is introduced. The pure inspection operation and artifact-context adapter are reusable domain APIs; existing exact artifact read/download tools retain their contracts.
