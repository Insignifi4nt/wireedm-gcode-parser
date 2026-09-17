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
