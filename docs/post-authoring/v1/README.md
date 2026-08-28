# Wire EDM Post Authoring Contract v1

This directory is the versioned, agent-readable release of the post package contract. The TypeBox sources in `src/domain/post-processor/` are authoritative for serialized shapes; files under `schema/` are generated views and must not be edited directly.

Generate or verify them with:

```text
npm run post:docs:generate
npm run post:docs:check
```

Current contents:

- `SPEC.md` is the normative interoperability, safety, evidence, lifecycle, and determinism contract.
- `schema/post-package.schema.json` validates installable `.wireedm-post.json` documents.
- `schema/post-library.schema.json` validates the local persisted post library.
- `schema/machine-definition.schema.json` validates portable physical-machine definitions and exact post bindings.
- `schema/machine-library.schema.json` validates the persisted machine collection. Package-specific property and reference checks are additionally enforced when it is loaded with the post library.
- `schema/workbench.schema.json` validates the clean-break version-2 workbench catalog.
- `schema/workbench-project.schema.json` validates machine- and post-neutral editable project state.
- `sdk/wire-edm-post-sdk.d.ts` defines the complete guest callback API and event payload types.
- `sdk/event-diagnostic-catalog.json` publishes event kinds, runtime diagnostic codes, denied globals, and the exact default resource limits.
- `sdk/canonical-plan-fixtures.json` publishes every execution plan available to the installation conformance runner.
- `compatibility.json` lists exact supported contract versions and fixture IDs. It does not claim controller or firmware compatibility.
- `AUTHORING_TASK.md` is a copyable input and completion contract for an authoring agent.
- `examples/minimal.wireedm-post.json` demonstrates the smallest conformant custom package. It is not a production post and MUST NOT be used as a dialect fallback.
- `../../../examples/robofil-100-v2/` contains an ordinary installable Robofil 100 V2 test package, an unbound physical-machine file, and its evidence. It has no privileged runtime path and is never selected automatically.

Every package runs through the same isolated public runtime and must pass its declared fixtures against the canonical fixture registry before installation. The application has no built-in controller renderer, registered package hash, package-key dispatch, or fallback post.

## Authoring commands

Run both checks before requesting installation:

```text
npm run post:docs:check
npm run post:conformance -- post-packages/<package-id>/package.wireedm-post.json
```

The conformance command prints one JSON report and exits non-zero on invocation, package-validation, runtime, determinism, audit, fixture lookup, or expected-output failure. It accepts exactly one package path. It does not rewrite the package or expected program.

The conformance runner executes every declared fixture. It rejects an unexercised command, an unexercised positive capability claim, and missing boolean, choice, or bounded-number property cases. It also requires final `program.ended` state, final `compensation.off` state for a declared compensation lifecycle, and final wire state consistent with the last thread or separation event. The current canonical registry exposes only the fixture IDs in `compatibility.json`. The runner does not infer string-property boundary coverage, every lifecycle branch, or known controller failures. An author and reviewer MUST enforce those remaining requirements. If the registry lacks a plan needed to demonstrate claimed behavior, the package is incomplete and the agent must report that blocker instead of claiming conformance.

Every number parameter declares its spelling in the command vocabulary. Version 1 supports fixed fractional digits, a `.` or `,` decimal separator, optional trailing-zero trimming, and explicit negative-zero handling. Fractional digits may be a fixed integer or an exact integer binding property constrained to the inclusive range 0 through 12. Formatting changes only template text; motion audit uses the original finite numeric values. A controller requirement outside this closed format schema is not representable in v1 and must be reported instead of approximated. `suggestedValue` fields never supply a missing property. The minimal example uses two fixtures because both declared precision boundaries must execute.

Agent authors working in `post-packages/` must also follow the scoped `post-packages/AGENTS.md` instructions.
