import { CadError } from '../../../domain/cad/cadError';
import { cadFeatureProducesBody, parseCadDocument } from '../../../domain/cad/cadSchema';
import { parseCadSectionRequest } from '../../../domain/cad/cadSection';
import { parseCadTopologyInspectRequest, parseCadTopologyResolvePicksRequest } from '../../../domain/cad/cadTopology';
import { buildCadKernelModel, type CadKernelModel } from './cadKernelModel';
import type { CadKernelReply } from './cadKernelProtocol';
import { parseCadSolidImportSource } from '../../../domain/cad/cadImports';
import { prepareCadSolidImport } from './cadKernelImport';
import { importCadDxfSketch, parseCadDxfImportInput } from '../../../domain/cad/cadDxfImport';
import { importCadDxfCurve, parseCadDxfCurveImportInput } from '../../../domain/cad/cadCurveDxf';

/** Inspections never initialize WASM or reconstruct a missing/stale native snapshot. */
export function createCadKernelRuntime(initialize: () => Promise<void>) {
  let cached: { key: string; model: CadKernelModel } | undefined;
  return {
    async evaluate(request: Record<string, unknown> & { id: number; kind: string }): Promise<CadKernelReply> {
      try {
        if (!['build', 'export', 'section', 'inspect-topology', 'resolve-topology-picks', 'import-solid', 'import-dxf', 'import-dxf-curve'].includes(request.kind)) throw new CadError('unsupported-operation', 'Unsupported CAD worker operation.');
        if (request.kind === 'import-dxf') return { id: request.id, kind: 'dxf-imported', result: importCadDxfSketch(parseCadDxfImportInput(request.input)) };
        if (request.kind === 'import-dxf-curve') return { id: request.id, kind: 'dxf-curve-imported', result: importCadDxfCurve(parseCadDxfCurveImportInput(request.input)) };
        if (request.kind === 'import-solid') {
          const source = parseCadSolidImportSource(request.source);
          await initialize();
          return { id: request.id, kind: 'solid-imported', result: prepareCadSolidImport(source) };
        }
        if (request.kind === 'export' && request.format !== 'step' && request.format !== 'stl') throw new CadError('unsupported-format', 'Unsupported CAD export format.');
        const document = parseCadDocument(request.document);
        const key = JSON.stringify(document);
        if (request.kind === 'inspect-topology') {
          const inspection = parseCadTopologyInspectRequest(request.inspection);
          if (!cached || cached.key !== key || cached.model.result.buildId !== inspection.expectedBuildId) throw new CadError('STALE_BUILD', 'The displayed exact model is no longer cached. Rebuild and select again.');
          return { id: request.id, kind: 'topology-inspected', result: cached.model.inspectTopology(inspection) };
        }
        if (request.kind === 'resolve-topology-picks') {
          const selection = parseCadTopologyResolvePicksRequest(request.selection);
          if (!cached || cached.key !== key || cached.model.result.buildId !== selection.expectedBuildId) throw new CadError('STALE_BUILD', 'The displayed exact model is no longer cached. Rebuild and select again.');
          return { id: request.id, kind: 'topology-resolved', result: cached.model.resolveTopologyPicks(selection) };
        }
        if (document.features.some(feature => !feature.suppressed && cadFeatureProducesBody(feature))) await initialize();
        if (!cached || cached.key !== key) {
          cached?.model.dispose(); cached = undefined;
          cached = { key, model: buildCadKernelModel(document) };
        }
        if (request.kind === 'build') return { id: request.id, kind: 'built', result: cached.model.result };
        if (request.kind === 'export') return { id: request.id, kind: 'exported', blob: cached.model.export(request.format === 'step' ? 'step' : 'stl') };
        return { id: request.id, kind: 'sectioned', result: cached.model.section(parseCadSectionRequest(request.section)) };
      } catch (error) {
        return { id: request.id, kind: 'error', message: error instanceof Error ? error.message : 'The CAD kernel could not complete this operation.',
          ...(error instanceof CadError ? { code: error.code } : {}) };
      }
    },
    dispose() { cached?.model.dispose(); cached = undefined; },
  };
}
