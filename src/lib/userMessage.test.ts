import { describe, expect, it } from 'vitest';
import { formatUserNumber, readableMessage, userFacingMessage } from './userMessage';

describe('user-facing messages', () => {
  it('rounds raw floats for reading and bounds roundoff-sized values', () => {
    expect(formatUserNumber(0.30000000000000004)).toBe('0.3');
    expect(formatUserNumber(12.345678)).toBe('12.3457');
    expect(formatUserNumber(2e-13)).toBe('less than 0.0001');
    expect(formatUserNumber(-3e-9)).toBe('more than -0.0001');
    expect(formatUserNumber(123456.789)).toBe('123,456.8');
    expect(formatUserNumber(0)).toBe('0');
  });

  it('rewrites raw numbers and generated ID prefixes but keeps versions, counts, IDs and wording', () => {
    expect(readableMessage('Arc radius 4.999999999999 mm must exceed the section envelope 2e-13 mm.'))
      .toBe('Arc radius 5 mm must exceed the section envelope less than 0.0001 mm.');
    expect(readableMessage('3f2a9c1e-4b5d-4e6f-8a7b-9c0d1e2f3a4b: The line and arc do not form a smooth tangent joint.'))
      .toBe('The line and arc do not form a smooth tangent joint.');
    expect(readableMessage('slot-13: Sketch lines do not satisfy their parallel relation.')).toBe('Sketch lines do not satisfy their parallel relation.');
    for (const kept of ['Release 0.0.724 needs post schema 1.2.3.', 'Curve edge 3 is too short.', 'Line 12: unknown G01 word.', 'Color #1e5e10 and id e1e5.'])
      expect(readableMessage(kept)).toBe(kept);
  });

  it('takes the message of an error or string and falls back when there is none', () => {
    expect(userFacingMessage(new Error('Offset 1.0000000001 mm is too small.'), 'Unable to apply.')).toBe('Offset 1 mm is too small.');
    expect(userFacingMessage('Plain text', 'Unable to apply.')).toBe('Plain text');
    expect(userFacingMessage({ message: 'not an error' }, 'Unable to apply.')).toBe('Unable to apply.');
    expect(userFacingMessage(new Error('  '), 'Unable to apply.')).toBe('Unable to apply.');
  });
});
