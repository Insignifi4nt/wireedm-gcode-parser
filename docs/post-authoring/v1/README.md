# Machine-package authoring contract

Start with [Create a package in your browser](../../site/authoring.md). Use the [Package workbench](../../site/tools.md) to check posts, calculate hashes, build archives and inspect packages. Downloadable files in this reference define the exact accepted contract.

## Required references

- [SPEC.md](SPEC.md): normative identity, evidence, execution, output and package rules.
- [AGENTS.md](AGENTS.md): instructions for an authoring agent.
- [AUTHORING_TASK.md](AUTHORING_TASK.md): inputs and completion checklist.
- [Post schema](schema/post-package.schema.json): post manifest, dialect, code, evidence and fixtures.
- [Machine schema](schema/machine-definition.schema.json): physical identity and complete post setups.
- [Package document schema](schema/machine-package.schema.json): the JSON document used by **Build package**.
- [Guest SDK](sdk/wire-edm-post-sdk.d.ts): callback API and exact event payloads.
- [Diagnostics and limits](sdk/event-diagnostic-catalog.json): failures and runtime resource limits.
- [Canonical fixtures](sdk/canonical-plan-fixtures.json): available test execution plans.
- [Compatibility](compatibility.json): readable contract versions and fixture IDs.
- [Minimal post](examples/minimal.wireedm-post.json): a structural example, not a production controller fallback.

## Versions

New posts use **post schema v2** and engine API `"1"`. This directory's `v1` identifies the authoring kit/API generation, not an app release. Existing v1 post snapshots remain readable without being rewritten, but they may lack declarations required for execution.

Record `manifest.authoredFor: { appVersion, documentationUrl }` using the app version and versioned documentation link shown in the release notes. Unknown provenance is not automatically incompatible; exact schemas, capabilities and conformance govern execution.

## Completion

Check each post, assemble the complete package document and evidence, build the archive, then inspect the downloaded `.wireedm-package`. Every included setup must bind an exact post ID/version/canonical hash and supply all required properties. Every positive capability and command needs fixtures. Evidence paths are relative archive paths; evidence hashes cover exact file bytes.

The builder rejects incomplete setups, dangling references, mismatched targets, missing/changed evidence, invalid paths and failed conformance. The agent must resolve missing facts with the user. Deliver the archive, editable document, evidence and report; the user installs the archive only.
