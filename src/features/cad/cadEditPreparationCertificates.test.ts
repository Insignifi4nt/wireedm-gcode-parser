// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadBenchmarkDragPreview } from './benchmark/cadBenchmarkCases';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

vi.mock('@/domain/cad/cadSketchGraph', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/cad/cadSketchGraph')>();
  return { ...original, checkCadSketchGraph: vi.fn(original.checkCadSketchGraph) };
});

describe('edit preparation of unchanged sketches', () => {
  it('checks none of their relations again when a parse found their geometry valid under the same values', async () => {
    const { document, edit } = createCadBenchmarkDragPreview(4, 2), [, ...unchanged] = document.features;
    const graphs = new Set(unchanged.map(feature => feature.kind === 'sketch' ? feature.graph : null));
    vi.mocked(checkCadSketchGraph).mockClear();
    const prepared = await prepareCadEdits(document, [edit], createCadSketchTestSolver());
    prepared.document.features.slice(1).forEach((feature, index) => expect(feature).toBe(unchanged[index]));
    expect(vi.mocked(checkCadSketchGraph).mock.calls.filter(([graph]) => graphs.has(graph))).toHaveLength(0);
    // The dragged sketch is solved and checked.
    expect(vi.mocked(checkCadSketchGraph)).toHaveBeenCalled();
  });
});
