# Post authoring contract changelog

## Post package schema v2 (engine API v1)

- `manifest.capabilities.wireSeparation` is an explicit array of supported mechanisms: `manual-before-positioning`, `automatic-before-positioning`, and `automatic-during-positioning`. The host preflights each requested mechanism and conformance requires matching fixture coverage. A schema v1 boolean remains readable in exact legacy snapshots but does not authorize a particular transition.
- The runtime event and SDK declaration include `position.separatesWire?: true`. A payload parity test compares every published event field with the runtime union.
- The Robofil candidate package is version 2.5.0 with post schema v2. It declares only automatic separation during positioning; physical behavior remains unverified.
- New saved revisions use engine 2. Existing engine 1 snapshots remain byte-for-byte and hash checked; artifact generation additionally requires current execution readiness.

## v1

- Defines `.wireedm-post.json` package schema version 1 and engine API version 1.
- Defines `.wireedm-package` machine-package transport version 1, complete machine setups, post-owned controller-file rules, and atomic installation expectations.
- Defines exact package identity, evidence, dialect, property, fixture, isolated-runtime, saved-revision, and artifact rules.
- Publishes the custom runtime SDK, diagnostic codes, default resource limits, denied guest globals, and canonical installation fixtures.
- Provides a JSON conformance command for custom packages.
- Adds schema-optional command-owned `arcDirection` while preserving legacy package and saved-snapshot parsing. Circular execution requires this explicit declaration; direction is never inferred. New installations must pass the stricter conformance audit. Publish a new post version and setup to add it; do not rewrite existing identities.
- Audits formatted motion coordinates and command direction, rejects moving commands through `emitCommand`, and distinguishes exact full circles from near-coincident non-full arcs. Stored-library reopening checks structure and exact canonical identity without reinstalling packages or rerunning conformance.

Engine API v1 remains unchanged for existing event kinds. The package schema v2 capability refinement is read alongside legacy schema v1 snapshots; future guest API changes require their own versioned contract.
