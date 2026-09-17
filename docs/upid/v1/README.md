# UPID v1 contract

UPID is this application's controller-neutral geometry and machining-intent format. This document describes the implemented v1 contract. It does not claim conformance to an external industry standard.

## File and validation

A portable file is UTF-8 JSON named `<name>.upid.json`, at most 64 MiB. Its envelope has exactly these fields:

```json
{ "format": "upid", "schemaVersion": 1, "document": {} }
```

`document` must be a complete v1 path-planning document, not the empty object above. The authoritative model is [PathPlanningDocument](../../../src/domain/path-intel/types.ts). The [portable shape checker](../../../src/domain/upid/portableUpidV1Shape.ts) rejects unknown properties and wrong field types. The [semantic validator](../../../src/domain/upid/validateUpidDocument.ts) checks geometry, identities, references, traversal, topology and decisions. Use the [public parser](../../../src/domain/upid/portableUpidProject.ts) at a JSON boundary; a TypeScript assertion does not validate a file.

```ts
const result = parsePortableUpid(text);
if (result.ok) {
  // A detached, structurally valid document. No storage or machine binding changed.
  const document = result.document;
}
```

For a user project, open the portable file in the app and review its execution-plan diagnostics. Postprocessor conformance uses the downloadable canonical execution fixtures in the [contract reference](../../site/reference.md).

Portable examples:

- [Mixed line, arc and circle geometry](examples/mixed-primitives.upid.json)
- [Partial circle with a retention stop](examples/partial-circle-stop.upid.json)
- [Compensated circle](examples/compensated-circle.upid.json)

These are reference documents for format authors, not machine-certified programs. Negative and mutation conformance cases live in the portable, semantic and execution-plan test suites.

## Geometry and units

- Coordinates, radii, lengths and positional tolerances are millimeters in the XY plane. Segment geometry angles are radians; DXF provenance retains explicitly named fields such as `rotationDegrees`. Original DXF units are provenance; they do not change the interpretation of stored coordinates.
- Native segments are finite lines, circular arcs and circles. An arc's signed sweep is nonzero, no greater than one full turn, and agrees with its direction and endpoints. A full-turn ARC is executable even when its endpoints coincide.
- DXF polylines become line/arc segments. Supported spline or ellipse approximations travel as line segments with explicit approximation provenance. Import warnings remain attached to the document.
- Source unit code, label and scale must agree with the DXF unit table. A user-confirmed reinterpretation is represented separately from the original declaration.
- `geometryBasis` distinguishes a finished part boundary from a wire-center path. Controller compensation choices retained on a wire-center document are dormant. They become relevant again when the document uses finished-contour geometry.
- Endpoint clustering tolerances describe topology. A structurally valid import can still be blocked from execution when its joins or machining decisions are unresolved. Import success is not machining approval.

## Identity and source of truth

Segment, cluster, chain, contour, path-element, operation and diagnostic IDs are unique within their corresponding collections. Every reference must resolve; traversal and ownership must agree across the document. Derived metrics and geometry must remain consistent with their source.

Store source segments and source operations together with `machiningParticipation`. Temporary clipped operations and their `machiningIntent` are execution views and must not be serialized as source operations. Partial-cut traces identify the saved source operation, source segment and exact source parameter interval. Reversal reverses the interval direction; stops subdivide it.

Geometry edits preserve unaffected identities. If splitting or joining a contour cannot preserve its explicit machining decisions unambiguously, the edit is refused without changing the document. Moving a complete contour remains supported. Mirroring circular geometry reflects its excluded parameter ranges so the same physical material stays excluded.

## Machining intent carried by v1

| Area | Supported representation |
| --- | --- |
| Setup | Reviewed manual or circle-center-linked initial wire position; default threading policy |
| Operation | Explicit order, direction, classification, selected start and source provenance |
| Compensation | Kept-material inside/outside intent, explicit side for derived partial cuts, or manual centerline intent |
| Entry/exit | No lead, straight manual leads, circular-center entry; review state |
| Participation | Active source geometry with excluded parameter ranges; one contiguous active group per source operation |
| Transfer | Continuous, manual or automatic threading and compatible wire-separation policy |
| Stops | Before entry, remaining active cut distance, after contour, after exit; reason and note |
| Execution | One single-cut pass per active operation, exact source trace, no default feeds or technology generation |

Portable files exclude machine definitions, post source, controller words, output formatting, generated NC, raw DXF and workbench state. Export detaches `source.projectId`. Import always creates a new local project and retains the original imported file separately. Controller artifacts require a saved job revision and the exact installed machine-package setup.

## Compatibility policy

Both envelope and document schema versions are 1. Readers reject unsupported versions and unknown fields rather than silently dropping manufacturing intent. Optional fields may be omitted; an explicit `null` is valid only where the model declares it. Existing reader compatibility for older valid v1 records is covered by tests.

Freeze the published v1 vocabulary. An incompatible shape or semantic change requires a new version and explicit, tested migration. Adding an optional field that an old strict reader rejects is still a compatibility change. Do not use arbitrary extra fields to smuggle unsupported operations into v1.

The `automatic-during-positioning` separation strategy and `after-positioning` stop placement are UPID v2 vocabulary. Current readers accept both versions; portable v1 files containing either value are rejected. Old local snapshots written while these values were mistakenly labeled v1 remain readable for recovery. Export promotes a detached copy of such a snapshot to v2 without rewriting the original project or saved revision bytes.

Portable validation checks shape and structural integrity separately from executable readiness. Incomplete review decisions and geometry requiring attention remain portable. Machine limits and controller realization belong to the saved job and machine package, not this document.

## Possible later versions

These require their own model, compiler and conformance work; they are not advertised as implemented v1 support:

- Multiple rough/skim passes, pass direction and technology selection. This is the most useful production expansion after single-cut v1.
- Several disconnected active groups on one source contour, with explicit ordering, leads and threading for each group.
- Taper/UV and separate upper/lower profiles, with guide-plane and synchronization semantics.
- A smaller canonical source document that rebuilds derived topology caches, plus a published JSON Schema and a portable negative-case conformance corpus for outside writers.
- Native NURBS/ellipses when preserving the original curve offers a measurable benefit over the current explicit approximations.
- Stock, fixture and compensation-aware clearance verification; associative construction constraints.

The [September 2026 audit](../../upid-standard-audit.md) records defects fixed within the current format and verification evidence.
