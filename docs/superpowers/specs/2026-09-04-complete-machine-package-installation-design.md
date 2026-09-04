# Complete machine package installation design

Date: 2026-09-04

Status: Accepted direction for implementation

## Goal

A person installs one file prepared by an authoring agent in collaboration with a knowledgeable human. That file contains everything required to use a physical machine with its included post processors. Normal installation never asks the person to enter identifiers, compatibility claims, controller-file settings, or raw JSON.

The authoring documentation and conformance tools must make a complete package straightforward for an agent to build and difficult to build incorrectly.

## Governing rule

The machine package is the only user-facing installation artifact.

Every machine package contains:

- exactly one complete machine definition;
- one or more versioned post processors;
- at least one complete machine setup for every included post processor intended for use;
- every stable machine-specific post value;
- controller-file rules, including extension, line ending, encoding, final newline, numbering, and wrapper markers;
- evidence and compatibility claims;
- conformance fixtures with exact expected controller artifacts;
- package identity, schema version, and content hashes.

An installable package has no unresolved required property. Values that must change per job are declared as job inputs and appear in the planning workflow, not the installation workflow.

## Internal separation

One installation file does not mean one internal record. After validation, the installer stores machine definitions, post installations, and machine setups separately.

This separation permits:

- several post processor versions for one physical machine;
- one repeated machine definition across update packages without duplicate machines;
- exact post references by ID, version, and content hash;
- old saved jobs to remain reproducible after the active post changes;
- safe removal checks for post versions still used by live setups or saved jobs.

The installation module hides this storage model. Its public interface accepts a package and returns a complete installation preview or a typed failure. Committing an accepted preview is atomic.

## Package representation

The primary artifact is a ZIP container with the `.wireedm-package` extension. It is inspectable with ordinary ZIP tools but appears as one file to the person installing it.

A source folder may contain the same files during authoring. The authoring tool validates the folder and builds the archive. The application may also accept a folder when the browser supports directory selection, but archive and folder input must pass through the same parser and validator.

Loose machine JSON and post JSON files are not part of the normal installation flow. Developer tooling may retain separate inspection commands, but those commands must not create partially configured production installations.

## Machine recognition

The installer compares the incoming machine with installed machines before showing a commit action.

### Exact existing machine

The incoming stable machine ID and canonical physical-definition hash match an installed machine.

The preview says that the existing machine was found, shows its name and identity, and asks whether to add the new post processors to it. The installer reuses the existing machine and adds only missing post installations and machine setups.

### Updated definition for the same machine

The stable machine ID matches but the canonical physical-definition hash differs.

The preview shows the changed physical fields and requires explicit confirmation before replacing the installed definition. Controller syntax and output-only changes never appear as physical-machine changes.

### Possible match

The stable machine ID differs, but serial number or descriptive identity suggests the package may describe an installed machine.

The preview names the candidate and asks whether this is the same machine. If no serial number exists, manufacturer, model, and controller similarity may suggest a match but can never merge machines automatically. Two physical machines may share all descriptive fields.

### New machine

No credible match exists. The preview creates a new machine with its included post processors and setups.

## Post processor recognition

Post identity is the tuple of ID, semantic version, and content hash.

- The same tuple is an idempotent reinstall.
- The same ID with a new version installs beside existing versions.
- The same ID and version with a different content hash is a blocking conflict. The author must change the version.
- A package update never selects an unversioned newest post silently.

For a newly installed machine, the package declares the initial active setup. For an existing machine, the preview states which setup will become active. The person can accept that change or install the version without activating it. Old setups remain available while referenced.

## Installation flow

Settings exposes one primary action named `Install machine package`.

1. The person selects one `.wireedm-package` file.
2. The application validates the archive, schema, hashes, references, post conformance, and completeness without changing storage.
3. The application shows a compact preview with the detected machine, incoming post versions, active-setup change, and any physical-definition changes.
4. The person confirms the proposed installation.
5. The application writes every change atomically and then verifies the stored result.

The preview uses familiar names. Internal IDs and hashes may appear in an expandable technical-details section, but the person never types them.

## Settings after the change

The normal Machines screen contains:

- `Install machine package`;
- installed machine cards;
- each machine's active post processor and version;
- a read-only summary of controller-file rules;
- available installed post versions and an action to activate one;
- exact post-package installation status, setup verification status, and evidence-review status;
- only true machine-management actions.

The following controls are removed from normal settings:

- separate machine installation;
- separate post installation;
- manual machine-post binding creation;
- binding ID and binding name;
- compatibility acknowledgement fields;
- raw post-properties JSON;
- controller-export configured state;
- output extension and line ending.

Workbench preferences retain import behavior and a default machine for new jobs. Export readiness is derived from the selected machine setup and saved job state.

## Ownership of configurable values

Every value has one declared owner.

- Fixed controller behavior belongs to the post processor.
- Controller-file rules belong to the post processor.
- Stable physical facts belong to the machine definition.
- Stable machine-specific controller values belong to a machine setup supplied by the package.
- Values that vary between jobs belong to the saved job revision and are requested during planning.
- File name and destination belong to the download action.

The editor may display formatting such as sequence numbers or percent markers, but it cannot own an independent export transformation. The controller artifact shown in the editor and the downloaded bytes must come from the same post-owned rules.

Saved revision persistence uses `transactions/saved-revision.json` to coordinate the immutable revision, owning project document, and workbench manifest. Recovery data must be written and read back before changing those files. On reopen, recovery runs before manifest parsing: it retains a complete byte-exact committed set, or restores the prior project and manifest and removes the new revision. Recovery remains retryable after interruption and removes its journal only after verifying restoration or completion. Subsequent project and preference mutations must recover any pending revision before checking their catalog snapshot.

## Authoring contract

The public authoring kit must include:

- a normative package specification using MUST, MUST NOT, SHOULD, exact limits, and failure behavior;
- the authoritative package JSON Schema;
- generated TypeScript declarations;
- a documented archive layout;
- a complete example source folder and built archive;
- a command that validates a source folder;
- a command that builds a deterministic `.wireedm-package` archive;
- a command that inspects an archive and prints a human-readable inventory;
- canonical valid, invalid, update, conflict, and same-machine fixtures;
- stable diagnostics with JSON output and nonzero failure status;
- an `AGENTS.md` workflow that requires exact machine identity, primary evidence, complete setups, conformance, and human review where evidence is missing.

If the authoring agent lacks machine information, controller documents, prior package identity, or evidence, it asks the human to attach or locate those materials. It does not invent missing requirements or produce a package that relies on installation-time repair.

## Required acceptance scenarios

Implementation is incomplete until automated tests cover these cases:

1. A new complete package installs a new machine and its active post.
2. A package with the exact same machine and a new post version proposes adding that post to the existing machine.
3. An idempotent reinstall makes no storage changes.
4. A conflicting post with the same ID and version but different content fails before any write.
5. A changed physical definition produces a field-level preview and requires explicit acceptance.
6. A possible descriptive match never merges automatically.
7. A malformed archive, missing setup, missing required value, bad hash, or failed post fixture produces no partial installation.
8. Activating a new post version does not alter saved revisions or their generated controller artifacts.
9. The generated artifact uses the post-owned extension, line ending, encoding, numbering, and wrappers.
10. Browser-cache installation works without directory permissions.
