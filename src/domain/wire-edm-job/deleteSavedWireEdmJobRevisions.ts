import {
  beginRevisionDeletionTransaction,
  finishSavedRevisionTransaction,
  recoverSavedRevisionTransaction
} from '@/domain/storage/savedRevisionTransaction';
import { recoverProjectTrashTransaction } from '@/domain/storage/projectTrashTransaction';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import {
  WORKBENCH_CATALOG_PATH,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogManifest
} from '@/domain/workbench-catalog/workbenchCatalog';
import { parseWorkbenchProjectDocument, serializeWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import type { WorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import {
  validateWorkbenchProjectPathOwnership,
  workbenchProjectDocumentPath,
  workbenchProjectRevisionPath
} from '@/domain/workbench-catalog/workbenchProjectStorage';

type DeletionResult =
  | { readonly ok: true; readonly workbench: ConnectedWorkbenchCatalog; readonly project: WorkbenchProjectDocument; readonly deletedCount: number }
  | { readonly ok: false; readonly error: { readonly code: 'REVISION_DELETION_FAILED'; readonly message: string } };

/** Removes a selected set and its project index in one recoverable storage operation. */
export function deleteStoredWireEdmJobRevisions(
  workbench: ConnectedWorkbenchCatalog,
  input: { readonly projectId: string; readonly revisionIds: readonly string[]; readonly deletedAt: Date }
): Promise<DeletionResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const adapter = workbench.adapter;
    const recoveredTrash = await recoverProjectTrashTransaction(adapter);
    if (!recoveredTrash.ok) return failure(recoveredTrash.error.message);
    const recoveredRevision = await recoverSavedRevisionTransaction(adapter);
    if (!recoveredRevision.ok) return failure(recoveredRevision.error.message);
    const selection = new Set(input.revisionIds);
    if (!selection.size || selection.size !== input.revisionIds.length) {
      return failure('Select one or more distinct saved revisions to delete.');
    }
    if (!Number.isFinite(input.deletedAt.getTime())) return failure('Invalid deletion time.');

    try {
      const previousManifest = await adapter.readText(WORKBENCH_CATALOG_PATH);
      if (previousManifest === null || JSON.stringify(JSON.parse(previousManifest)) !== JSON.stringify(workbench.manifest)) {
        return failure('The workbench changed. Reopen the revision list before deleting.');
      }
      const ownership = await validateWorkbenchProjectPathOwnership(adapter, workbench.manifest.projects);
      if (!ownership.ok) return failure(ownership.error.message);
      const project = ownership.projects.find(({ id }) => id === input.projectId);
      if (!project) return failure('The project is no longer in this workbench.');
      if (![...selection].every((id) => project.savedRevisionIds.includes(id))) {
        return failure('The revision list changed. Reopen it before deleting.');
      }

      const documentPath = workbenchProjectDocumentPath(project.id);
      const previousProject = await adapter.readText(documentPath);
      if (previousProject === null) return failure('The project file is missing.');
      const deletedAt = input.deletedAt.toISOString();
      const parsedProject = parseWorkbenchProjectDocument(JSON.stringify({
        ...project,
        updatedAt: deletedAt,
        savedRevisionIds: project.savedRevisionIds.filter((id) => !selection.has(id))
      }));
      if (!parsedProject.ok) return failure(parsedProject.error.message);
      const serializedProject = serializeWorkbenchProjectDocument(parsedProject.project);
      if (!serializedProject.ok) return failure(serializedProject.error.message);
      const nextManifest: WorkbenchCatalogManifest = {
        ...workbench.manifest,
        updatedAt: deletedAt,
        projects: workbench.manifest.projects.map((entry) => entry.id === project.id
          ? { ...entry, updatedAt: deletedAt }
          : entry)
      };
      const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
      const begun = await beginRevisionDeletionTransaction(adapter, {
        projectId: project.id,
        revisionIds: [...selection],
        previousProject,
        nextProject: serializedProject.text,
        previousManifest,
        nextManifest: nextManifestText
      });
      if (!begun.ok) return failure(begun.error.message);

      try {
        await adapter.writeText(documentPath, serializedProject.text);
        if (await adapter.readText(documentPath) !== serializedProject.text) throw new Error('Project index did not read back exactly.');
        await adapter.writeText(WORKBENCH_CATALOG_PATH, nextManifestText);
        if (await adapter.readText(WORKBENCH_CATALOG_PATH) !== nextManifestText) throw new Error('Workbench manifest did not read back exactly.');
        for (const revisionId of selection) {
          const path = workbenchProjectRevisionPath(project.id, revisionId);
          await adapter.deleteText(path);
          if (await adapter.readText(path) !== null) throw new Error(`Could not remove ${revisionId}.`);
        }
        const finished = await finishSavedRevisionTransaction(adapter);
        if (!finished.ok) throw new Error(finished.error.message);
        return {
          ok: true,
          workbench: Object.freeze({ ...workbench, manifest: Object.freeze(nextManifest) }),
          project: parsedProject.project,
          deletedCount: selection.size
        };
      } catch (error) {
        const recovered = await recoverSavedRevisionTransaction(adapter);
        if (!recovered.ok) return failure(`${message(error)}; recovery failed: ${recovered.error.message}`);
        if (await adapter.readText(documentPath) === serializedProject.text &&
            await adapter.readText(WORKBENCH_CATALOG_PATH) === nextManifestText) {
          return {
            ok: true,
            workbench: Object.freeze({ ...workbench, manifest: Object.freeze(nextManifest) }),
            project: parsedProject.project,
            deletedCount: selection.size
          };
        }
        return failure(message(error));
      }
    } catch (error) {
      return failure(message(error));
    }
  });
}

function failure(message: string): DeletionResult {
  return { ok: false, error: { code: 'REVISION_DELETION_FAILED', message } };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
