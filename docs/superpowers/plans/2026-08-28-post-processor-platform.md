# Post-Processor Platform Implementation Plan

Date: 2026-08-28

Design: `docs/superpowers/specs/2026-08-28-post-processor-platform-design.md`

Research: `docs/superpowers/2026-08-28-wire-edm-post-processor-architecture-research.md`

## Delivery discipline

Implementation proceeds in five substantial milestones. Every milestone is API-first, leaves the repository working, and ends in exactly two bounded review passes:

1. a correctness/architecture review against the milestone invariants;
2. a simplification/test-value review that removes duplicate code, unnecessary abstractions, redundant assertions, and tests that do not protect meaningful behavior.

Validated findings are fixed once and the milestone is reverified. Reviews do not recursively spawn further reviews. Commits are made at coherent milestone or gate boundaries. Reviewers also search for implicit fallbacks, normalization of invalid input, compatibility branches, and catch-and-continue behavior; each instance is removed or justified as an explicit typed product state.

## Milestone 0 — Contract and migration map

- [x] Research current export ownership and controller-dialect evidence.
- [x] Define controller-neutral, physical-machine, post-package, binding, revision, and artifact boundaries.
- [x] Record the architectural decision and shared vocabulary.
- [x] Complete the primary-source agent-first documentation study.
- [x] Inventory every legacy `MachineProfile` field and assign its destination or deletion.
- [x] Freeze public seams and the version-1 post package examples used by tests.

Exit criteria: the design, vocabulary, data ownership, package boundary, migration order, and review gates are explicit; no implementation depends on an unresolved ownership decision.

## Milestone 1 — Post packages and local library

Public seams:

```ts
parseWireEdmPostPackage(rawText): PostPackageParseResult
installPostPackage(library, package): PostLibraryUpdateResult
removePostInstallation(library, ref, bindings): PostLibraryUpdateResult
resolvePostInstallation(library, ref): PostInstallationResolution
validatePostPropertyValues(package, values): PostPropertyValidationResult
```

- [x] Write failing boundary tests for one minimal valid package and meaningful invalid/conflict cases.
- [x] Implement immutable parsed package types, canonical serialization, content hashing, and stable diagnostics.
- [x] Implement idempotent install, parallel-version retention, hash-conflict handling, exact resolution, and bound-removal rejection.
- [x] Persist the library through the common browser-cache/folder adapter contract without requiring folder permission.
- [x] Generate checked-in JSON Schemas and validate the evidence-backed minimal package example.

Gate 1 emphasizes parser totality, deterministic identity, conflict data integrity, over-modeling, repetitive validation, implicit defaults/fallbacks, and test redundancy.

## Milestone 2 — Physical machines and post bindings

Public seams:

```ts
parseMachineDefinition(raw): MachineDefinitionParseResult
createMachinePostBinding(machine, installation, values): MachineDefinition
removeMachinePostBinding(machine, bindingId): MachineDefinition
resolveMachinePostBinding(machine, library, bindingId): ResolvedMachinePostBinding
```

- [ ] Introduce physical `MachineDefinition`, exact `MachinePostBinding`, and verification types.
- [ ] Move import and output preferences to workbench-level settings.
- [ ] Replace the workbench/project schema and reject obsolete schemas with a precise unsupported-version error; add no dual-read or migration code.
- [ ] Store multiple bindings and package versions per machine; reject dangling references.
- [ ] Add portable machine-definition import/export without embedding global post source.

Gate 2 emphasizes new-schema integrity, project snapshot integrity, binding lifecycle, illegal states, removal of compatibility mirrors/fallback selection, and persistence-test value.

## Milestone 3 — Neutral execution plan and standalone posts

Public seams:

```ts
compileWireEdmExecutionPlan(savedRevision): ExecutionPlanResult
preflightPostCapabilities(plan, package, properties): PostDiagnostic[]
runPost(plan, resolvedBinding): Promise<ControllerProgramResult>
auditControllerProgram(plan, blocks): PostDiagnostic[]
```

- [ ] Extract geometry, operations, passes, transitions, threading, stops, and compensation intent into ordered typed events.
- [ ] Keep controller words and output formatting out of the execution plan.
- [ ] Express every controller implementation as an ordinary package executed by the public isolated runtime.
- [ ] Define complete standalone package manifests, source, dialect evidence, properties, and fixtures; do not add application-owned renderer adapters.
- [ ] Preserve source trace and exact physically intentional controller outputs as new-contract fixtures, without preserving legacy APIs.
- [ ] Remove `programOwned` and consolidate header/body/footer ownership under posts.
- [ ] Audit required-event acknowledgment and motion equivalence.

Gate 3 emphasizes physical output correctness, hidden machining decisions, event coverage, duplicated emit/audit logic, fallback branches, and obsolete golden/assertion noise.

## Milestone 4 — Persisted-revision export

Public seams:

```ts
saveWireEdmJobRevision(projectDraft, selection): SavedWireEdmJobRevision
generateControllerArtifact(savedRevision, exportPreference): ControllerProgramArtifact
```

- [ ] Separate portable UPID, saved job revision, and controller artifact in storage and UI language.
- [ ] Make portable UPID import machine/post-unbound.
- [ ] Require explicit machine binding selection and save before generation.
- [ ] Snapshot exact package content, hash, properties, verification, engine version, and UPID hash.
- [ ] Ensure extension and line-ending choices cannot alter semantic generated blocks.
- [ ] Replace draft-state controller export in `EditorPage` with saved-revision generation.

Gate 4 emphasizes determinism, stale-state behavior, provenance completeness, accidental defaults/fallbacks, UI/domain duplication, and workflow-test value.

## Milestone 5 — Management UI and agent-authoring kit

- [ ] Replace mixed Machine & Output controls with physical Machine, Post Bindings, and Export Preferences sections.
- [ ] Add post upload, inspect, parallel-version listing, bind, duplicate-property-preset, remove, and explicit export selection flows.
- [ ] Make installed-but-non-runnable custom packages visibly distinct until the sandbox runtime is available.
- [ ] Ship normative spec, JSON Schema, generated TypeScript SDK declarations, event/diagnostic catalogues, examples, fixtures, conformance runner, compatibility matrix, and authoring `AGENTS.md`.
- [ ] Add the isolated custom JavaScript runtime only after worker termination and deterministic resource-limit tests pass.
- [ ] Put external G-code semantic interpretation behind an explicit dialect adapter while preserving source cleanup/display.

Gate 5 is a final bounded architecture, safety, UX, simplification, and test-value review. It checks that no legacy controller policy or compatibility path remains, no unresolved state picks a fallback, and no UI control exposes functionality the domain API cannot perform.

## Final verification

- [ ] Run focused tests at each changed public seam.
- [ ] Run `npm test -- --run`.
- [ ] Run `npm run build`.
- [ ] Run relevant Playwright flows on the configured port 3777 only.
- [ ] Run `git diff --check` and inspect the final branch diff.
- [ ] Document legacy migration behavior, package authoring, conformance, verification limits, and remaining deliberately deferred work.
