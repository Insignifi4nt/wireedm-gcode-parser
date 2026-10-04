# Contract reference

Use these downloadable contracts when preparing JSON for the [Package workbench](tools.md). The files describe the exact structures and behavior accepted by the hosted app.

## Authoring

- [Normative package specification](../post-authoring/v1/SPEC.md)
- [Agent instructions](../post-authoring/v1/AGENTS.md)
- [Input and completion checklist](../post-authoring/v1/AUTHORING_TASK.md)
- [Readable contract versions and fixture IDs](../post-authoring/v1/compatibility.json)
- [Minimal post example](../post-authoring/v1/examples/minimal.wireedm-post.json)

## Schemas

- [Built machine-package document](../post-authoring/v1/schema/machine-package.schema.json)
- [Physical machine and exact setups](../post-authoring/v1/schema/machine-definition.schema.json)
- [Post manifest, dialect, evidence and fixtures](../post-authoring/v1/schema/post-package.schema.json)

## Runtime and verification

- [Guest SDK and all event payloads](../post-authoring/v1/sdk/wire-edm-post-sdk.d.ts)
- [Diagnostic codes and resource limits](../post-authoring/v1/sdk/event-diagnostic-catalog.json)
- [Canonical execution-plan fixtures](../post-authoring/v1/sdk/canonical-plan-fixtures.json)

## UPID

- [UPID v2 intent additions](../upid/v2/README.md)
- [Base geometry and portable document contract](../upid/v1/README.md)

UPID is this project's published controller-neutral format. Posts consume the compiled execution plan, not raw drawing entities. Read only the geometry details needed to understand event payloads; the application owns planning.

## Inspect controller output

Use **Start Work → Inspect G-code** for a standalone file or pasted program. It reads UTF-8/ASCII text without creating a project or requesting folder access. Source lines keep their order, block numbers, comments, wrappers and line endings. Search text, filter command occurrences, jump to a source line, or select a path in the XY preview to locate its source. Line details show the supported modal state before and after the block; **Issues** and **Commands** explain what is recognized and what is omitted.

For an unrelated program, choose its initial units and coordinate/arc-center assumptions explicitly when the source does not declare them. A generic command label is not a controller-specific guarantee. Unknown commands, macros, non-XY behavior and compensation may limit the preview. Inspection accepts up to 2 MiB / 50,000 lines; large previews explicitly report their display limit. It does not evaluate controller execution or approve a program for machining.

**Open Machine Program** remains the editable import workflow, including its existing cleanup. From that editor, **Inspect** reviews the current draft without saving or normalizing it. Use the UPID editor for geometry and machining-intent changes.

After generating a controller artifact, choose **Inspect G-code** to review its original source lines, nominal XY preview, command coverage and modal state. **Context** shows the saved revision, exact post/version/hash, physical machine and setup identity. The inspector uses the matching saved post's declared command semantics and arc-center properties; controller compensation is shown as an annotation and does not offset the preview. Unsupported dialect geometry reports limited coverage.

From a project's **Saved revisions**, choose **Inspect controller file** to reproduce and inspect that revision with its own post and machine snapshots. Changing the currently installed setup does not change the saved revision's inspection context. Inspection does not save a new revision, import a machine program, normalize output or alter the UPID draft. **Download exact file** retains the original artifact's line endings, numbering and wrappers. Close inspection to return to the export or revisions dialog.
