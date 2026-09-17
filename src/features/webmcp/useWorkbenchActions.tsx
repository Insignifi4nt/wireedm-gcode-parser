import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import type { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { prepareDxfProjectImport, previewDxfProjectImport, type DxfImportPreparation } from '@/domain/dxf/prepareDxfProjectImport';
import { commitDxfProjectImport } from '@/domain/dxf/importDxfProject';
import { importPortableUpidProject, exportPortableUpidProject } from '@/domain/upid/portableUpidProject';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import type { PreparedMachinePackageInstallation } from '@/domain/machine-package';
import type { ControllerProgramArtifact } from '@/domain/wire-edm-job/controllerArtifact';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import { identifier, projectEdit } from './projectEdits';
import { object, page, pageFields, siteTool, ToolError } from './siteTools';
import type { DraftReadSnapshot } from './workbenchSiteTools';

type App = ReturnType<typeof useWorkbenchAppController>;
const version = { expectedVersion: identifier };
const draftVersion = { draftVersion: identifier };
const source = object({ fileName: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^/\\\\]+$' }), text: Type.String({ minLength: 1, maxLength: 1024 * 1024 }) });
const activation = Type.Union([Type.Literal('package'), Type.Literal('keep-current')]);
const resolution = Type.Union([
  object({ kind: Type.Literal('install-new') }),
  object({ kind: Type.Literal('reuse-existing'), machineId: identifier, activate: activation }),
  object({ kind: Type.Literal('replace-existing'), machineId: identifier, activate: activation })
]);

export function useWorkbenchActions(app: App, draftRef: RefObject<DraftReadSnapshot | null>) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const preparedDxf = useRef<{ id: string; workbench: ConnectedWorkbenchCatalog; preparation: DxfImportPreparation } | null>(null);
  const preparedPackage = useRef<{ id: string; prepared: PreparedMachinePackageInstallation } | null>(null);
  const artifact = useRef<ControllerProgramArtifact | null>(null);
  const workbenchVersion = useMemo(() => crypto.randomUUID(), [app.connectedWorkbench, file]);
  const latestVersion = useRef(workbenchVersion);
  useLayoutEffect(() => { latestVersion.current = workbenchVersion; });

  function connected(expected?: string) {
    if (busy.current || app.workbenchInteractionLocked) throw new ToolError('BUSY', 'Another workbench operation is running.');
    if (!app.connectedWorkbench) throw new ToolError('WORKBENCH_UNAVAILABLE', 'Wait for the workbench to open.');
    if (expected && expected !== workbenchVersion) throw new ToolError('STALE_STATE', 'Read edm_workflow_context again.');
    return app.connectedWorkbench;
  }
  function draft(expected: string, requireSaved = false) {
    const current = draftRef.current;
    if (!current?.document || !current.projectId) throw new ToolError('WRONG_MODEL', 'Open a path project first.');
    if (current.version !== expected) throw new ToolError('STALE_STATE', 'Read edm_get_context again; the draft changed.');
    if (current.workflowOpen) throw new ToolError('WORKFLOW_OPEN', 'Finish or cancel the current editor workflow first.');
    if (requireSaved && current.dirty) throw new ToolError('UNSAVED_DRAFT', 'Save this draft before exporting.');
    return current;
  }
  function mutation<S extends TSchema>(name: string, description: string, schema: S, run: (input: Static<S>, signal: AbortSignal) => unknown | Promise<unknown>) {
    return siteTool(name, description, schema, async (input, signal) => {
      connected();
      busy.current = true;
      try { return await run(input, signal); }
      finally { busy.current = false; }
    }, false);
  }
  function checkVersion(expected: string) {
    if (expected !== latestVersion.current) throw new ToolError('STALE_STATE', 'Read edm_workflow_context again.');
  }
  async function textInput(inline: Static<typeof source> | undefined, signal: AbortSignal) {
    if (inline) {
      if (new TextEncoder().encode(inline.text).length > 1024 * 1024) throw new ToolError('INPUT_TOO_LARGE', 'Inline text is limited to 1 MiB. Use Agent input file for larger files.');
      return inline;
    }
    if (!file) throw new ToolError('FILE_REQUIRED', 'Upload a file with Agent input file, or provide inline text.');
    if (file.size > 64 * 1024 * 1024) throw new ToolError('INPUT_TOO_LARGE', 'Files must be 64 MiB or smaller.');
    const text = await file.text();
    signal.throwIfAborted();
    return { fileName: file.name, text };
  }
  async function openImported(workbench: ConnectedWorkbenchCatalog, projectId: string) {
    const loaded = await loadEditorProgram(workbench, projectId);
    return { workbench, ...(loaded.ok ? { editorProgram: loaded.editorProgram } : {}), value: { projectId, imported: true, opened: loaded.ok, ...(!loaded.ok ? { error: loaded.error } : {}) } };
  }
  const tools = [
    siteTool('edm_workflow_context', 'Read mutation version, uploaded input file, prepared imports and the most recent generated artifact. Upload files using the Agent input file button; browser storage belongs to this browser.', object({}), () => ({
      version: workbenchVersion, busy: busy.current || app.workbenchInteractionLocked,
      inputFile: file ? { name: file.name, size: file.size } : null,
      dxfPreparationId: preparedDxf.current?.id ?? null, packagePreparationId: preparedPackage.current?.id ?? null,
      artifact: artifact.current ? artifactSummary(artifact.current) : null
    })),
    mutation('edm_prepare_dxf', 'Preview uploaded DXF (or inline DXF text). Returns unit choices and millimeter bounds for explicit review before import. Does not save a project.', object({ ...version, source: Type.Optional(source) }), async (input, signal) => {
      checkVersion(input.expectedVersion);
      const workbench = app.connectedWorkbench!;
      const value = await textInput(input.source, signal);
      checkVersion(input.expectedVersion);
      if (!/\.dxf$/i.test(value.fileName)) throw new ToolError('WRONG_FILE', 'Choose a .dxf file.');
      const result = prepareDxfProjectImport(workbench, value);
      if (!result.ok) throw new ToolError(result.error.code, result.error.message);
      const id = crypto.randomUUID();
      preparedDxf.current = { id, workbench, preparation: result.preparation };
      return { preparationId: id, fileName: value.fileName, entityCount: result.preparation.entityCount,
        unsupportedEntityCount: result.preparation.unsupportedEntityCount, warningCount: result.preparation.warningCount,
        defaultUnitCandidateId: result.preparation.defaultUnitCandidateId,
        choices: result.preparation.unitCandidates.map(candidate => {
          const preview = previewDxfProjectImport(result.preparation, { unitCandidateId: candidate.id });
          return { ...candidate, preview: preview.ok ? { ok: true, preview: { ...preview.preview,
            geometryWarnings: preview.preview.geometryWarnings.slice(0, 10),
            omittedWarningCount: Math.max(0, preview.preview.geometryWarnings.length - 10)
          } } : preview };
        }) };
    }),
    mutation('edm_import_dxf', 'Import and open the exact prepared DXF using an explicitly chosen unit candidate. Rejects dirty drafts and changed workbenches. Acknowledge overriding declared units only when intended.', object({ ...version, preparationId: identifier, unitCandidateId: identifier, declaredUnitOverrideAcknowledged: Type.Boolean() }), async (input, signal) => {
      checkVersion(input.expectedVersion);
      const prepared = preparedDxf.current;
      if (!prepared || prepared.id !== input.preparationId || prepared.workbench !== app.connectedWorkbench) throw new ToolError('STALE_STATE', 'Prepare and review the DXF again.');
      signal.throwIfAborted();
      return app.runAgentWorkbenchOperation(async workbench => {
        const result = await commitDxfProjectImport(workbench, prepared.preparation, { ...input, confirmed: true });
        if (!result.ok) throw new ToolError(result.error.code, result.error.message);
        preparedDxf.current = null;
        return openImported(result.workbench, result.project.id);
      });
    }),
    mutation('edm_import_upid', 'Import and open a portable UPID JSON from Agent input file or inline text. Creates a new project; never replaces an existing draft.', object({ ...version, source: Type.Optional(source) }), async (input, signal) => {
      checkVersion(input.expectedVersion);
      const value = await textInput(input.source, signal);
      checkVersion(input.expectedVersion);
      signal.throwIfAborted();
      return app.runAgentWorkbenchOperation(async workbench => {
        const result = await importPortableUpidProject(workbench, value);
        if (!result.ok) throw new ToolError(result.error.code, result.error.message);
        return openImported(result.workbench, result.project.id);
      });
    }),
    mutation('edm_open_project', 'Open an existing saved project by ID. Save any dirty draft and finish its workflow first.', object({ ...version, projectId: identifier }), async input => {
      checkVersion(input.expectedVersion);
      return app.runAgentWorkbenchOperation(async workbench => {
        const loaded = await loadEditorProgram(workbench, input.projectId);
        if (!loaded.ok) throw new ToolError(loaded.error.code, loaded.error.message);
        return { workbench, editorProgram: loaded.editorProgram, value: { projectId: input.projectId, opened: true } };
      });
    }),
    mutation('edm_edit_project', 'Apply an atomic, undoable batch to the current draft. Coordinates/lengths are millimeters. start-point snaps to the nearest contour point and may split a segment. Null entry/exit explicitly reviews no lead. Read geometry and execution diagnostics before choosing machining intent; edits do not save.', object({ ...draftVersion, edits: Type.Array(projectEdit, { minItems: 1, maxItems: 50 }) }), input => {
      const current = draft(input.draftVersion);
      if (!current.edit) throw new ToolError('UNAVAILABLE', 'The editor is still opening.');
      current.edit(input.edits);
      return { edited: true, version: draftRef.current?.version, dirty: draftRef.current?.dirty };
    }),
    mutation('edm_draft_history', 'Undo or redo one complete editor change, including an agent edit batch. Does not save.', object({ ...draftVersion, direction: Type.Union([Type.Literal('undo'), Type.Literal('redo')]) }), input => ({ changed: draft(input.draftVersion).history?.(input.direction) ?? false, version: draftRef.current?.version })),
    mutation('edm_save_project', 'Save the exact current draft into its existing project. Rejects a changed draft or open workflow. Read fresh context after saving.', object(draftVersion), async input => {
      const current = draft(input.draftVersion);
      const saved = await app.handleSaveEditorDraft({ model: 'upid-document', pathDocument: current.document! });
      if (!saved) throw new ToolError('SAVE_FAILED', 'Save failed. Read the visible save diagnostic; the draft is retained.');
      return { saved: true, projectId: saved.project.id, updatedAt: saved.project.updatedAt };
    }),
    siteTool('edm_review_execution', 'Compile the current draft into ordered execution events or actionable diagnostics. Paginated events include generated wire actions and program stops. Successful compilation is not post/machine certification; generation runs those checks.', object({ ...draftVersion, ...pageFields }), input => {
      connected();
      const current = draft(input.draftVersion);
      const result = compileWireEdmExecutionPlan(current.document!);
      return result.ok ? { executablePlan: true, version: current.version, dirty: current.dirty, requirements: result.plan.requirements, ...page(result.plan.events, input) }
        : { executablePlan: false, version: current.version, ...page(result.diagnostics, input) };
    }),
    mutation('edm_prepare_machine_package', 'Validate and preview the uploaded complete .wireedm-package. Returns machine identity, setup, post hashes, and collision choices before installation. Does not install.', object(version), async (input, signal) => {
      checkVersion(input.expectedVersion);
      if (!file || !/\.wireedm-package$/i.test(file.name)) throw new ToolError('FILE_REQUIRED', 'Upload a complete .wireedm-package using Agent input file.');
      const result = await app.handlePrepareMachinePackage(file);
      signal.throwIfAborted();
      checkVersion(input.expectedVersion);
      if (!result.ok) throw new ToolError(result.error.code, result.error.message);
      const id = crypto.randomUUID();
      preparedPackage.current = { id, prepared: result.prepared };
      return { preparationId: id, preview: result.preview };
    }),
    mutation('edm_install_machine_package', 'Install the reviewed exact package with an explicit collision resolution. Uses the normal package validator, catalog fingerprint checks and installation transaction. This can replace the named machine when replace-existing is chosen.', object({ ...version, preparationId: identifier, resolution }), async (input, signal) => {
      checkVersion(input.expectedVersion);
      const prepared = preparedPackage.current;
      if (!prepared || prepared.id !== input.preparationId) throw new ToolError('STALE_STATE', 'Prepare the package again.');
      signal.throwIfAborted();
      if (!await app.handleCommitMachinePackage(prepared.prepared, input.resolution)) throw new ToolError('INSTALL_FAILED', 'Installation failed. Review the visible package diagnostic and prepare again.');
      preparedPackage.current = null;
      return { installed: true, packageHash: prepared.prepared.preview.packageHash };
    }),
    mutation('edm_activate_setup', 'Activate an installed machine setup by exact machine and binding IDs from edm_get_capabilities.', object({ ...version, machineId: identifier, bindingId: identifier }), async input => {
      checkVersion(input.expectedVersion);
      if (!await app.handleActivateMachineSetup(input.machineId, input.bindingId)) throw new ToolError('ACTIVATION_FAILED', 'The setup could not be activated. Review the settings diagnostic.');
      return { activated: true, machineId: input.machineId, bindingId: input.bindingId };
    }),
    mutation('edm_generate_controller', 'Generate audited controller output from the saved current project and exact active setup. Requires a clean draft. Persists an immutable revision. Does not download or run a machine. Reuse the returned artifact ID for reading/downloading; do not generate repeatedly.', object({ ...version, ...draftVersion, machineId: identifier, bindingId: identifier }), async input => {
      checkVersion(input.expectedVersion);
      draft(input.draftVersion, true);
      const machine = app.connectedWorkbench!.machines.machines.find(machine => machine.id === input.machineId);
      if (!machine || machine.activeBindingId !== input.bindingId) throw new ToolError('STALE_STATE', 'The active setup changed. Read capabilities again.');
      const result = await app.handleGenerateControllerArtifact({ machineId: input.machineId });
      if (!result.ok) return { generated: false, error: result.error };
      artifact.current = result.artifact;
      return { generated: true, ...artifactSummary(result.artifact) };
    }),
    siteTool('edm_read_artifact', 'Read a bounded text chunk of the exact generated controller file. Offsets count JavaScript UTF-16 characters; chunks preserve original line endings. No regeneration.', object({ artifactId: identifier, offset: Type.Optional(Type.Integer({ minimum: 0 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })) }), input => {
      const current = requireArtifact(input.artifactId);
      const offset = input.offset ?? 0;
      const text = current.text.slice(offset, offset + (input.length ?? 2000));
      return { ...artifactSummary(current), text, nextOffset: offset + text.length < current.text.length ? offset + text.length : null };
    }),
    mutation('edm_download_artifact', 'Request download of an exact generated artifact by ID, preserving its post-controlled name, encoding and line endings. Reports a browser download request, not an on-disk receipt.', object({ artifactId: identifier }), async input => {
      const current = requireArtifact(input.artifactId);
      await downloadProgramFile({ fileName: current.fileName, text: current.text });
      return { status: 'download-requested', ...artifactSummary(current) };
    }),
    mutation('edm_export_upid', 'Download the saved current project as portable UPID JSON. Requires a clean draft; includes geometry and machining intent for another browser.', object(draftVersion), async input => {
      const current = draft(input.draftVersion, true);
      const result = await exportPortableUpidProject(app.connectedWorkbench!, current.projectId!);
      if (!result.ok) throw new ToolError(result.error.code, result.error.message);
      await downloadProgramFile({ ...result.file, mimeType: 'application/json;charset=utf-8' });
      return { status: 'download-requested', fileName: result.file.fileName };
    })
  ];
  function requireArtifact(id: string) {
    const current = artifact.current;
    if (!current || current.revisionId !== id) throw new ToolError('NOT_FOUND', 'This page has no generated artifact with that ID. Read edm_workflow_context.');
    return current;
  }
  const fileControl = <>
    <button type="button" className="h-7 border border-border px-2 text-xs text-muted-foreground" disabled={app.workbenchInteractionLocked} title={file ? `Agent input: ${file.name}` : 'Upload a DXF, UPID or machine package for agent tools'} onClick={() => inputRef.current?.click()}>Agent input file</button>
    <input ref={inputRef} type="file" aria-label="Agent input file" className="hidden" accept=".dxf,.json,.wireedm-package" onChange={event => { setFile(event.target.files?.[0] ?? null); event.target.value = ''; preparedDxf.current = null; preparedPackage.current = null; }} />
  </>;
  return { tools, fileControl };
}

function artifactSummary(artifact: ControllerProgramArtifact) {
  return { artifactId: artifact.revisionId, fileName: artifact.fileName, sha256: artifact.sha256, post: artifact.post, output: artifact.output, characterCount: artifact.text.length };
}
