import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '../cadSchema';

/** A rectangle beside the Y axis, revolved about it by `angle` degrees. */
function lathe(angle: number) {
  return { ...createCadDocument('Lathe part', 'lathe_part'), features: [
    { id: 'lathe_sketch', name: 'Lathe sketch', suppressed: false, kind: 'sketch', plane: 'XY', offset: 0, profiles: [
      { id: 'lathe_outline', name: 'Outline', construction: false, geometry: { kind: 'rectangle', x: 5, y: 500, width: 4, height: 10, cornerRadius: 0 } }] },
    { id: 'lathe', name: 'Lathe', suppressed: false, kind: 'revolve', sketchId: 'lathe_sketch', angle, axis: 'y', operation: 'new', targetId: null }
  ] };
}

describe('revolve minimum angle', () => {
  it('accepts a revolve of 3e-7 degrees', () => {
    const revolve = parseCadDocument(lathe(3e-7)).features.find(feature => feature.id === 'lathe');
    expect(revolve).toMatchObject({ kind: 'revolve', angle: 3e-7 });
  });

  it('refuses a revolve of 4e-8 degrees as zero', () => {
    expect(() => parseCadDocument(lathe(4e-8))).toThrow(expect.objectContaining({ code: 'invalid-dimension', message: expect.stringMatching(/Revolve angle must be greater than zero/) }));
  });
});
