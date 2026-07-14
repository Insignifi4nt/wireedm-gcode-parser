# Portable UPID Projects Design

## Goal

Make UPID a cleanly importable and exportable path-work format so users can move path projects between browser caches, browsers, computers, and machines without carrying a machine profile or an entire workbench.

## Format Boundary

The portable file is JSON named `<project-name>.upid.json`. It contains the existing versioned UPID state:

```json
{
  "format": "upid",
  "schemaVersion": 1,
  "document": {}
}
```

The `document` contains normalized geometry and path-planning intent. It preserves segments, contours, operations, operation order, direction, selected starts, split points, manual classification, lead-in geometry, semantic compensation intent, construction edits, units, tolerances, display names, diagnostics, and DXF provenance metadata.

The portable file excludes the workbench project container, project-local identity, original DXF text, machine profile, templates, output preferences, generated G-code, and workbench manifest data. Before download, the exporter removes `document.source.projectId`; import assigns a new local project identity and stamps that identity into the stored UPID document.

## Machine Independence

UPID preserves machining intent, not controller realization. Semantic choices such as finished-contour geometry, kept material, centerline intent, and configured lead geometry travel with the document. Controller codes, compensation lifecycle, post formatting, header/footer templates, units codes, coordinate precision, output extension, and work-area checks come from the receiving workbench's active machine profile.

Import creates a local project using a snapshot of the receiving workbench's active machine profile. It must not modify geometry, leads, ordering, classifications, or compensation intent to fit that profile. An incompatible machine may block generated-code export with existing diagnostics, but the path project must still import and display intact.

## Domain Model

Separate the project editing model from its import origin:

- Path projects may originate from `dxf` or `upid`.
- Machine-program projects originate from `external-gcode`.
- Both `dxf` and `upid` origins carry UPID path state.
- Only DXF-origin projects own a persisted raw DXF and support DXF unit re-import.

The workbench manifest records `dxf`, `upid`, or `external-gcode` so filtering and labels remain accurate. Both `dxf` and `upid` display as `Path Project`.

## Export Flow

The Project Library shows a compact share/forward-arrow icon action only for path-project rows. It has no visible text, carries an `Export UPID` accessible label and tooltip, and is the rightmost row action immediately after Delete. Activating it:

1. Reads the persisted project file through the active storage adapter.
2. Validates the project container and UPID document.
3. Creates a detached clone with no local project identity.
4. Downloads formatted JSON as `<sanitized-project-name>.upid.json`.

Export operates on persisted state. No machine data or raw DXF content is serialized.

## Import Flow

The existing Import DXF button remains the primary dashboard action. A narrow, click-operated chevron segment on its right opens a small menu containing `Import UPID Path Project`. Hover alone never controls the menu.

After file selection, import:

1. Parses JSON and verifies `format: "upid"` and `schemaVersion: 1`.
2. Structurally validates the UPID document before any write.
3. Derives a project name from the `.upid.json` filename.
4. Creates a unique local project ID and stamps it into `document.source.projectId`.
5. Creates an `upid`-origin path project using the active machine-profile snapshot.
6. Writes the project file and manifest, then opens the project in the path editor.

Imports always create a new project instead of replacing an existing project. UPID-origin projects own no raw source files and do not offer DXF unit re-import.

## Errors and Safety

- Invalid JSON, format, schema, or UPID structure is rejected before persistence.
- Failed writes must not publish a manifest entry that points to a missing project file.
- The imported document is cloned; caller-owned parsed data is not mutated.
- File names are sanitized for download and import names strip only the terminal `.upid.json` suffix.
- Unsupported or unsafe machine realization is reported by the existing post/export diagnostics, not by silently rewriting UPID intent.

## Testing

Domain tests cover detached export, exclusion of machine and project identity, intent preservation, structural rejection, unique imported identity, active-machine binding, origin metadata, and persistence ordering. UI tests cover the click-operated split menu, file acceptance, import wiring, path-only row export, download wiring, menu dismissal, and accessible labels. The complete Vitest suite and production build must pass.
