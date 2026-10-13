# Compatibility and repairs

## Independent versions

| Version | Meaning |
| --- | --- |
| App release, such as 0.0.686 | The app used to author/check a package; linked to versioned documentation and compatibility notes |
| UPID schema | Serialized manufacturing intent; v2 adds after-positioning stops and separation during positioning |
| Post schema | Serialized post manifest and dialect; new posts use v2 exact separation declarations |
| Engine API / authoring kit | Guest callback contract and publication generation; currently `1` |
| Saved-job / generating engine | Calculation provenance for saved revisions and controller artifacts; currently `3`, independent of engine API `1` |

Do not replace schema numbers with app versions or assume adjacent app releases are compatible. Check the release ledger, exact capabilities and conformance results. `manifest.authoredFor` names the author's target app and versioned docs. An absent field means unknown provenance. No app-version range or physical-machine compatibility is inferred from it.

## Known changes introduced before app version tracking

- **Wire separation:** schema-v1 booleans remain readable, but do not authorize a specific mechanism. Schema v2 requires an array containing only supported methods: `manual-before-positioning`, `automatic-before-positioning`, or `automatic-during-positioning`.
- **Arcs:** arc commands require explicit `arcDirection`. A legacy package can remain stored yet be rejected for arc execution or installation conformance.
- **Motion audit:** positions and centers are checked after controller formatting and quantization. Rounded geometry that violates the audit must be resolved explicitly.
- **Saved revisions:** old engine snapshots keep their original hashes. If recompilation changes their plan, review the project and save a new revision before generation.

These are documented as baseline restrictions in app 0.0.685, not newly introduced by the documentation release.

## Arc-stop calculation compatibility

Engine `3` uses accepted source lengths and resolved source positions to split circular motions at remaining-cut program stops. It corrects circle stop and partial-range endpoints, circular sampling, numerical arc playback and output-audit calculations. Extremely small remaining cuts that cannot represent a position inside the contour are rejected with a precision diagnostic. Newly applied rotations and reflections retain more coordinate precision, and valid endpoint tangencies use a bounded arithmetic check. Simulation keeps continuous positioning threaded and can report clearance warnings that were previously missed. Installed posts can receive different circular points and source-range boundaries, and their circular output can receive a different audit result. Check the affected controller artifact and the exact post's fixtures before machining. Use **Validate post and run conformance** in the [Package workbench](tools.md) when reviewing a supplied post.

An engine `1` or `2` saved revision is readable only when its plan and hashes still match corrected compilation exactly. A changed historical plan can report `SAVED_REVISION_EXECUTION_PLAN_MISMATCH`; a project that cannot compile under the corrected calculations can report `SAVED_REVISION_EXECUTION_PLAN_INVALID` with its compiler diagnostics. Both block controller generation, inspection and **Snapshot JSON** download. The app preserves its original bytes and hashes. It does not migrate historical arithmetic or rewrite installed machine packages. Saved-revision and post schema numbers, capabilities, engine API `1` and execution-event shapes remain unchanged. Earlier apps that only accept engines `1` and `2` cannot read a new engine `3` revision.

For an active project, open its editable project from the library, review circular geometry and program stops, save the project, then choose **Generate controller artifact**. This creates a separate engine `3` saved revision. Review the resulting output before machining. The old revision stays retained; a new revision does not restore its previous reproducibility.

Verified backup and backup restoration validate every indexed revision, so an incompatible historical revision blocks them even after a new revision is saved. Restoring its project from Trash also fails with the revision diagnostic and keeps the retained files. Use **Settings → Storage → Capture and download recovery export** to copy readable originals from the connected workbench. This copy includes retained historical revisions, reports omissions and cannot be loaded with Restore. No automatic historical-revision migration is provided. Keep existing backups and retained originals. Do not delete or edit historical revisions to bypass validation.

## When export fails

Use **Copy agent repair prompt** in the error panel. Review the text before sharing it. It carries the app version, exact selected post reference, capabilities, output rules, machine/controller identity, setup properties, diagnostics and source pointers. It does not contain the full project geometry, source package or evidence files; supply those separately if reproduction requires them.

A capability error can mean either an older declaration or genuinely unsupported controller behavior. Do not merely add a capability flag to silence it. Verify the controller evidence, event handler and fixtures first. For example, a legacy `wireSeparation: true` declaration does not establish which separation method the post implements.

For package parsing/installation failures, use **Inspect package** in the [Package workbench](tools.md) and give the agent its JSON report plus the package. For revision or project-intent errors, inspect the UPID/compiler diagnostics before changing a post.

## Updating a package

Publish changed content under a new post version. Recompute its canonical hash, update the setup's exact reference, build the whole machine package and run conformance and archive validation. Install and activate the new setup explicitly. Never overwrite old package versions or historic revisions.

An app update does not replace locally installed machine packages. Install and activate a new setup explicitly when required.
