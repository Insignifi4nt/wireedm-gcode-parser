import { describe, expect, it } from 'vitest';

import { organizeGCodeStructure, type GCodeContourGroup } from '../gcodeStructure';

function toolpaths(lines: string[]): GCodeContourGroup[] {
  return (organizeGCodeStructure(lines).body.contours ?? []).filter((group) => group.type !== 'loose');
}

function squareEndingAtY(endY: string) {
  return ['G90', 'G0 X0 Y0', 'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', `G1 X0 Y${endY}`, 'M30'];
}

function clockwiseArcEndingAtY(endY: string) {
  return ['G90', 'G0 X10 Y0', `G2 X10 Y${endY} I-10 J0`, 'M30'];
}

describe('G-code structure position match tolerance', () => {
  it('classifies a toolpath that ends 4e-5 mm from its start as closed', () => {
    const [toolpath] = toolpaths(squareEndingAtY('0.00004'));

    expect(toolpath).toMatchObject({ type: 'toolpath-closed', startCoord: { x: 0, y: 0 } });
  });

  it('classifies a toolpath that ends 3e-4 mm from its start as open', () => {
    const [toolpath] = toolpaths(squareEndingAtY('0.0003'));

    expect(toolpath).toMatchObject({ type: 'toolpath-open', startCoord: { x: 0, y: 0 } });
  });
});

describe('G-code structure full-circle position tolerance', () => {
  it('measures a centre-format arc that ends 4e-10 mm from its start as a full circle', () => {
    const [toolpath] = toolpaths(clockwiseArcEndingAtY('-0.0000000004'));

    expect(toolpath.length).toBeCloseTo(20 * Math.PI, 9);
  });

  it('measures a centre-format arc that ends 3e-9 mm from its start as a tiny arc', () => {
    const [toolpath] = toolpaths(clockwiseArcEndingAtY('-0.000000003'));

    expect(toolpath.length).toBeGreaterThan(0);
    expect(toolpath.length).toBeLessThan(1e-6);
  });
});
