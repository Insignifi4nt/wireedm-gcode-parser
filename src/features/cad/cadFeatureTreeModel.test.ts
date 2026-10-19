import { describe, expect, it } from 'vitest';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { cadFeatureTreeRelationships } from './cadFeatureTreeModel';

const sketch = (id: string, plane: string | null = null): CadFeature => ({ id, name: id, kind: 'sketch', suppressed: false, plane: plane ? { kind: 'datum-plane', featureId: plane } : 'XY', offset: 0, profiles: [] });
const pad = (id: string, sketchId: string): CadFeature => ({ id, name: id, kind: 'extrude', suppressed: false, sketchId, distance: 5, symmetric: false, operation: 'new', targetId: null });

describe('specification tree relationships', () => {
  it('nests a sketch under its first solid consumer and shares it with later ones', () => {
    const features = [{ id: 'datum', name: 'datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [0, 0, 0] } } as CadFeature,
      sketch('outline', 'datum'), pad('pad', 'outline'), pad('second', 'outline')];
    const tree = cadFeatureTreeRelationships(features);
    expect(tree.owner.get('outline')?.id).toBe('pad');
    expect(tree.children.get('pad')?.map(feature => feature.id)).toEqual(['outline']);
    expect(tree.shared.get('second')?.map(feature => feature.id)).toEqual(['outline']);
    // Datum planes and solid inputs stay in the top-level history.
    expect(tree.owner.has('datum')).toBe(false);
    expect(tree.downstream.get('outline')?.map(feature => feature.id)).toEqual(['pad', 'second']);
  });
  it('keeps a sketch at the top level when its consumer comes earlier in history', () => {
    const tree = cadFeatureTreeRelationships([pad('pad', 'late'), sketch('late')]);
    expect(tree.owner.has('late')).toBe(false);
    expect(tree.position.get('late')).toBe(2);
  });
});
