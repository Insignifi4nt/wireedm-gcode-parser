# Post authoring contract changelog

## App 0.0.792

- The motion audit accepts every correctly rounded coordinate. Its floating-point allowance is now a few units in the last place of each axis's values, so it grows with their magnitude, instead of a fixed guard that half a unit in the last place of any coordinate from 8 mm upwards exceeded. At endpoints, arc centers and points along a straight move, each axis keeps its own allowance: a post that writes X and Y to different decimals cannot pass a wrong Y digit there on X's allowance. An absolute arc center is held to its own values, and only an incremental center also carries the start's roundoff. A point that splits an arc is still checked only by its distance from the arc, which allows half the diagonal of its rounding, as before: with X at 0 decimals and Y at 12 it may be almost 0.5 mm off on Y, and almost 0.0005 mm with X at 3 decimals. A separate audit compatibility release will tighten that check. A straight move's emitted length is bounded by the exact extremes its rounding allows, not a first-order estimate. Before, 8.0015 mm written as 8.002 at three decimals failed, and so did many correctly rounded lengths of 2 mm or more.
- The audit accepts everything it accepted before. Installation conformance and controller generation can now accept posts and programs they refused before. The motion mismatch message names the floating-point allowance and the arc split-point exception, and says that the audit rules changed in app 0.0.792. Package formats, hashes, engine API 1 and controller bytes are unchanged; no installed package or saved revision is rewritten.

## App 0.0.686

- Publishes one current `/documentation/` entry point, static Markdown/HTML, generated contracts and scoped `llms.txt` discovery.
- Adds optional serialized `manifest.authoredFor` (required by the authoring instructions for new packages). Legacy packages keep their exact hashes; old apps may reject the new field.
- Replaces the stale schema-v1-only compatibility list with versions derived from the actual post schema. Updates the minimal example to post schema v2. Authoring kit/engine API v1 remain distinct from app and post-schema versions.
- Robofil 2.6.0 records app provenance; controller source, dialect, output and fixture content are unchanged from 2.5.0.
- Corrects the written modal-compensation contract to include explicitly supported separation/rethread sequences already accepted by the runtime.

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
