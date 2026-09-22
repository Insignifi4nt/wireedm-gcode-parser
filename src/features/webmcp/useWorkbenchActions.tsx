import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import type { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { prepareDxfProjectImport, previewDxfProjectImport, type DxfImportPreparation } from '@/domain/dxf/prepareDxfProjectImport';
import { commitDxfProjectImport } from '@/domain/dxf/importDxfProject';
import { importPortableUpidProject } from '@/domain/upid/portableUpidProject';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import type { PreparedMachinePackageInstallation } from '@/domain/machine-package';
import type { ControllerProgramArtifact } from '@/domain/wire-edm-job/controllerArtifact';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { workbenchProjectVersion } from '@/domain/workbench-catalog/workbenchProjectVersion';
import { identifier, projectEdit } from './projectEdits';
import { object, page, pageFields, siteTool, ToolError } from './siteTools';
import type { DraftReadSnapshot } from './workbenchSiteTools';
import { downloadPreviewCapture, preparePreviewCapture, type PreviewCaptureArtifact } from './previewCapture';
import { summarizeDiagnostic, summarizeDiagnostics, summarizeMessage } from './diagnosticSummaries';
import { machinePackageInputFile, machinePackageSource } from './machinePackageInput';

type App = ReturnType<typeof useWorkbenchAppController>;
const version = { expectedVersion: identifier };
const draftVersion = { draftVersion: identifier };
const controllerInput = object({ ...version, ...draftVersion, machineId: identifier, bindingId: identifier });
const source = object({ fileName: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^/\\\\]+$' }), text: Type.String({ minLength: 1, maxLength: 1024 * 1024 }) });
const activation = Type.Union([Type.Literal('package'), Type.Literal('keep-current')]);
const resolution = Type.Union([
  object({ kind: Type.Literal('install-new') }),
  object({ kind: Type.Literal('reuse-existing'), machineId: identifier, activate: activation }),
  object({ kind: Type.Literal('replace-existing'), machineId: identifier, activate: activation })
]);

export function useWorkbenchActions(app: App, draftRef: RefObject<DraftReadSnapshot | null>) {
  const busy = useRef(false);
  const preparedDxf = useRef<{ id: string; workbench: ConnectedWorkbenchCatalog; preparation: DxfImportPreparation } | null>(null);
  const preparedPackage = useRef<{ id: string; prepared: PreparedMachinePackageInstallation } | null>(null);
  const artifact = useRef<ControllerProgramArtifact | null>(null);
  const [capture, setCapture] = useState<PreviewCaptureArtifact | null>(null);
  const workbenchVersion = useMemo(() => crypto.randomUUID(), [app.connectedWorkbench]);
  const latestVersion = useRef(workbenchVersion);
  useLayoutEffect(() => { latestVersion.current = workbenchVersion; });
  useEffect(() => () => {
    if (capture) window.setTimeout(() => URL.revokeObjectURL(capture.previewUrl), 60_000);
  }, [capture]);

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
  function textInput(inline: Static<typeof source> | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!inline) throw new ToolError('FILE_REQUIRED', 'Provide source: { fileName, text }. For a larger file, use the ordinary Import control.');
    if (new TextEncoder().encode(inline.text).length > 1024 * 1024) throw new ToolError('INPUT_TOO_LARGE', 'Inline text is limited to 1 MiB UTF-8. Use the ordinary Import control for larger files.');
    return inline;
  }
  async function openImported(workbench: ConnectedWorkbenchCatalog, projectId: string) {
    const loaded = await loadEditorProgram(workbench, projectId);
    return { workbench, ...(loaded.ok ? { editorProgram: loaded.editorProgram } : {}), value: { projectId, imported: true, opened: loaded.ok, ...(!loaded.ok ? { error: loaded.error } : {}) } };
  }
  async function generate(input: Static<typeof controllerInput>, signal: AbortSignal) {
    const check = () => {
      checkVersion(input.expectedVersion);
      draft(input.draftVersion, true);
      const machine = app.connectedWorkbench!.machines.machines.find(machine => machine.id === input.machineId);
      if (!machine || machine.activeBindingId !== input.bindingId) throw new ToolError('STALE_STATE', 'The active setup changed. Read capabilities again.');
    };
    check();
    const result = await app.handleGenerateControllerArtifact({ machineId: input.machineId, signal, beforeWrite: check });
    if (result.ok) artifact.current = result.artifact;
    return result;
  }
  const tools = [
    siteTool('edm_workflow_context', 'Read mutation version, direct-input limits, prepared imports and the most recent generated artifact. Import tools accept supplied text or package base64; browser storage belongs to this browser.', object({}), () => ({
      version: workbenchVersion, busy: busy.current || app.workbenchInteractionLocked,
      inputFile: null,
      inputLimits: { textUtf8Bytes: 1024 * 1024, machinePackageBytes: 32 * 1024 * 1024, packageEncoding: 'base64' },
      dxfPreparationId: preparedDxf.current?.id ?? null, packagePreparationId: preparedPackage.current?.id ?? null,
      artifact: artifact.current ? artifactSummary(artifact.current) : null,
      capture,
      nextSteps: !draftRef.current ? ['edm_list_projects', 'edm_open_project', 'edm_prepare_dxf', 'edm_import_upid']
        : !draftRef.current.document ? ['edm_capture_preview', 'Use the visible editor for external G-code changes.']
        : draftRef.current.workflowOpen ? ['Finish or cancel the visible editor workflow.']
        : draftRef.current.dirty ? ['edm_describe_edits', 'edm_edit_project', 'edm_review_execution', 'edm_save_project']
        : ['edm_describe_edits', 'edm_review_execution', 'edm_get_capabilities', 'edm_export_controller', 'edm_export_upid', 'edm_capture_preview']
    })),
    mutation('edm_prepare_dxf', 'Preview supplied DXF source:{fileName,text}, at most 1 MiB UTF-8. Returns unit choices and millimeter bounds for explicit review before import. Does not save a project. Use ordinary Import for larger files.', object({ ...version, source: Type.Optional(source) }), async (input, signal) => {
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
    mutation('edm_import_upid', 'Import and open supplied portable UPID JSON source:{fileName,text}, at most 1 MiB UTF-8. Creates a new project; never replaces an existing draft. Use ordinary Import for larger files.', object({ ...version, source: Type.Optional(source) }), async (input, signal) => {
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
        : { executablePlan: false, version: current.version, ...page(result.diagnostics.map(summarizeDiagnostic), input) };
    }),
    mutation('edm_prepare_machine_package', 'Validate and preview a supplied complete .wireedm-package via source:{fileName,base64}. Use plain canonical padded base64 archive bytes, at most 32 MiB decoded; no paths, URLs or standalone posts. Returns machine identity, setup, post hashes and collision choices before installation. Does not install.', object({ ...version, source: machinePackageSource }), async (input, signal) => {
      checkVersion(input.expectedVersion);
      preparedPackage.current = null;
      const packageFile = await machinePackageInputFile(input.source, signal);
      checkVersion(input.expectedVersion);
      const result = await app.handlePrepareMachinePackage(packageFile);
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
      let installationStarted = false;
      const installed = await app.handleCommitMachinePackage(prepared.prepared, input.resolution, { beforeWrite: () => {
        signal.throwIfAborted(); checkVersion(input.expectedVersion);
        installationStarted = true;
      } });
      if (!installed) {
        const error = { code: 'INSTALL_FAILED', message: 'Installation failed. Review the visible package diagnostic and prepare again.' };
        if (installationStarted && signal.aborted) return { installed: false, status: 'installation-failed', error };
        throw new ToolError(error.code, error.message);
      }
      preparedPackage.current = null;
      return { installed: true, packageHash: prepared.prepared.preview.packageHash };
    }),
    mutation('edm_activate_setup', 'Activate an installed machine setup by exact machine and binding IDs from edm_get_capabilities.', object({ ...version, machineId: identifier, bindingId: identifier }), async input => {
      checkVersion(input.expectedVersion);
      if (!await app.handleActivateMachineSetup(input.machineId, input.bindingId)) throw new ToolError('ACTIVATION_FAILED', 'The setup could not be activated. Review the settings diagnostic.');
      return { activated: true, machineId: input.machineId, bindingId: input.bindingId };
    }),
    mutation('edm_generate_controller', 'Generate audited controller output from the saved current project and exact active setup. Requires a clean draft. Persists an immutable revision. Does not download or run a machine. Reuse the returned artifact ID for reading/downloading; do not generate repeatedly.', controllerInput, async (input, signal) => {
      const result = await generate(input, signal);
      if (!result.ok) return generationFailure(result);
      return { generated: true, ...artifactSummary(result.artifact) };
    }),
    mutation('edm_export_controller', 'Generate and request download of controller output in one action, using the same saved-draft, exact active-setup and audited-post checks as the export UI. Persists one immutable revision. On generated:true, reuse its artifactId for retries; do not generate another revision just to download.', controllerInput, async (input, signal) => {
      const result = await generate(input, signal);
      if (!result.ok) return generationFailure(result);
      const summary = artifactSummary(result.artifact);
      if (signal.aborted) return { generated: true, status: 'generated-download-not-requested', ...summary };
      try {
        await app.handleDownloadEditorFile({ fileName: result.artifact.fileName, text: result.artifact.text });
        return { generated: true, status: 'download-requested', ...summary };
      } catch {
        return { generated: true, status: 'generated-download-failed', ...summary,
          error: { code: 'DOWNLOAD_FAILED', message: 'The artifact was generated. Retry edm_download_artifact with its artifactId.' } };
      }
    }),
    siteTool('edm_read_artifact', 'Read a bounded text chunk of the exact generated controller file. Offsets count JavaScript UTF-16 characters; chunks preserve original line endings. No regeneration.', object({ artifactId: identifier, offset: Type.Optional(Type.Integer({ minimum: 0 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4000 })) }), input => {
      const current = requireArtifact(input.artifactId);
      const offset = input.offset ?? 0;
      const text = current.text.slice(offset, offset + (input.length ?? 2000));
      return { ...artifactSummary(current), text, nextOffset: offset + text.length < current.text.length ? offset + text.length : null };
    }),
    mutation('edm_download_artifact', 'Request download of an exact generated artifact by ID, preserving its post-controlled name, encoding and line endings. Reports a browser download request, not an on-disk receipt.', object({ artifactId: identifier }), async input => {
      const current = requireArtifact(input.artifactId);
      await app.handleDownloadEditorFile({ fileName: current.fileName, text: current.text });
      return { status: 'download-requested', ...artifactSummary(current) };
    }),
    mutation('edm_export_upid', 'Download the saved current project as portable UPID JSON. Requires a clean draft; includes geometry and machining intent for another browser. For a saved library project without opening it, use edm_export_saved_upid.', object(draftVersion), async (input, signal) => {
      const current = draft(input.draftVersion, true);
      const savedProject = app.loadedEditorProgram?.project;
      if (!savedProject || savedProject.id !== current.projectId) throw new ToolError('STALE_STATE', 'The editor changed. Read context again.');
      const expectedProjectVersion = await workbenchProjectVersion(savedProject);
      signal.throwIfAborted();
      draft(input.draftVersion, true);
      return app.requestUpidProjectExport(current.projectId!, { expectedProjectVersion, signal, beforeDownload: () => { draft(input.draftVersion, true); } });
    }),
    mutation('edm_export_saved_upid', 'Download an explicit saved library project as portable UPID JSON without opening it or replacing the editor draft. Pass savedProjectVersion from edm_get_project with a saved-project target; expectedVersion comes from edm_workflow_context. Unsaved edits are excluded.', object({ ...version, projectId: identifier, savedProjectVersion: identifier }), async (input, signal) => {
      checkVersion(input.expectedVersion);
      return app.requestUpidProjectExport(input.projectId, { expectedProjectVersion: input.savedProjectVersion, signal,
        beforeDownload: () => checkVersion(input.expectedVersion) });
    }),
    mutation('edm_capture_preview', 'Capture the actual current 2D or 3D editor preview as a bounded PNG artifact. 2D shows the editor draft; 3D simulates the saved project and excludes unsaved edits. Excludes app panels and desktop contents. Returns contentSource, a local preview URL and image hash, not inline model image content. Set download:true to request the PNG download. Requires the current draftVersion; does not edit or save.', object({ ...draftVersion, download: Type.Optional(Type.Boolean()) }), async (input, signal) => {
      const current = draftRef.current;
      if (!current || current.version !== input.draftVersion) throw new ToolError('STALE_STATE', 'Read edm_get_context again; the editor changed.');
      if (!current.capture) throw new ToolError('CAPTURE_UNAVAILABLE', 'Open a drawable 2D or 3D editor preview first.');
      const image = await current.capture(signal);
      const captured = await preparePreviewCapture(image, { projectId: current.projectId, draftVersion: current.version, dirty: current.dirty }, signal);
      if (draftRef.current?.version !== input.draftVersion || signal.aborted) {
        URL.revokeObjectURL(captured.previewUrl);
        signal.throwIfAborted();
        throw new ToolError('STALE_STATE', 'The draft changed while capturing. Read context and capture again.');
      }
      setCapture(captured);
      if (input.download) {
        try { downloadPreviewCapture(captured); }
        catch { return { status: 'captured-download-failed', ...captured,
          error: { code: 'DOWNLOAD_FAILED', message: 'The PNG was captured. Use the Preview PNG link to retry its download.' } }; }
      }
      return { status: input.download ? 'download-requested' : 'captured', ...captured };
    })
  ];
  function requireArtifact(id: string) {
    const current = artifact.current;
    if (!current || current.revisionId !== id) throw new ToolError('NOT_FOUND', 'This page has no generated artifact with that ID. Read edm_workflow_context.');
    return current;
  }
  const previewControl = capture && <a className="px-2 text-xs text-muted-foreground underline" href={capture.previewUrl} download={capture.fileName} title={`Download captured ${capture.source.toUpperCase()} preview (${capture.contentSource === 'saved-project' ? 'saved project' : capture.dirty ? 'unsaved draft' : 'saved draft'})`}>Preview PNG</a>;
  return { tools, previewControl };
}

function artifactSummary(artifact: ControllerProgramArtifact) {
  return { artifactId: artifact.revisionId, fileName: artifact.fileName, sha256: artifact.sha256, post: artifact.post, output: artifact.output, characterCount: artifact.text.length };
}

function generationFailure(result: Extract<Awaited<ReturnType<App['handleGenerateControllerArtifact']>>, { ok: false }>) {
  const error = result.error;
  return { generated: false, error: { ...error, ...summarizeMessage(error.message),
    ...('diagnostics' in error ? summarizeDiagnostics<(typeof error.diagnostics)[number]>(error.diagnostics) : {})
  }, ...(result.savedRevisionId ? { savedRevisionId: result.savedRevisionId } : {}) };
}
