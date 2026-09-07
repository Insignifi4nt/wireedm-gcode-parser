import { describe, expect, it } from 'vitest';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { importPortableUpidProject, exportPortableUpidProject } from '@/domain/upid/portableUpidProject';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import {
  setCircleOperationCenterPierceLeadIn,
  setClosedOperationStartNearPoint,
  setGeometryLinkedInitialWirePosition,
  translatePathDocument
} from '../pathDocumentOperations';

describe('circular start lifecycle', () => {
  it('keeps center entry and initial wire links valid through repeated start splits and placement', async () => {
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    const operationId = source.plan.operations[0].id;
    const linked = setGeometryLinkedInitialWirePosition(source, source.segments[0].id)!;
    const entry = setCircleOperationCenterPierceLeadIn(linked, operationId)!;
    const split = setClosedOperationStartNearPoint(entry, operationId, { x: 10, y: 25 })!;
    const splitAgain = setClosedOperationStartNearPoint(split, operationId, { x: 15, y: 20 })!;
    const placed = translatePathDocument(splitAgain, { x: 30, y: -10 })!;

    for (const document of [split, splitAgain, placed]) {
      expect(validateUpidDocument(JSON.parse(JSON.stringify(document))).structurallyValid).toBe(true);
      expect(resolveInitialWirePosition(document).status).toBe('ready');
      expect(compileWireEdmExecutionPlan(document).ok).toBe(true);
    }
    expect(resolveInitialWirePosition(placed)).toMatchObject({ point: { x: 40, y: 10 } });
    expect(placed.plan.operations[0].transitions?.entry).toMatchObject({
      strategy: 'circle-center', from: { x: 40, y: 10 }, to: { x: 45, y: 10 }
    });
    expect(source.segments[0].kind).toBe('circle');

    const initialized = await initializeWorkbenchCatalog(new MemoryAdapter());
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importPortableUpidProject(initialized.workbench, {
      fileName: 'split-circle.upid.json', text: JSON.stringify({ format: 'upid', schemaVersion: 1, document: placed })
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const exported = await exportPortableUpidProject(imported.workbench, imported.project.id);
    if (!exported.ok) throw new Error(exported.error.message);
    const reopened = await importPortableUpidProject(imported.workbench, { fileName: exported.file.fileName, text: exported.file.text });
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(resolveInitialWirePosition(reopened.pathDocument)).toMatchObject({ status: 'ready', point: { x: 40, y: 10 } });
    expect(compileWireEdmExecutionPlan(reopened.pathDocument).ok).toBe(true);
  });

  it('allows an arc center as an initial coordinate but rejects center entry on a mixed semicircle', () => {
    const source = createUpidFromDxfEntities([
      { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5,
        start: { x: 5, y: 0 }, end: { x: -5, y: 0 }, startAngle: 0, endAngle: 180, clockwise: false },
      { type: 'line', layer: 'CUT', start: { x: -5, y: 0 }, end: { x: 5, y: 0 } }
    ]);
    const arc = source.segments.find((segment) => segment.kind === 'arc')!;
    const linked = setGeometryLinkedInitialWirePosition(source, arc.id)!;
    const operation = linked.plan.operations[0];
    expect(resolveInitialWirePosition(linked)).toMatchObject({ status: 'ready', point: { x: 0, y: 0 } });
    expect(validateUpidDocument(linked).structurallyValid).toBe(true);
    expect(setCircleOperationCenterPierceLeadIn(linked, operation.id)).toBeNull();
    operation.transitions = { entry: { strategy: 'circle-center', move: 'cut',
      from: { x: 0, y: 0 }, to: operation.startPoint, sourceSegmentId: arc.id } };
    expect(validateUpidDocument(linked).structuralDiagnostics).toContainEqual(expect.objectContaining({
      code: 'upid-invalid-value', message: expect.stringContaining('complete circular contour')
    }));
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Circular start lifecycle';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
