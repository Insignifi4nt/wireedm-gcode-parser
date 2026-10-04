import { describe, expect, it } from 'vitest';
import { inspectGCodeProgram } from '../gcodeInspection';
import { parseGCodeProgram } from '../gcodeParser';
import { buildEditorPreviewGeometry } from '../previewGeometry';

describe('broader nominal G-code inspection', () => {
  it('recognizes path/feed and machine-control settings without erasing valid modal XY continuation', () => {
    const source = 'G21 G90\nG0 X0 Y0\nG64 P0.01\nG93 F30\nG1 X1 Y1\nM19 R0\nM48\nM62 P1\nX2 Y2';
    const result = inspectGCodeProgram(source);
    expect(result.commands.find(command => command.code === 'G64')).toMatchObject({ coverage: 'recognized-not-modeled' });
    expect(result.commands.find(command => command.code === 'M62')?.scope).toContain('LinuxCNC');
    expect(result.diagnostics.some(issue => issue.message.includes('Unknown G-code command'))).toBe(false);
    expect(result.lines[5].after.position).toEqual({ x: 1, y: 1 });
    expect(result.lines[5].after.positionKnown).toBe(true);
    expect(buildEditorPreviewGeometry(result.parseResult).paths.at(-1)).toMatchObject({ start: { x: 1, y: 1 }, end: { x: 2, y: 2 } });
    expect(result.preview.status).toBe('limited');
    // Both surfaces share recognition; the old editor's geometry omission stays unchanged.
    const legacy = parseGCodeProgram('G21\nG1 X1 Y1\nG64\nX2 Y2');
    expect(legacy.warnings).toContainEqual(expect.objectContaining({ message: expect.stringContaining('Recognized command; this source preview does not model its effects') }));
    expect(legacy.warnings.some(issue => issue.message.includes('Unknown G-code command G64'))).toBe(false);
    expect(legacy.path.map(point => point.line)).toEqual([2]);
  });

  it('recognizes unsupported motion families but never uses their parameters or following coordinates as an old G1', () => {
    for (const command of ['G5 X4 Y4 I1 J1 P1 Q1', 'G33 X4 Y4 K1', 'G38.2 X4 Y4 F100', 'G73 X4 Y4 Z-1 R1', 'G65 P10', 'M97 P10']) {
      const source = `G21\nG1 X1 Y1\n${command}\nX6 Y6\nG1 X7 Y7\nX8 Y8`;
      const result = inspectGCodeProgram(source);
      expect(result.commands[2].coverage).not.toBe('unknown');
      expect(result.lines[2].after.positionKnown).toBe(false);
      expect(result.lines[3].previewStatus).toBe('omitted');
      expect(buildEditorPreviewGeometry(result.parseResult).paths.map(path => path.line)).toEqual([2, 6]);
    }
  });

  it('keeps unknown and user-defined M commands inventoried without trusting label-only context as motion support', () => {
    for (const code of ['M999', 'M123']) {
      const result = inspectGCodeProgram(`G21\nG1 X1 Y1\n${code}\nX2 Y2\nG1 X3 Y3\nX4 Y4`, {
        commandDescriptions: [{ code, meaning: 'Package-specific command label', scope: 'exact-source' }]
      });
      expect(result.commands.find(command => command.code === code)).toMatchObject({ count: 1, sourceLines: [3], scope: 'exact-source', coverage: 'controller-specific' });
      expect(result.lines[2].after.positionKnown).toBe(false);
      expect(buildEditorPreviewGeometry(result.parseResult).paths.map(path => path.line)).toEqual([2, 6]);
    }
    expect(parseGCodeProgram('G21\nG1 X1 Y1\nM999\nX2 Y2').path.map(point => point.line)).toEqual([2, 4]);
  });

  it('retains invalid numeric command literals and omits ambiguous geometry without changing ordinary parsing', () => {
    for (const block of ['G1e309 X9 Y9', 'M1e309 X9 Y9', 'G1 X9 X8 Y9', 'G3 X0 Y1 I-1 J0 P2', 'G3 X0 Y1 I-1 J0 R1']) {
      const source = `G21\nG1 X1 Y0\n${block}\nG1 X2 Y2\nG1 X3 Y3`;
      const result = inspectGCodeProgram(source);
      expect(result.lines[2].previewStatus).toBe('omitted');
      expect(result.lines[2].after.positionKnown).toBe(false);
      expect(result.lines[2].diagnostics.length).toBeGreaterThan(0);
      expect(buildEditorPreviewGeometry(result.parseResult).paths.map(path => path.line)).toEqual([2, 5]);
      expect(parseGCodeProgram(source).path.some(point => point.line === 3)).toBe(true);
      if (block.includes('1e309')) expect(result.commands.some(command => command.code === block.split(' ')[0].toUpperCase())).toBe(true);
    }
  });

  it('does not leave an auxiliary plane or coordinate transform connected to the old nominal frame', () => {
    const plane = inspectGCodeProgram('G21\nG0 X1 Y0\nG17.1\nG3 X0 Y1 I-1 J0\nG17\nG0 X0 Y1\nG1 X2 Y1');
    expect(plane.lines[2].after.plane).toBe('unsupported');
    expect(plane.parseResult.stats.arcMoves).toBe(0);
    expect(buildEditorPreviewGeometry(plane.parseResult).paths.map(path => path.line)).toEqual([2, 7]);
    for (const transform of ['G51 P2', 'G68 R90']) {
      const result = inspectGCodeProgram(`G21\nG1 X1 Y1\n${transform}\nX2 Y2\nG1 X3 Y3\nX4 Y4`);
      expect(result.lines[2].after.positionKnown).toBe(false);
      expect(result.commands[2].scope).toContain('Haas');
      expect(buildEditorPreviewGeometry(result.parseResult).paths.map(path => path.line)).toEqual([2, 6]);
      expect(result.preview.status).toBe('limited');
    }
    const compensation = inspectGCodeProgram('G21\nG41.1 D2\nG1 X1 Y1\nG40');
    expect(compensation.lines[1].after.compensation).toBe('left');
    expect(compensation.lines[3].after.compensation).toBe('off');
    expect(compensation.diagnostics.some(issue => issue.message.includes('not applied'))).toBe(true);
  });
});
