# Wire EDM Machine-Package Authoring Contract v1

This directory is the versioned, agent-readable contract for producing the only artifact a human installs: a complete `.wireedm-package`. A package contains one physical machine definition, one or more exact post processors, every complete machine setup that binds them, controller-file rules, evidence, and fixtures. The TypeBox sources under `src/domain/` are authoritative for serialized shapes; files under `schema/` are generated views and must not be edited directly.

Generate or verify them with:

```text
npm run post:docs:generate
npm run post:docs:check
```

Current contents:

- `SPEC.md` is the normative interoperability, safety, evidence, lifecycle, and determinism contract.
- `schema/machine-package-source.schema.json` validates the small authoring manifest used by the build command.
- `schema/machine-package.schema.json` validates the complete document stored at the archive root.
- `schema/post-package.schema.json` validates `.wireedm-post.json` authoring documents embedded by a complete machine package.
- `schema/post-library.schema.json` validates the local persisted post library.
- `schema/machine-definition.schema.json` validates portable physical-machine definitions and exact post setups (serialized as `bindings`).
- `schema/machine-library.schema.json` validates the persisted machine collection. Package-specific property and reference checks are additionally enforced when it is loaded with the post library.
- `schema/workbench.schema.json` validates the version-3 workbench catalog. Export byte rules are deliberately absent because posts own them.
- `schema/workbench-project.schema.json` validates machine- and post-neutral editable project state.
- `sdk/wire-edm-machine-package.d.ts` and `sdk/wire-edm-machine-package-source.d.ts` are generated declarations for serialized package documents and source-folder manifests.
- `sdk/wire-edm-post-sdk.d.ts` defines the complete guest callback API and event payload types.
- `sdk/event-diagnostic-catalog.json` publishes event kinds, runtime diagnostic codes, denied globals, and the exact default resource limits.
- `sdk/canonical-plan-fixtures.json` publishes every execution plan available to the installation conformance runner.
- `sdk/canonical-installation-scenarios.json` publishes reproducible valid, invalid-target, machine-update, post-conflict, and same-machine/new-post fixture recipes with their required outcomes.
- `compatibility.json` lists exact supported contract versions and fixture IDs. It does not claim controller or firmware compatibility.
- `AUTHORING_TASK.md` is a copyable input and completion contract for an authoring agent collaborating with a human.
- `examples/minimal.wireedm-post.json` demonstrates the smallest conformant custom package. It is not a production post and MUST NOT be used as a dialect fallback.
- `../../../examples/robofil-100-v2/` contains a complete source directory and built Robofil 100 V2 candidate package. It has no privileged runtime path and is never selected automatically.

Every package runs through the same isolated public runtime and must pass its declared fixtures against the canonical fixture registry before installation. The application has no built-in controller renderer, registered package hash, package-key dispatch, or fallback post.

Installation-scenario paths are resolved from this authoring-kit directory. Their JSON Pointers apply to the resolved machine-package document, after source files have been loaded; `recomputePostHashAndBindingReference` means recompute the changed post's canonical hash and update the corresponding exact machine binding before evaluating the scenario.

## Required source directory

Place `machine-package.source.json`, the referenced machine file, all referenced post files, and every evidence file beneath one directory. Paths are normalized relative POSIX paths and cannot escape or traverse symlinks outside that directory. The source manifest names files; the built archive embeds their validated contents and generates `wireedm-package.json`.

The machine file MUST already contain a complete setup for every included post. Each setup binds the exact post ID, version, and canonical content hash and supplies every required post property. `activeBindingId` MUST select one included setup. A new post for an existing machine still ships in a complete machine package; the installer detects the existing physical machine and asks whether to add the setup to it.

## Authoring commands

Run all checks before requesting installation:

```text
npm run post:docs:check
npm run post:conformance -- <source-directory>/<post-file>.wireedm-post.json
npm run machine-package:validate-source -- <source-directory>
npm run machine-package:build -- <source-directory> [output.wireedm-package]
npm run machine-package:validate -- <output.wireedm-package>
npm run machine-package:inspect -- <output.wireedm-package>
```

The conformance command prints one JSON report and exits non-zero on invocation, package-validation, runtime, determinism, audit, fixture lookup, or expected-output failure. It accepts exactly one package path. It does not rewrite the package or expected program.

The machine-package build performs the same validation as installation and emits a deterministic ZIP archive. An archive MUST be no larger than 33,554,432 compressed bytes, MUST expand to no more than 67,108,864 bytes in total, and MUST contain no more than 2,048 entries. Validation rejects a missing requirement, dangling setup, post version collision, unmatched target, missing or changed evidence, path traversal, unreferenced payload, failed fixture, unsupported archive, or exceeded limit. The human installs only the resulting `.wireedm-package`; loose machine and post JSON files are authoring inputs, not user-facing installation units.

The conformance runner executes every declared fixture. It rejects an unexercised command, an unexercised positive capability claim, and missing boolean, choice, or bounded-number property cases. It also requires final `program.ended` state, final `compensation.off` state for a declared compensation lifecycle, and final wire state consistent with the last thread or separation event. The current canonical registry exposes only the fixture IDs in `compatibility.json`. The runner does not infer string-property boundary coverage, every lifecycle branch, or known controller failures. An author and reviewer MUST enforce those remaining requirements. If the registry lacks a plan needed to demonstrate claimed behavior, the package is incomplete and the agent must report that blocker instead of claiming conformance.

Every number parameter declares its spelling in the command vocabulary. Version 1 supports fixed fractional digits, a `.` or `,` decimal separator, optional trailing-zero trimming, and explicit negative-zero handling. Fractional digits may be a fixed integer or an exact integer binding property constrained to the inclusive range 0 through 12. Motion audit uses the formatted, quantized endpoint and center values and carries the previous emitted endpoint forward. A controller requirement outside this closed format schema is not representable in v1 and must be reported instead of approximated. `suggestedValue` fields never supply a missing property. The minimal example uses two fixtures because both declared precision boundaries must execute.

Circular commands declare package-owned `arcDirection`: `clockwise` or `counterclockwise`. The selected command supplies the audited controller direction. Older v1 packages without this field remain readable with their original hashes, but arc execution and installation conformance reject them; publish a new post version and setup instead of rewriting stored packages. `emitCommand` is only for non-moving commands; motion roles, arc direction, and `position.changed` require `emitMotion` during a motion or positioning event.

If required evidence, machine identity, physical limits, output rules, setup properties, controller behavior, or verification facts are missing, the authoring agent MUST ask the human to attach or point to them. It MUST NOT invent a requirement or build a partial package. Agent authors must also follow this directory's `AGENTS.md` and any scoped repository instructions.
