import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { CadEditSchema } from '@/domain/cad/cadOperations';
import { CadDocumentSchema } from '@/domain/cad/cadSchema';
import { CadError } from '@/domain/cad/cadError';
import { CadStorageError } from '@/domain/cad/cadStorage';
import { CadSectionRequestSchema } from '@/domain/cad/cadSection';
import { CadViewportCommandSchema } from './cadViewportControls';
import { CadFeatureSchema } from '@/domain/cad/cadSchema';
import { CadTopologyPickSchema, CadTopologyResolvePicksRequestSchema } from '@/domain/cad/cadTopology';
import { CadSolidImportSourceSchema } from '@/domain/cad/cadImports';
import { CadDxfImportSourceSchema } from '@/domain/cad/cadDxfSource';
import { isCadImportData } from '@/domain/cad/cadImportData';
import type { CadDiagnostic, CadDocument, CadFeature } from '@/domain/cad/cadDocument';
import { object, page, pageFields, siteTool, ToolError } from '@/features/webmcp/siteTools';
import { jsonByteLength, summarizeDiagnostic } from '@/features/webmcp/diagnosticSummaries';
import { CadSessionError } from './cadSession';
import type { CadController } from './useCadController';

const id = Type.String({ minLength: 1, maxLength: 160 });
const version = { expectedVersion: id };
const documentText = new WeakMap<CadDocument, string>();
function diagnosticSummary(diagnostics: readonly CadDiagnostic[]) {
  const summaries = diagnostics.slice(0, 10).map(summarizeDiagnostic);
  // Body pages may use 24 KiB. Keep diagnostics bounded even for escaped Unicode.
  while (summaries.length && jsonByteLength(summaries) > 4096) summaries.pop();
  return { diagnostics: summaries, omittedDiagnostics: diagnostics.length - summaries.length };
}
const featureDescriptions: Record<CadFeature['kind'], string> = {
  sketch: 'Plane-local closed profiles with optional construction geometry. Nesting automatically determines material, voids and islands. Dimensions accept finite arithmetic over document parameters.',
  imported: 'An independent solid from an original STEP or STL file. Original source bytes are preserved in the document. STEP retains exact BRep; STL is faceted and requires explicit mm/inch source units. Native validation rejects open or invalid solids.',
  extrude: 'Pad the preceding sketch, symmetrically if requested. New creates a body; join/cut consumes and replaces targetId.',
  revolve: 'Revolve the preceding sketch around its local x or y axis by degrees. New creates a body; join/cut replaces targetId.',
  fillet: 'Round current target edges. Absent/null selection means all edges; supplied geometric queries must match their exact expected counts. Replaces targetId; invalid radii report a build diagnostic.',
  chamfer: 'Chamfer current target edges. The radius field is the distance in mm. Optional geometric selection must match exact counts; absent/null retains all-edge semantics.',
  shell: 'Hollow a current solid inward by positive thickness in mm, opening exactly one planar face selected by geometric predicates. Ambiguous selections and invalid walls fail explicitly.',
  boolean: 'Union/cut/intersect current target and tool bodies. Both inputs are consumed and replaced by this feature.',
  transform: 'Translate in mm and rotate in degrees about global axes. Replaces its current source body.',
  'linear-pattern': 'Create a compound containing the original and translated copies of the current source. Count includes the original. Replaces sourceId.',
  mirror: 'Mirror the current source across a global reference plane, preserving the original source as a separate body.'
};

/** No code execution or hidden controller shortcuts: agents use the visible CAD operations. */
export function cadSiteTools(getController: () => CadController) {
  function tool<S extends TSchema>(name: string, description: string, schema: S,
    execute: (cad: CadController, input: Static<S>, signal: AbortSignal) => unknown | Promise<unknown>, readOnly = true) {
    const operation = siteTool(name, description, schema, async (input, signal) => {
      try { return await execute(getController(), input, signal); }
      catch (error) {
        if (error instanceof CadError || error instanceof CadSessionError || error instanceof CadStorageError) throw new ToolError(error.code, error.message);
        throw error;
      }
    }, readOnly);
    return { ...operation, execute(input: unknown, options?: { signal?: AbortSignal }) {
      // Validate portable own data before TypeBox reads fields or a handler runs.
      if (!options?.signal?.aborted && !isCadImportData(input)) return Promise.resolve({ ok: false,
        error: { code: 'INVALID_ARGUMENT', message: 'CAD tool arguments must contain their own complete JSON data fields.' } });
      return operation.execute(input, options);
    } };
  }
  function context(cad: CadController) {
    const state = cad.session.getSnapshot();
    return { open: cad.isOpen(), version: state.version, documentId: state.document.id, name: state.document.name,
      units: state.document.units, dirty: state.dirty, savedVersion: state.savedVersion,
      featureCount: state.document.features.length, parameters: state.document.parameters,
      canUndo: state.canUndo, canRedo: state.canRedo, workflowOpen: state.workflowOpen, busy: cad.isBusy(),
      buildState: cad.buildState, buildVersion: cad.buildVersion, buildId: cad.build?.buildId ?? null,
      ...diagnosticSummary(cad.build?.diagnostics ?? []),
      supported: { sketches: ['rectangle', 'circle', 'polygon', 'slot', 'path'], planes: ['XY', 'XZ', 'YZ'],
        solids: ['imported', 'extrude', 'revolve', 'fillet', 'chamfer', 'shell', 'boolean', 'transform', 'linear-pattern', 'mirror'],
        imports: ['cad-json', 'dxf', 'step', 'stl'],
        exports: ['cad-json', 'dxf', 'step', 'stl'], expressions: 'Finite arithmetic: + - * / and parentheses over named numeric parameters. Millimeters and degrees.' },
      camHandoff: 'Choose a sketch or exact planar section of a final solid. Local 2D millimeter contours become a new detached CAM project. Sections preserve lines/arcs; unsupported curves are rejected. CAD is saved first; CAM retains its own revisions and installed machine checks.',
      nextSteps: state.workflowOpen ? ['Finish or cancel the visible CAD editor.'] : !cad.isOpen() ? ['cad_open_workspace', 'cad_create_document', 'cad_list_documents']
        : ['cad_read_features', 'cad_edit_document', 'cad_measure_sketch', 'cad_build', 'cad_save_document', 'cad_send_to_cam'] };
  }
  return [
    tool('cad_get_context', 'Read the shared CAD draft version, parameters, supported operations, saved state and build diagnostics. Millimeters, desktop CAD. No storage writes.', object({}), cad => context(cad)),
    tool('cad_describe_features', 'Discover exact CAD feature definitions and semantics without opening or changing a document. With no kind returns a compact catalog; provide kind for its JSON schema. Use complete feature definitions in add-feature/update-feature. Dimensions are mm, angles degrees.', object({ kind: Type.Optional(Type.Union(Object.keys(featureDescriptions).map(kind => Type.Literal(kind)))) }), (_cad, input) => {
      if (!input.kind) return { items: Object.entries(featureDescriptions).map(([kind, description]) => ({ kind, description })) };
      const kind = input.kind as CadFeature['kind'];
      const schema = CadFeatureSchema.anyOf.find(candidate => {
        const value = candidate.properties.kind;
        return value.const === kind || ('anyOf' in value && value.anyOf.some((variant: TSchema) => variant.const === kind));
      });
      if (!schema) throw new ToolError('NOT_FOUND', 'CAD feature kind was not found.');
      if (kind === 'sketch' && 'profiles' in schema.properties) {
        // Saved legacy constraints remain parseable, but new contours use nesting.
        const authoringSchema = Type.Object({ ...schema.properties,
          profiles: Type.Array(Type.Omit(schema.properties.profiles.items, ['role']), { maxItems: 256 })
        }, { additionalProperties: false });
        return { kind, description: featureDescriptions[kind], schema: authoringSchema };
      }
      return { kind, description: featureDescriptions[kind], schema };
    }),
    tool('cad_open_workspace', 'Open the desktop CAD workspace, retaining its current draft. Refuses to leave an unsaved CAM draft or active CAM workflow.', object({}), cad => { cad.enter(); return context(cad); }, false),
    tool('cad_create_document', 'Create a blank CAD draft with a fresh identity. Does not save. Save an existing nonempty draft before replacing it.', object({ ...version, name: Type.String({ minLength: 1, maxLength: 160 }) }), (cad, input) => {
      cad.newDocument(input.name, input.expectedVersion); return context(cad);
    }, false),
    tool('cad_import_document', 'Import a complete validated wireedm-cad document as a NEW unsaved draft with a fresh identity. Uses the same operation as visible CAD JSON Import; preserves expressions and feature IDs, never overwrites saved CAD. Refuses unsaved CAD/CAM drafts, stale versions and active workflows. 4 MiB maximum. This accepts typed declarative CAD data, not Python, OpenSCAD, KCL or executable source.', object({ ...version, document: CadDocumentSchema }), async (cad, input, signal) => {
      const imported = await cad.importDocumentValue(input.document, input.expectedVersion, signal);
      return { ...context(cad), imported: imported.imported, sourceDocumentId: imported.sourceDocumentId };
    }, false),
    tool('cad_import_solid', 'Import a STEP or watertight STL file as a fresh unsaved CAD document using the same native checks as File > Import. STEP accepts UTF-8 text and embedded units. STL accepts standard padded base64 with explicit mm/inch units and produces faceted geometry. Preserves original source; maximum 2 MiB decoded. Refuses unsaved CAD/CAM work and open workflows. Native parsing, topology and positive-volume validation must succeed before changing the draft.', object({ ...version, source: CadSolidImportSourceSchema }),
      (cad, input, signal) => cad.importSolidSource(input.source, input.expectedVersion, signal), false),
    tool('cad_import_dxf', 'Import a complete exact DXF as a fresh CAD document containing an editable planar sketch. Preserves original text, circular arcs and analytic nesting. Uses declared units; missing/unknown units require explicit mm/inch/cm/m. Conflicting unit overrides, open/branching contours, unsupported curves and approximation are rejected. Maximum 2 MiB UTF-8. Uses the same cancellable worker operation as File > Import and refuses unsaved work or active workflows.', object({ ...version, source: CadDxfImportSourceSchema }),
      (cad, input, signal) => cad.importDxfSource(input.source, input.expectedVersion, signal), false),
    tool('cad_list_documents', 'List real saved CAD documents in the active browser cache or workbench folder. Failed files are reported and preserved.', object(pageFields), async (cad, input, signal) => {
      const result = await cad.list(signal);
      return { ...page(result.entries, input), diagnostics: result.diagnostics.slice(0, 10), omittedDiagnostics: Math.max(0, result.diagnostics.length - 10), truncated: result.truncated };
    }),
    tool('cad_open_document', 'Open a saved CAD document by ID. Refuses to replace unsaved CAD or CAM work. Read cad_get_context for expectedVersion.', object({ ...version, documentId: id }), async (cad, input, signal) => {
      await cad.openDocument(input.documentId, input.expectedVersion, signal); return context(cad);
    }, false),
    tool('cad_read_features', 'Read paginated feature definitions from the current CAD draft, including exact dimensions and expressions. Use IDs in updates; never infer them from names.', object({ ...version, ...pageFields }), (cad, input) => {
      cad.session.assertVersion(input.expectedVersion);
      return { version: input.expectedVersion, ...page(cad.session.getSnapshot().document.features, input) };
    }),
    tool('cad_read_document', 'Read complete current CAD JSON in exact bounded UTF-16 chunks, including large sketches that exceed one feature-page response. Concatenate text until nextOffset is null, then parse JSON. Offsets count JavaScript UTF-16 code units. Pin the same expectedVersion for every chunk. No save or browser download.', object({ ...version, offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 16 * 1024 * 1024 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4096 })) }), (cad, input) => {
      cad.session.assertVersion(input.expectedVersion);
      const document = cad.session.getSnapshot().document;
      let text = documentText.get(document);
      if (text === undefined) { text = JSON.stringify(document); documentText.set(document, text); }
      const offset = input.offset ?? 0;
      if (offset > text.length) throw new ToolError('INVALID_ARGUMENT', 'Offset exceeds the document text length.');
      const end = Math.min(text.length, offset + (input.length ?? 4096));
      return { version: input.expectedVersion, documentId: document.id, offset, totalLength: text.length, nextOffset: end < text.length ? end : null, text: text.slice(offset, end) };
    }),
    tool('cad_get_feature', 'Read one feature definition by exact ID in the current draft.', object({ ...version, featureId: id }), (cad, input) => {
      cad.session.assertVersion(input.expectedVersion);
      const feature = cad.session.getSnapshot().document.features.find(value => value.id === input.featureId);
      if (!feature) throw new ToolError('NOT_FOUND', 'Feature does not exist. Read cad_read_features.');
      return { version: input.expectedVersion, feature };
    }),
    tool('cad_edit_document', 'Apply an atomic batch of typed edits to the shared CAD draft. This is one undo step and does not save. Add/update complete feature definitions, set named numeric parameters, rename, reorder, or explicitly cascade deletion. Rejects invalid geometry, references, stale versions and active UI workflows. No arbitrary code.', object({ ...version, edits: Type.Array(CadEditSchema, { minItems: 1, maxItems: 128 }) }), (cad, input) => {
      cad.edit(input.edits, input.expectedVersion, true); return context(cad);
    }, false),
    tool('cad_history', 'Undo or redo one CAD edit batch. Draft versions always advance; saved storage is unchanged until Save.', object({ ...version, direction: Type.Union([Type.Literal('undo'), Type.Literal('redo')]) }), (cad, input) => {
      if (input.direction === 'undo') cad.undo(input.expectedVersion); else cad.redo(input.expectedVersion);
      return context(cad);
    }, false),
    tool('cad_get_viewport', 'Read current CAD selection, sketch mode, named view, grid state and the exact displayed build version. Use this to verify a view change before capture.', object(version), (cad, input) => cad.readViewport(input.expectedVersion)),
    tool('cad_set_viewport', 'Use visible CAD viewport operations: named view, fit/grid, feature/profile selection, sketch mode, body/face/edge pick mode and exact-build topology selection. Does not edit geometry or save. Active workflows block changes. Read cad_get_viewport after applying.', object({ ...version, command: CadViewportCommandSchema }), (cad, input) => cad.changeViewport(input.command, input.expectedVersion), false),
    tool('cad_capture_preview', 'Capture actual current CAD sketch/solid preview pixels as a bounded PNG, with document version, view state and SHA-256. The returned local blob URL is not a public URL or desktop screenshot. Both 2D and 3D are CAD draft content, including unsaved changes. Stale builds/views are rejected. Optional download requests a browser save; a visible CAD preview PNG link supports retry.', object({ ...version, download: Type.Optional(Type.Boolean()) }), (cad, input, signal) => cad.captureViewport(input.expectedVersion, input.download ?? false, signal), false),
    tool('cad_build', 'Evaluate current CAD history in the exact solid kernel and inspect paginated body volume (mm³), bounds (mm) and feature diagnostics. Follow nextBodyOffset with offset/limit on the same version. Lazy kernel initialization may take several seconds. Does not save or create CAM output.', object({ ...version, ...pageFields }), async (cad, input, signal) => {
      const result = await cad.inspectBuild(input.expectedVersion, signal);
      const bodies = page(result.meshes, input, mesh => ({ featureId: mesh.featureId, name: mesh.name, volumeMm3: mesh.volume, boundsMm: mesh.bounds, triangles: mesh.indices.length / 3,
        previewFaces: new Set(mesh.faceGroups.map(group => group.key)).size, previewEdges: new Set(mesh.edgeGroups.map(group => group.key)).size }));
      return { version: input.expectedVersion, buildId: result.buildId, durationMs: result.durationMs, ...diagnosticSummary(result.diagnostics),
        bodies: bodies.items, totalBodies: bodies.total, nextBodyOffset: bodies.nextOffset };
    }),
    tool('cad_inspect_topology', 'Inspect exact faces or edges of a successfully built body in world coordinates. Pin expectedVersion and expectedBuildId from cad_build. Returns bounded descriptors and opaque keys for this build only; follow nextOffset. Lengths/coordinates are mm; areas mm². Stale snapshots are rejected without rebuilding. Keys must never be saved in features.', object({
      ...version, bodyId: id, expectedBuildId: id, kind: Type.Union([Type.Literal('edge'), Type.Literal('face')]),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 25000 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
    }), async (cad, input, signal) => {
      const offset = input.offset ?? 0;
      const result = await cad.inspectTopology({ bodyId: input.bodyId, expectedBuildId: input.expectedBuildId,
        selection: { kind: 'page', topology: input.kind, offset, limit: input.limit ?? 10 } }, input.expectedVersion, signal);
      const bounded = page(result.descriptors, { limit: result.descriptors.length });
      return { ...result, descriptors: bounded.items, nextOffset: bounded.nextOffset === null ? result.nextOffset : offset + bounded.nextOffset };
    }),
    tool('cad_resolve_topology', 'Convert up to 32 current edge picks into strict fillet/chamfer geometric selectors, or one planar face into an inward-shell opening query. Read-only: no feature is added. Pin the version/build from topology inspection, then use the returned selection/opening in cad_edit_document. Exact expected counts reject ambiguity; unsupported curves fail instead of broadening selection. Numeric selectors may need explicit parameter expressions when upstream dimensions change.', object({
      ...version, ...CadTopologyResolvePicksRequestSchema.properties, picks: Type.Array(CadTopologyPickSchema, { minItems: 1, maxItems: 32 })
    }), (cad, input, signal) => {
      const { expectedVersion, ...request } = input;
      return cad.resolveTopologyPicks(request, expectedVersion, signal);
    }),
    tool('cad_measure_sketch', 'Measure one validated sketch analytically in its local millimeter coordinates: paginated per-profile area (mm²), exact perimeter (mm), bounds (mm), total material area with nested holes/islands, and cut boundary length. Construction geometry is measured separately and excluded from cut totals. This measures the sketch, not a projection of the solid. Empty sketches return zero totals and null cut bounds.', object({ ...version, sketchId: id, ...pageFields }), async (cad, input, signal) => {
      const { profiles, ...measurement } = await cad.measureSketch(input.sketchId, input.expectedVersion, signal);
      return { version: input.expectedVersion, ...measurement, profiles: page(profiles, input) };
    }),
    tool('cad_save_document', 'Save the exact shared CAD draft through the active workbench adapter with cross-tab conflict detection and journal recovery. Returns a durable save receipt. Does not generate controller output.', object(version), (cad, input, signal) => cad.save(input.expectedVersion, signal), false),
    tool('cad_inspect_section', 'Compute a final solid section on XY, XZ or YZ with a parameterized offset along the plane normal (+Z, -Y or +X respectively). Returns paginated exact local 2D lines/arcs/circles and closed-contour count. Choose a plane inside the material. Tangent, open, branching, ellipse and spline sections are rejected; no approximation. Does not save.', object({ ...version, section: CadSectionRequestSchema, ...pageFields }), async (cad, input, signal) => {
      const result = await cad.inspectSection(input.section, input.expectedVersion, signal);
      const { entities, ...summary } = result;
      return { version: input.expectedVersion, ...summary, entities: page(entities, input) };
    }),
    tool('cad_send_section_to_cam', 'Save CAD and create/open a new detached CAM project from an exact final-solid planar section. Uses the same section checks as cad_inspect_section and the visible Section for CAM action. Plane-local millimeters, no final controller output; review CAM stock, wire and installed machine setup after transfer.', object({ ...version, section: CadSectionRequestSchema }), (cad, input, signal) => cad.sendSectionToCam(input.section, input.expectedVersion, signal), false),
    tool('cad_send_to_cam', 'Save CAD, then create and open a NEW detached CAM project from one selected sketch in local XY millimeters. Includes non-construction closed contours with exact lines/arcs. Does not project the final solid; does not overwrite CAM or generate controller output. Review CAM planning and the installed machine setup after handoff.', object({ ...version, sketchId: id }), (cad, input, signal) => cad.sendToCam(input.sketchId, input.expectedVersion, signal), false),
    tool('cad_export_document', 'Request a portable .cad.json download of the current draft, including parametric history. This is a browser download request, not proof the browser saved it.', object(version), (cad, input) => cad.exportDocument(input.expectedVersion), false),
    tool('cad_export_solid', 'Evaluate and request a STEP B-rep or STL mesh download of the current model. Failed features block export. Browser download request only.', object({ ...version, format: Type.Union([Type.Literal('step'), Type.Literal('stl')]) }), (cad, input, signal) => cad.exportSolid(input.format, input.expectedVersion, signal), false),
    tool('cad_export_dxf', 'Request an exact 2D DXF download of a selected sketch in local coordinates. Construction geometry is excluded. Does not project the solid.', object({ ...version, sketchId: id }), (cad, input, signal) => cad.exportDxf(input.sketchId, input.expectedVersion, signal), false)
  ];
}
