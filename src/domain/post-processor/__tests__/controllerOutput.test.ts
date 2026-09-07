import { describe, expect, it } from 'vitest';

import type { ControllerProgram } from '../controllerProgram';
import { serializeControllerOutput } from '../controllerOutput';
import { minimalPostPackage } from './postPackageFixture';

const program: ControllerProgram = {
  text: 'G92 X0 Y0\nM02',
  lines: ['G92 X0 Y0', 'M02'],
  blocks: [],
  eventDispositions: []
};

describe('controller output serialization', () => {
  it('applies every post-owned file rule to the exact artifact bytes', () => {
    const output = minimalPostPackage().manifest.output;
    Object.assign(output, {
      lineEnding: 'crlf',
      finalNewline: true,
      blockNumbering: {
        mode: 'sequential',
        prefix: 'N',
        start: 10,
        increment: 10,
        minimumWidth: 4
      },
      programEnvelope: { prefix: ['%'], suffix: ['%'] }
    });

    const serialized = serializeControllerOutput(program, output);

    expect(serialized).toMatchObject({ ok: true });
    if (!serialized.ok) throw new Error(serialized.error.message);
    expect(serialized.text).toBe('%\r\nN0010 G92 X0 Y0\r\nN0020 M02\r\n%\r\n');
    expect([...serialized.bytes]).toEqual([
      ...new TextEncoder().encode(serialized.text)
    ]);
  });

  it('rejects non-ASCII controller text under an ASCII contract', () => {
    const output = minimalPostPackage().manifest.output;
    output.programEnvelope.prefix.push('(préface)');

    expect(serializeControllerOutput(program, output)).toMatchObject({
      ok: false,
      error: { code: 'POST_OUTPUT_ENCODING_INVALID' }
    });
  });

  it('encodes UTF-8 wrappers without adding a final newline when the post disables it', () => {
    const output = minimalPostPackage().manifest.output;
    output.encoding = 'utf-8';
    output.lineEnding = 'lf';
    output.finalNewline = false;
    output.programEnvelope.prefix = ['(µ)'];

    const serialized = serializeControllerOutput({ ...program, text: 'M02', lines: ['M02'] }, output);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error(serialized.error.message);
    expect(serialized.text).toBe('(µ)\nM02');
    expect([...serialized.bytes]).toEqual([40, 194, 181, 41, 10, 77, 48, 50]);
  });

  it('rejects sequence numbers beyond the supported controller range', () => {
    const output = minimalPostPackage().manifest.output;
    output.blockNumbering = {
      mode: 'sequential',
      prefix: 'N',
      start: 99_999_999,
      increment: 1,
      minimumWidth: 1
    };

    expect(serializeControllerOutput(program, output)).toMatchObject({
      ok: false,
      error: { code: 'POST_OUTPUT_NUMBERING_OVERFLOW' }
    });
  });
});
