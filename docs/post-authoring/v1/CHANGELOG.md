# Post authoring contract changelog

## v1

- Defines `.wireedm-post.json` package schema version 1 and engine API version 1.
- Defines `.wireedm-package` machine-package transport version 1, complete machine setups, post-owned controller-file rules, and atomic installation expectations.
- Defines exact package identity, evidence, dialect, property, fixture, isolated-runtime, saved-revision, and artifact rules.
- Publishes the custom runtime SDK, diagnostic codes, default resource limits, denied guest globals, and canonical installation fixtures.
- Provides a JSON conformance command for custom packages.
- Adds schema-optional command-owned `arcDirection` while preserving legacy package and saved-snapshot parsing. Circular execution requires this explicit declaration; direction is never inferred. New installations must pass the stricter conformance audit. Publish a new post version and setup to add it; do not rewrite existing identities.
- Audits formatted motion coordinates and command direction, rejects moving commands through `emitCommand`, and distinguishes exact full circles from near-coincident non-full arcs. Stored-library reopening checks structure and exact canonical identity without reinstalling packages or rerunning conformance.

The v1 contract has no migration or compatibility fallback. A future incompatible shape or guest API requires a new schema or engine API version and a separate authoring-kit directory.
