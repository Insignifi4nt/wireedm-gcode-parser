# Compatibility and repairs

## Four independent versions

| Version | Meaning |
| --- | --- |
| App release, such as 0.0.686 | One reviewed PR release; linked to a source tag and compatibility checklist |
| UPID schema | Serialized manufacturing intent; v2 adds after-positioning stops and separation during positioning |
| Post schema | Serialized post manifest and dialect; new posts use v2 exact separation declarations |
| Engine API / authoring kit | Guest callback contract and publication generation; currently `1` |

Do not replace schema numbers with app versions or assume adjacent app releases are compatible. Check the release ledger, exact capabilities and conformance results. `manifest.authoredFor` names the author's target app and versioned docs. An absent field means unknown provenance. No app-version range or physical-machine compatibility is inferred from it.

## Known changes introduced before app version tracking

- **Wire separation:** schema-v1 booleans remain readable, but do not authorize a specific mechanism. Schema v2 requires an array containing only supported methods: `manual-before-positioning`, `automatic-before-positioning`, or `automatic-during-positioning`.
- **Arcs:** arc commands require explicit `arcDirection`. A legacy package can remain stored yet be rejected for arc execution or installation conformance.
- **Motion audit:** positions and centers are checked after controller formatting and quantization. Rounded geometry that violates the audit must be resolved explicitly.
- **Saved revisions:** old engine snapshots keep their original hashes. If recompilation changes their plan, review the project and save a new revision before generation.

These are documented as baseline restrictions in app 0.0.685, not newly introduced by the documentation release.

## When export fails

Use **Copy agent repair prompt** in the error panel. Review the text before sharing it. It carries the app version, exact selected post reference, capabilities, output rules, machine/controller identity, setup properties, diagnostics and source pointers. It does not contain the full project geometry, source package or evidence files; supply those separately if reproduction requires them.

A capability error can mean either an older declaration or genuinely unsupported controller behavior. Do not merely add a capability flag to silence it. Verify the controller evidence, event handler and fixtures first. For the reported Robofil cut-on-rapid case, 2.4.0 used a broad boolean; 2.5.0 declares automatic separation during positioning. The 2.6.0 metadata release adds app provenance without changing controller output.

For package parsing/installation failures, run the package validation CLI and give the agent its JSON report plus the source folder. For revision or project-intent errors, inspect the UPID/compiler diagnostics before changing a post.

## Updating a package

Publish changed content under a new post version. Recompute its canonical hash, update the setup's exact reference, build the whole machine package and run conformance and archive validation. Install and activate the new setup explicitly. Never overwrite old package versions or historic revisions.

An app deployment does not replace locally installed machine packages. The app remains controller-neutral; there is no privileged Robofil upgrade path.
