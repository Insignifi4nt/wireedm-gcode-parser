import { Type } from '@sinclair/typebox';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { readStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { readSavedRevisionSummaryPage } from '@/domain/wire-edm-job/revisionSummaries';
import { APP_VERSION } from '@/domain/release/appRelease';
import type { recoverySourceSummary } from '@/domain/storage/workbenchRecovery';
import { workbenchProjectVersion } from '@/domain/workbench-catalog/workbenchProjectVersion';
import { startPackageTool } from '@/features/package-tools/packageToolsClient';
import { object, page, pageFields, siteTool, ToolError } from './siteTools';
import { editCatalogTool } from './editCatalog';
import { summarizeDiagnostics } from './diagnosticSummaries';
import { sourceIdentifier } from './projectEdits';
import { capabilityVersion, machineCapabilityRow, machineSetupJson, setupCapabilityRow } from './capabilityQueries';

export interface DraftReadSnapshot {
  projectId: string | null;
  version: string;
  document: PathPlanningDocument | null;
  dirty: boolean;
  workflowOpen: boolean;
  workflowCommand?: string;
  edit?: (edits: readonly import('./projectEdits').ProjectEdit[]) => void;
  history?: (direction: 'undo' | 'redo') => boolean;
  capture?: (signal: AbortSignal) => Promise<import('./previewCapture').EditorPreviewCapture>;
}
export interface WorkbenchToolState {
  workbench: ConnectedWorkbenchCatalog | null;
  draft: DraftReadSnapshot | null;
  busy: boolean;
  recovery?: ReturnType<typeof recoverySourceSummary> | null;
}
const id = Type.String({ minLength: 1, maxLength: 160 });
const target = Type.Union([
  object({ kind: Type.Literal('current-draft'), version: id }),
  object({ kind: Type.Literal('saved-project'), projectId: id, version: Type.Optional(id) })
]);
const capabilityInput = Type.Union([
  object({ ...pageFields, kind: Type.Optional(Type.Literal('machines')), capabilityVersion: Type.Optional(id) }),
  object({ ...pageFields, kind: Type.Literal('setups'), machineId: id, capabilityVersion: id })
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
  async function capabilities(expected?: string) {
    const workbench = connected();
    const version = await capabilityVersion(workbench);
    if (getState().workbench !== workbench) throw new ToolError('STALE_STATE', 'Workbench changed while reading capabilities. Restart discovery.');
    if (getState().busy) throw new ToolError('BUSY', 'A workbench operation is in progress. Retry when it completes.');
    if (expected && expected !== version) throw new ToolError('STALE_STATE', 'Installed machines or post capabilities changed. Restart edm_get_capabilities.');
    return { workbench, version };
  }
  async function resolve(input: typeof target.static) {
    if (input.kind === 'current-draft') {
      const draft = getState().draft;
      if (!draft || draft.version !== input.version) throw new ToolError('STALE_STATE', 'Draft changed or closed. Read edm_get_context again.');
      const { edit: _edit, history: _history, capture: _capture, ...snapshot } = draft;
      return { ...snapshot, kind: input.kind };
    }
    const project = await saved(input.projectId);
    const version = await workbenchProjectVersion(project);
    if (input.version && input.version !== version) throw new ToolError('STALE_STATE', 'Saved project changed. Read it again without a version.');
    return { kind: input.kind, projectId: project.id, version, dirty: false, workflowOpen: false,
      document: project.content.kind === 'upid-document' ? project.content.document as PathPlanningDocument : null };
  }
  return [
    editCatalogTool(),
    siteTool('edm_get_context', 'Read app version, storage kind and the current editor draft identity/version. Does not open or change a project.', object({}), () => {
      const current = getState();
      return { appVersion: APP_VERSION, storage: current.workbench?.adapter.kind ?? null, busy: current.busy, recovery: current.recovery ?? null,
        draft: current.draft ? { projectId: current.draft.projectId, version: current.draft.version, dirty: current.draft.dirty, workflowOpen: current.draft.workflowOpen,
          workflowCommand: current.draft.workflowOpen ? current.draft.workflowCommand ?? null : null,
          model: current.draft.document ? 'upid' : 'external-gcode', captureAvailable: Boolean(current.draft.capture),
          editsAvailable: Boolean(current.draft.document && current.draft.edit && !current.draft.workflowOpen && !current.busy) } : null,
        guide: `${import.meta.env.BASE_URL}documentation/agents/`,
        packageWorkbench: `${import.meta.env.BASE_URL}package-tools/` };
    }),
    siteTool('edm_list_projects', 'List active saved projects without opening them. Pin catalogVersion when requesting subsequent pages.', object({ ...pageFields, catalogVersion: Type.Optional(id) }), (input) => {
      const workbench = connected();
      const version = workbench.manifest.updatedAt;
      if (input.catalogVersion && input.catalogVersion !== version) throw new ToolError('STALE_STATE', 'Project catalog changed. Restart the listing.');
      return { catalogVersion: version, ...page(workbench.manifest.projects, input, ({ id, name, sourceKind, updatedAt }) => ({ id, name, sourceKind, updatedAt })) };
    }),
    siteTool('edm_get_project', 'Read an explicit current draft or saved project summary. Draft reads require the current version from edm_get_context. Counts and recorded diagnostics are not executable certification.', object({ target }), async (input) => {
      const { document, ...snapshot } = await resolve(input.target);
      return { ...snapshot, model: document ? 'upid' : 'external-gcode', ...(document ? {
        units: 'mm', schemaVersion: document.schemaVersion, geometryBasis: document.geometryBasis,
        setup: document.setup ?? {}, options: document.options,
        counts: { operations: document.plan.operations.length, contours: document.contours.length, segments: document.segments.length },
        ...summarizeDiagnostics(document.diagnostics)
      } : {}) };
    }),
    siteTool('edm_query_geometry', 'Read UPID operation/contour summaries or exact segments in millimeters from a versioned target. For segments, optionally filter by operationId to obtain cutting order and reversed flags.', object({ target, kind: Type.Union([Type.Literal('operations'), Type.Literal('contours'), Type.Literal('segments')]), operationId: Type.Optional(sourceIdentifier), ...pageFields }), async (input) => {
      const snapshot = await resolve(input.target);
      const doc = snapshot.document;
      if (!doc) throw new ToolError('WRONG_MODEL', 'Geometry queries require a UPID project.');
      if (input.operationId && input.kind !== 'segments') throw new ToolError('INVALID_ARGUMENT', 'operationId applies only to segment queries.');
      let rows: ReturnType<typeof page>;
      if (input.kind === 'operations') rows = page(doc.plan.operations, input, ({ segmentRefs, provenance: _provenance, ...operation }) => ({ ...operation, segmentCount: segmentRefs.length }));
      else if (input.kind === 'contours') rows = page(doc.contours, input, ({ approximatePolygon: _polygon, provenance: _provenance, ...contour }) => contour);
      else if (input.operationId) {
        const operation = doc.plan.operations.find(({ id }) => id === input.operationId);
        if (!operation) throw new ToolError('NOT_FOUND', 'Operation does not exist in this document.');
        const segments = new Map(doc.segments.map((segment) => [segment.id, segment]));
        rows = page(operation.segmentRefs, input, ref => ({ ...segments.get(ref.segmentId), reversed: ref.reversed }));
      } else rows = page(doc.segments, input);
      return { version: snapshot.version, kind: input.kind, units: 'mm', ...rows };
    }),
    siteTool('edm_get_capabilities', 'Read installed machines and exact post capabilities. Pin returned capabilityVersion across pages. Default retains complete small machine rows; kind:machines always lists compact machines. setupsOmitted means request kind:setups with exact machineId/version. Large setup omittedDetails remain available through edm_read_machine_setup. Does not activate or certify a job.', capabilityInput, async (input) => {
      const { workbench, version } = await capabilities(input.capabilityVersion);
      if (input.kind === 'setups') {
        const machine = workbench.machines.machines.find(machine => machine.id === input.machineId);
        if (!machine) throw new ToolError('NOT_FOUND', 'The requested installed machine does not exist.');
        return { capabilityVersion: version, kind: input.kind, machineId: machine.id, activeBindingId: machine.activeBindingId,
          ...page(machine.bindings, input, binding => setupCapabilityRow(workbench, binding)) };
      }
      return { capabilityVersion: version, ...(input.kind ? { kind: input.kind } : {}),
        ...page(workbench.machines.machines, input, machine => machineCapabilityRow(workbench, machine, input.kind === 'machines')) };
    }),
    siteTool('edm_read_machine_setup', 'Read complete exact installed setup JSON including post hash, properties, compatibility, verification and capabilities. Requires machineId/bindingId/capabilityVersion from discovery. Offsets count JavaScript UTF-16 code units; concatenate text chunks and parse JSON. Does not activate, edit or certify a setup.', object({ machineId: id, bindingId: id, capabilityVersion: id,
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })) }), async input => {
      const { workbench, version } = await capabilities(input.capabilityVersion);
      const machine = workbench.machines.machines.find(machine => machine.id === input.machineId);
      const binding = machine?.bindings.find(binding => binding.id === input.bindingId);
      if (!binding) throw new ToolError('NOT_FOUND', 'The requested installed machine setup does not exist.');
      const text = machineSetupJson(workbench, binding), offset = input.offset ?? 0;
      const chunk = text.slice(offset, offset + (input.length ?? 4000));
      return { capabilityVersion: version, machineId: machine!.id, bindingId: binding.id, format: 'json', offsetUnit: 'utf16-code-units',
        offset, text: chunk, totalCharacterCount: text.length, nextOffset: offset + chunk.length < text.length ? offset + chunk.length : null };
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
