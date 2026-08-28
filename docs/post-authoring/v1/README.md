# Wire EDM Post Authoring Contract v1

This directory is the versioned, agent-readable release of the post package contract. The TypeBox sources in `src/domain/post-processor/` are authoritative for serialized shapes; files under `schema/` are generated views and must not be edited directly.

Generate or verify them with:

```text
npm run post:docs:generate
npm run post:docs:check
```

Current contents:

- `schema/post-package.schema.json` validates installable `.wireedm-post.json` documents.
- `schema/post-library.schema.json` validates the local persisted post library.
- `examples/minimal.wireedm-post.json` is the smallest reviewed example currently used to explain the package shape.

The normative lifecycle specification, callback declarations, event and diagnostic catalogues, conformance runner, and production packages land with the post engine. Until that engine is present, a valid uploaded JavaScript package is installable and inspectable but not executable.
