import { Type } from '@sinclair/typebox';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { readStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { readSavedRevisionSummaryPage } from '@/domain/wire-edm-job/revisionSummaries';
import { APP_VERSION } from '@/domain/release/appRelease';
import { startPackageTool } from '@/features/package-tools/packageToolsClient';
import { object, page, pageFields, siteTool, ToolError } from './siteTools';

export interface DraftReadSnapshot {
  projectId: string | null;
  version: string;
  document: PathPlanningDocument | null;
  dirty: boolean;
  workflowOpen: boolean;
  workflowCommand?: string;
  edit?: (edits: readonly import('./projectEdits').ProjectEdit[]) => void;
  history?: (direction: 'undo' | 'redo') => boolean;
}
export interface WorkbenchToolState {
  workbench: ConnectedWorkbenchCatalog | null;
  draft: DraftReadSnapshot | null;
  busy: boolean;
}
const id = Type.String({ minLength: 1, maxLength: 160 });
const target = Type.Union([
  object({ kind: Type.Literal('current-draft'), version: id }),
  object({ kind: Type.Literal('saved-project'), projectId: id, version: Type.Optional(id) })
]);

export function workbenchSiteTools(getState: () => WorkbenchToolState) {
  function connected() {
    const current = getState();
    if (!current.workbench) throw new ToolError('WORKBENCH_UNAVAILABLE', 'Wait for the workbench to open.');
    if (current.busy) throw new ToolError('BUSY', 'A workbench operation is in progress. Retry when it completes.');
    return current.workbench;
  }
  async function saved(projectId: string) {
    const workbench = connected();
    const result = await readStoredWorkbenchProject(workbench, projectId);
    if (getState().workbench !== workbench) throw new ToolError('STALE_STATE', 'Workbench changed. Read context again.');
    if (!result.ok) throw new ToolError(result.error.code, 'The selected saved project could not be read.');
    return result.project;
  }
  async function resolve(input: typeof target.static) {
    if (input.kind === 'current-draft') {
      const draft = getState().draft;
      if (!draft || draft.version !== input.version) throw new ToolError('STALE_STATE', 'Draft changed or closed. Read edm_get_context again.');
      const { edit: _edit, history: _history, ...snapshot } = draft;
      return { ...snapshot, kind: input.kind };
    }
    const project = await saved(input.projectId);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(project)));
    const version = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (input.version && input.version !== version) throw new ToolError('STALE_STATE', 'Saved project changed. Read it again without a version.');
    return { kind: input.kind, projectId: project.id, version, dirty: false, workflowOpen: false,
      document: project.content.kind === 'upid-document' ? project.content.document as PathPlanningDocument : null };
  }
  return [
    siteTool('edm_get_context', 'Read app version, storage kind and the current editor draft identity/version. Does not open or change a project.', object({}), () => {
      const current = getState();
      return { appVersion: APP_VERSION, storage: current.workbench?.adapter.kind ?? null, busy: current.busy,
        draft: current.draft ? { projectId: current.draft.projectId, version: current.draft.version, dirty: current.draft.dirty, workflowOpen: current.draft.workflowOpen, model: current.draft.document ? 'upid' : 'external-gcode' } : null,
        packageWorkbench: `${import.meta.env.BASE_URL}package-tools/` };
    }),
    siteTool('edm_list_projects', 'List active saved projects without opening them. Pin catalogVersion when requesting subsequent pages.', object({ ...pageFields, catalogVersion: Type.Optional(id) }), (input) => {
      const workbench = connected();
      const version = workbench.manifest.updatedAt;
      if (input.catalogVersion && input.catalogVersion !== version) throw new ToolError('STALE_STATE', 'Project catalog changed. Restart the listing.');
      return { catalogVersion: version, ...page(workbench.manifest.projects.map(({ id, name, sourceKind, updatedAt }) => ({ id, name, sourceKind, updatedAt })), input) };
    }),
    siteTool('edm_get_project', 'Read an explicit current draft or saved project summary. Draft reads require the current version from edm_get_context. Counts and recorded diagnostics are not executable certification.', object({ target }), async (input) => {
      const { document, ...snapshot } = await resolve(input.target);
      return { ...snapshot, model: document ? 'upid' : 'external-gcode', ...(document ? {
        units: 'mm', schemaVersion: document.schemaVersion, geometryBasis: document.geometryBasis,
        setup: document.setup ?? {}, options: document.options,
        counts: { operations: document.plan.operations.length, contours: document.contours.length, segments: document.segments.length },
        diagnostics: document.diagnostics.slice(0, 20), omittedDiagnosticCount: Math.max(0, document.diagnostics.length - 20)
      } : {}) };
    }),
    siteTool('edm_query_geometry', 'Read UPID operation/contour summaries or exact segments in millimeters from a versioned target. For segments, optionally filter by operationId to obtain cutting order and reversed flags.', object({ target, kind: Type.Union([Type.Literal('operations'), Type.Literal('contours'), Type.Literal('segments')]), operationId: Type.Optional(id), ...pageFields }), async (input) => {
      const snapshot = await resolve(input.target);
      const doc = snapshot.document;
      if (!doc) throw new ToolError('WRONG_MODEL', 'Geometry queries require a UPID project.');
      if (input.operationId && input.kind !== 'segments') throw new ToolError('INVALID_ARGUMENT', 'operationId applies only to segment queries.');
      let rows: readonly unknown[];
      if (input.kind === 'operations') rows = doc.plan.operations.map(({ segmentRefs, provenance: _provenance, ...operation }) => ({ ...operation, segmentCount: segmentRefs.length }));
      else if (input.kind === 'contours') rows = doc.contours.map(({ approximatePolygon: _polygon, provenance: _provenance, ...contour }) => contour);
      else if (input.operationId) {
        const operation = doc.plan.operations.find(({ id }) => id === input.operationId);
        if (!operation) throw new ToolError('NOT_FOUND', 'Operation does not exist in this document.');
        const segments = new Map(doc.segments.map((segment) => [segment.id, segment]));
        rows = operation.segmentRefs.map((ref) => ({ ...segments.get(ref.segmentId), reversed: ref.reversed }));
      } else rows = doc.segments;
      return { version: snapshot.version, kind: input.kind, units: 'mm', ...page(rows, input) };
    }),
    siteTool('edm_get_capabilities', 'Read installed machines, active setup IDs and precise declared post capabilities. Does not change a setup or claim that a project is executable.', object(pageFields), (input) => {
      const workbench = connected();
      return page(workbench.machines.machines.map((machine) => ({ id: machine.id, name: machine.name, activeBindingId: machine.activeBindingId,
        hardware: machine.hardware, limits: machine.limits,
        setups: machine.bindings.map((binding) => ({ id: binding.id, name: binding.name, post: binding.post, properties: binding.properties, verification: binding.verification,
          capabilities: workbench.posts.installations.find(({ ref }) => ref.packageId === binding.post.packageId && ref.version === binding.post.version && ref.contentHash === binding.post.contentHash)?.package.manifest.capabilities ?? null }))
      })), input);
    }),
    siteTool('edm_list_revisions', 'Read a bounded page of saved revision display metadata for a project. Missing or corrupt rows remain visible. Does not generate controller output.', object({ projectId: id, page: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })), version: Type.Optional(id) }), async (input) => {
      const project = await saved(input.projectId);
      if (input.version && input.version !== project.updatedAt) throw new ToolError('STALE_STATE', 'Project revision list changed. Restart the listing.');
      const workbench = connected();
      const rows = await readSavedRevisionSummaryPage(workbench.adapter, project.id, project.savedRevisionIds, input.page ?? 0, 10);
      if (getState().workbench !== workbench) throw new ToolError('STALE_STATE', 'Workbench changed while reading.');
      return { version: project.updatedAt, items: rows.map(({ loadError, ...row }) => ({ ...row, ...(loadError ? { loadError: 'Revision metadata unavailable or invalid.' } : {}) })),
        total: project.savedRevisionIds.length, nextPage: ((input.page ?? 0) + 1) * 10 < project.savedRevisionIds.length ? (input.page ?? 0) + 1 : null };
    }),
    siteTool('edm_validate_upid', 'Validate supplied portable UPID JSON without importing, saving or running a post. Reports structure/planning diagnostics only, not machine or controller readiness. Maximum 512 KiB UTF-8.', object({ text: Type.String({ minLength: 1, maxLength: 512 * 1024 }) }), async (input, signal) => {
      const checked = await startPackageTool({ operation: 'validate-upid', text: input.text }, signal).result;
      return checked.report;
    })
  ];
}
