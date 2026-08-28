# Post authoring contract changelog

## v1

- Defines `.wireedm-post.json` package schema version 1 and engine API version 1.
- Defines exact package identity, evidence, dialect, property, fixture, isolated-runtime, saved-revision, and artifact rules.
- Publishes the custom runtime SDK, diagnostic codes, default resource limits, denied guest globals, and canonical installation fixtures.
- Provides a JSON conformance command for custom packages.

The v1 contract has no migration or compatibility fallback. A future incompatible shape or guest API requires a new schema or engine API version and a separate authoring-kit directory.
