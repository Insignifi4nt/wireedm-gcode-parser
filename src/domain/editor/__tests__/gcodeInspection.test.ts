import { describe, expect, it } from 'vitest';
import { inspectGCodeProgram } from '../gcodeInspection';
import { parseGCodeProgram } from '../gcodeParser';
import { buildEditorPreviewGeometry } from '../previewGeometry';
import { organizeGCodeStructure } from '../gcodeStructure';

describe('read-only G-code inspection', () => {
  it('preserves source lines and inventories compact/decimal codes without reading comments as commands', () => {
    const text = 'N10 G21\r\nN20 g01X1Y2 (G999)\rN30 G01 X2 G1 Y3 ; G39\nN40 G39';
    const inspected = inspectGCodeProgram(text);
    expect(inspected.lines.map(line => line.text)).toEqual(['N10 G21', 'N20 g01X1Y2 (G999)', 'N30 G01 X2 G1 Y3 ; G39', 'N40 G39']);
    expect(inspected.commands.find(command => command.code === 'G1')).toMatchObject({ count: 3, sourceLines: [2, 3], coverage: 'modeled' });
    expect(inspected.commands.find(command => command.code === 'G39')).toMatchObject({ count: 1, sourceLines: [4], coverage: 'controller-specific' });
    expect(inspected.commands.some(command => command.code === 'G999')).toBe(false);
    expect(inspected.lines[3].after.compensation).toBe('unknown');
    expect(inspected.preview.status).toBe('limited');
  });

  it('uses explicit scoped exported-program centers and G39 annotations without requiring G60', () => {
    const result = inspectGCodeProgram('G3 X0 Y10 I0 J0\nG41\nG39', {
      defaults: { units: 'mm', initialPosition: { x: 10, y: 0 } },
      lineContexts: [{ line: 1, ijMode: 'absolute' }, { line: 3, commands: [{ code: 'G39', meaning: 'Cancel compensation', scope: 'exact-post@revision', compensation: 'off' }] }]
    });
    expect(result.parseResult.path.at(-1)).toMatchObject({ type: 'arc', startX: 10, startY: 0, centerX: 0, centerY: 0 });
    expect(result.lines[2].after.compensation).toBe('off');
    expect(result.commands.find(command => command.code === 'G39')).toMatchObject({ meaning: 'Cancel compensation', scope: 'exact-post@revision' });
    expect(inspectGCodeProgram('G39').lines[0].after.compensation).toBe('unknown');
    expect(result.parseResult.coordinateUnits).toBe('mm');
  });

  it('fits an explicit initial position into the preview without altering ordinary legacy parsing', () => {
    const inspected = inspectGCodeProgram('G1 X20 Y0', { defaults: { units: 'mm', initialPosition: { x: -5, y: 2 } } });
    expect(inspected.parseResult.bounds).toMatchObject({ minX: -5, minY: 0, maxX: 20, maxY: 2 });
    expect(buildEditorPreviewGeometry(inspected.parseResult).paths[0].start).toEqual({ x: -5, y: 2 });
    expect(parseGCodeProgram('G1 X20 Y0').path).toEqual([{ type: 'cut', x: 20, y: 0, line: 1 }]);
  });

  it('does not interpret dwell coordinates as modal movement or lose its known position', () => {
    const inspected = inspectGCodeProgram('G21\nG1 X1 Y1\nG4 X99\nX2 Y2');
    expect(inspected.parseResult.path.map(point => 'x' in point ? point.x : point.endX)).toEqual([1, 2]);
    expect(inspected.lines[2].after.position).toEqual({ x: 1, y: 1 });
    expect(inspected.lines[2].after.positionKnown).toBe(true);
    expect(buildEditorPreviewGeometry(inspected.parseResult).paths.at(-1)?.start).toEqual({ x: 1, y: 1 });
  });

  it.each(['G999', 'G81 X5 Y5 Z-1', 'M98 P10'])('does not fabricate inherited movement after %s', control => {
    const inspected = inspectGCodeProgram(`G21\nG1 X1 Y1\n${control}\nX6 Y6\nX7 Y7\nG1 X8 Y8\nX9 Y9`);
    expect(inspected.parseResult.path.map(point => point.line)).toEqual([2, 6, 7]);
    expect(inspected.lines[4].after.positionKnown).toBe(false);
    const geometry = buildEditorPreviewGeometry(inspected.parseResult);
    expect(geometry.paths.map(path => path.line)).toEqual([2, 7]);
    expect(geometry.paths[1].start).toEqual({ x: 8, y: 8 });
  });

  it('reports unknown G words sharing explicit motion and refuses to execute their block', () => {
    const result = parseGCodeProgram('G21\nG1 X1 Y1\nG999 G1 X99 Y99\nG1 X2 Y2');
    expect(result.warnings).toContainEqual(expect.objectContaining({ line: 3, message: expect.stringContaining('Unknown G-code command G999') }));
    expect(result.path.map(point => point.line)).toEqual([2, 4]);
    expect(buildEditorPreviewGeometry(result).paths.map(path => path.line)).toEqual([2]);
  });

  it('breaks plane/frame transitions and requires complete positioning rather than connecting old coordinates', () => {
    const frame = inspectGCodeProgram('G21\nG1 X1 Y1\nG54\nG1 X2 Y2\nG1 X3 Y3');
    expect(frame.lines[2].after.positionKnown).toBe(false);
    expect(buildEditorPreviewGeometry(frame.parseResult).paths.map(path => path.line)).toEqual([2, 5]);
    const plane = inspectGCodeProgram('G21\nG0 X1 Y0\nG18\nG3 X0 Y1 I-1 J0\nG17\nG0 X0 Y1\nG1 X2 Y1');
    expect(plane.parseResult.stats.arcMoves).toBe(0);
    expect(buildEditorPreviewGeometry(plane.parseResult).paths.map(path => path.line)).toEqual([2, 7]);
  });

  it('cannot restore an unknown omitted axis through partial G92 and starts a fresh fragment after a complete reset', () => {
    const result = inspectGCodeProgram('G21\nG1 X1 Y1\nG28\nG92 X5\nG1 X6 Y6\nG28\nG92 X2 Y2\nG1 X3 Y3');
    expect(result.lines[3].after.positionKnown).toBe(false);
    expect(result.lines[3].diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Partial G92') }));
    expect(buildEditorPreviewGeometry(result.parseResult).paths.at(-1)?.start).toEqual({ x: 2, y: 2 });
    const structure = organizeGCodeStructure(['G1 X1 Y1', 'G999', 'G1 X100 Y100', 'G1 X101 Y100']);
    expect(structure.body.contours?.filter(contour => contour.length === 1)).toHaveLength(1);
    const knownReset = parseGCodeProgram('G21\nG0 X0 Y0\nG1 X10 Y0\nG92 X0 Y0\nG1 X1 Y0');
    expect(buildEditorPreviewGeometry(knownReset).paths.at(-1)?.start).toEqual({ x: 0, y: 0 });
  });

  it.each(['G1 G0 X10 Y5', 'G90 G91 G1 X10 Y5', 'G20 G21 G1 X10 Y5'])(
    'omits conflicting modal block %s without a last-word-wins preview', block => {
      const result = inspectGCodeProgram(`G21\n${block}`);
      expect(result.lines[1].previewStatus).toBe('omitted');
      expect(result.parseResult.path).toEqual([]);
      expect(result.lines[1].diagnostics).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('Conflicting commands') }));
    }
  );

  it.each(['G1 X#1 Y2', 'G1 X Y2', '/G1 X2 Y2', 'G1 X2.3.4 Y2'])('does not execute malformed or conditional block %s', block => {
    const inspected = inspectGCodeProgram(`G21\nG1 X1 Y1\n${block}\nX3 Y3\nG1 X4 Y4`);
    expect(inspected.lines[2].previewStatus).toBe('omitted');
    expect(inspected.lines[2].diagnostics.length).toBeGreaterThan(0);
    expect(inspected.parseResult.path.map(point => point.line)).toEqual([2, 5]);
  });

  it('omits an exact post motion the conventional interpreter cannot represent and discloses post-end source motion', () => {
    const result = inspectGCodeProgram('G21\nG0 X1 Y0\nG2 X0 Y1 I-1 J0\nM2\nG1 X3 Y3', {
      lineContexts: [{ line: 3, previewUnsupported: 'Exact post arc direction differs from conventional G2.' }]
    });
    expect(result.parseResult.stats.arcMoves).toBe(0);
    expect(result.commands.find(command => command.code === 'G2')?.coverage).toBe('recognized-not-modeled');
    expect(result.diagnostics.some(issue => issue.message.includes('program-end marker'))).toBe(true);
  });

  it('retains the source trace but withholds geometry whose finite endpoints overflow its extent', () => {
    const source = 'G21\nG0 X-1e308 Y0\nG1 X1e308 Y0';
    const result = inspectGCodeProgram(source);
    expect(result.preview.status).toBe('unavailable');
    expect(result.parseResult.errors).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('finite numeric representation')
    }));
    expect(result.lines.map(line => line.text).join('\n')).toBe(source);
    expect(result.lines[2].after.position).toEqual({ x: 1e308, y: 0 });
    expect(result.parseResult.path).toEqual([]);
    expect(Object.values(buildEditorPreviewGeometry(result.parseResult).viewBox).every(Number.isFinite)).toBe(true);
    expect(parseGCodeProgram(source).path).toHaveLength(2);
  });

  it('breaks inspection continuation after invalid numeric or arc geometry while preserving legacy parsing', () => {
    for (const [position, failed, recovery] of [
      ['G1 X1 Y1', 'G1 X1e309 Y2', 'G1 X3 Y3'],
      ['G1 X1 Y1', 'X1e309', 'G1 X3 Y3'],
      ['G1 X1e308 Y1', 'G91 G1 X1e308 Y1', 'G90 G1 X3 Y3'],
      ['G1 X1 Y1', 'G3 X2 Y2 R0', 'G1 X3 Y3']
    ]) {
      const source = `G21\n${position}\n${failed}\n${recovery}\nG1 X4 Y4`;
      const inspected = inspectGCodeProgram(source);
      expect(inspected.lines[2].previewStatus).toBe('omitted');
      expect(inspected.lines[2].after.positionKnown).toBe(false);
      const preview = buildEditorPreviewGeometry(inspected.parseResult);
      expect(preview.paths.map(path => path.line)).toEqual([2, 5]);
      expect(preview.paths.at(-1)?.start).toEqual({ x: 3, y: 3 });
      expect(buildEditorPreviewGeometry(parseGCodeProgram(source)).paths.map(path => path.line)).toEqual([2, 4, 5]);
    }
  });
});
