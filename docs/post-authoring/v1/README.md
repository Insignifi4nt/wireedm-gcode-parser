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
- `examples/minimal.wireedm-post.json` is the smallest reviewed example currently used to explain the package shape.

The package schema and semantic validator are implemented. Exact built-in packages are executable through the audited neutral-event engine. Custom JavaScript packages remain installable and inspectable but are explicitly non-runnable until the isolated runtime and its resource-limit tests are present; no built-in or alternate package is selected as a substitute.

Agent authors working in `post-packages/` must also follow the scoped `post-packages/AGENTS.md` instructions.
