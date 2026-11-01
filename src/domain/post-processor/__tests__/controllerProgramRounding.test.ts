import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import type { DxfEntity, DxfPoint } from '@/domain/dxf/types';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';

import { runPost } from '../postEngine';
import { createEmptyPostLibrary, installPostPackage, type PostInstallation } from '../postLibrary';
import { parseWireEdmPostPackage } from '../postPackage';

const ROBOFIL_POST = 'tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';
type Installation = PostInstallation;
const MILLIMETERS = { source: 'dxf-insunits', code: 4, label: 'millimeters', scaleToMillimeters: 1 } as const;

/**
 * Correctly rounded output must pass the post audit at every magnitude. Each sampled coordinate lies
 * exactly half-way between two emitted values, written as the decimal a DXF would carry, so the
 * double nearest to it rounds either way and leaves the largest possible rounding error.
 */
describe('post audit of correctly rounded controller output', () => {
  it('accepts the 8.0015 half-way width and its 8.0014 control through the installed Robofil post', async () => {
    const installation = await installRobofil();
    expect(xWords(await postLines(installation, rectangle(0, 8.0015, 0, 5), 3))).toContain('X8.002');
    expect(xWords(await postLines(installation, rectangle(0, 8.0014, 0, 5), 3))).toContain('X8.001');
  });

  it.each([3, 4])('accepts half-way coordinates from 0.001 to 1000 mm at %i decimals', async (digits) => {
    const installation = digits === 3 ? await installRobofil() : robofilWithPrecision(digits);
    const failures: string[] = [];
    for (const [index, sample] of halfWaySamples(digits, 200).entries()) {
      const signX = index % 2 === 0 ? 1 : -1;
      const signY = index % 4 < 2 ? 1 : -1;
      for (const [shape, entities] of [
        ['bumped rectangle', bumpedRectangle(sample, signX, signY, digits)],
        ['full circle', fullCircle(sample, signX, signY, digits)]
      ] as const) {
        const result = await post(installation, entities, digits);
        if (!result.ok) failures.push(`${shape} at ${sample.text}: ${result.messages.join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('accepts a nearly axis-aligned move whose short side rounds across a quantum', async () => {
    // Both ends round by just under half a quantum on each axis: X lengthens the move by 0.001 mm
    // and Y tilts it by 0.001 mm, adding a second-order length a first-order bound misses.
    const below = 0.0005 - 1e-9;
    const above = 0.0005 + 1e-9;
    const lines = await postLines(await installRobofil(), [
      line({ x: below, y: below }, { x: 10 + above, y: above }),
      line({ x: 10 + above, y: above }, { x: 10 + above, y: 5 }),
      line({ x: 10 + above, y: 5 }, { x: below, y: 5 }),
      line({ x: below, y: 5 }, { x: below, y: below })
    ], 3);
    expect(lines).toEqual(expect.arrayContaining(['G1 X10.001 Y0.001']));
  });
});

describe('post audit of output that is wrong beyond rounding', () => {
  // One quantum and a half from a half-way value is one emitted unit beyond correct rounding.
  const extraUnit = 0.0015;
  const linear = "api.emitMotion('motion.linear', { x: event.end.x, y: event.end.y })";
  const direction = "event.clockwise ? 'motion.arc-clockwise' : 'motion.arc-counterclockwise'";

  it.each([
    { name: 'a linear X one unit beyond rounding, upwards', from: linear,
      to: `api.emitMotion('motion.linear', { x: event.end.x + ${extraUnit}, y: event.end.y })` },
    { name: 'a linear X one unit beyond rounding, downwards', from: linear,
      to: `api.emitMotion('motion.linear', { x: event.end.x - ${extraUnit}, y: event.end.y })` },
    { name: 'a linear Y one unit beyond rounding', from: linear,
      to: `api.emitMotion('motion.linear', { x: event.end.x, y: event.end.y + ${extraUnit} })` },
    { name: 'swapped linear axes', from: linear,
      to: "api.emitMotion('motion.linear', { x: event.end.y, y: event.end.x })" },
    { name: 'a linear X with the wrong sign', from: linear,
      to: "api.emitMotion('motion.linear', { x: -event.end.x, y: event.end.y })" },
    { name: 'a linear move left in place', from: linear,
      to: "api.emitMotion('motion.linear', event.ordinal % 3 === 2" +
        ' ? { x: event.start.x, y: event.start.y } : { x: event.end.x, y: event.end.y })' },
    // The runtime refuses a consumed motion event before the audit runs.
    { name: 'a dropped linear move', from: "if (event.motion === 'linear') {",
      to: "if (event.motion === 'linear') { if (event.ordinal % 3 === 2) return api.consume('Dropped.');",
      code: 'POST_CUSTOM_EVENT_DISPOSITION_INVALID' },
    { name: 'an arc centre one unit beyond rounding', from: 'i: event.center.x,',
      to: `i: event.center.x + ${extraUnit},` },
    { name: 'the wrong arc direction', from: direction,
      to: "event.clockwise ? 'motion.arc-counterclockwise' : 'motion.arc-clockwise'" }
  ])('rejects $name at half-way coordinates', async ({ from, to, code = 'POST_CUSTOM_AUDIT_FAILED' }) => {
    const installation = robofilWithSource(from, to);
    const sample = halfWayValue(80015, 3);
    for (const [signX, signY] of [[1, 1], [-1, -1]] as const) {
      const result = await post(installation, bumpedRectangle(sample, signX, signY, 3), 3);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.codes).toContain(code);
    }
  });

  it.each([
    { name: 'the wrong full-circle direction', from: direction,
      to: "event.clockwise ? 'motion.arc-counterclockwise' : 'motion.arc-clockwise'" },
    { name: 'a dropped second half of a full circle', from: '        j: event.center.y\n      });\n    }',
      to: '        j: event.center.y\n      });\n      return;\n    }' },
    { name: 'a full-circle centre one unit beyond rounding', from: 'i: event.center.x,',
      to: `i: event.center.x + ${extraUnit},` }
  ])('rejects $name at half-way coordinates', async ({ from, to }) => {
    const result = await post(robofilWithSource(from, to), fullCircle(halfWayValue(80015, 3), 1, -1, 3), 3);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.codes).toContain('POST_CUSTOM_AUDIT_FAILED');
  });

  it('refuses to install a post that emits one unit beyond rounding', async () => {
    const parsed = parseWireEdmPostPackage(JSON.stringify(robofilJson(linear,
      `api.emitMotion('motion.linear', { x: event.end.x + ${extraUnit}, y: event.end.y })`)));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    expect(await installPostPackage(createEmptyPostLibrary(), parsed.package)).toMatchObject({
      ok: false, error: { code: 'POST_LIBRARY_CONFORMANCE_FAILED' }
    });
  });
});

interface HalfWayValue {
  /** The coordinate in units of a tenth of the emitted quantum; always an odd multiple of five. */
  readonly tenths: number;
  readonly text: string;
}

/** Deterministic log-uniform half-way values over [0.001, 1000) mm, one per equal-ratio stratum. */
function halfWaySamples(digits: number, count: number): HalfWayValue[] {
  let seed = 0x2545f491 + digits;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  return Array.from({ length: count }, (_, index) => {
    const magnitude = 0.001 * 10 ** (6 * (index + random()) / count);
    const quanta = Math.max(Math.ceil(0.001 * 10 ** digits - 0.5), Math.floor(magnitude * 10 ** digits));
    return halfWayValue(10 * quanta + 5, digits);
  }).filter(({ tenths }) => tenths < 1000 * 10 ** (digits + 1));
}

function halfWayValue(tenths: number, digits: number): HalfWayValue {
  return { tenths, text: decimal(tenths, digits + 1) };
}

/** Exact decimal text of `units * 10^-scale`, parsed the way a DXF coordinate is. */
function decimal(units: number, scale: number) {
  const digits = String(Math.abs(units)).padStart(scale + 1, '0');
  return `${units < 0 ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * A 3 x 2 mm rectangle with a semicircular bump on one long side and a notch in the other. Every
 * vertex and arc centre is half-way: one corner is at the sample, mirrored by the signs.
 */
function bumpedRectangle(sample: HalfWayValue, signX: 1 | -1, signY: 1 | -1, digits: number): DxfEntity[] {
  const mm = 10 ** (digits + 1);
  const x0 = signX > 0 ? sample.tenths - 3 * mm : -sample.tenths;
  const y0 = signY > 0 ? sample.tenths - 2 * mm : -sample.tenths;
  const x = (offset: number) => Number(decimal(x0 + offset * mm, digits + 1));
  const y = (offset: number) => Number(decimal(y0 + offset * mm, digits + 1));
  const point = (px: number, py: number): DxfPoint => ({ x: x(px), y: y(py) });
  return [
    line(point(0, 0), point(1.6, 0)),
    // A notch into the part: its counterclockwise arc runs from the right end over the top.
    arc(point(2, 0), 0.4, point(2.4, 0), point(1.6, 0), 0),
    line(point(2.4, 0), point(3, 0)),
    line(point(3, 0), point(3, 2)),
    line(point(3, 2), point(1.5, 2)),
    arc(point(1, 2), 0.5, point(1.5, 2), point(0.5, 2), 0),
    line(point(0.5, 2), point(0, 2)),
    line(point(0, 2), point(0, 0))
  ];
}

function fullCircle(sample: HalfWayValue, signX: 1 | -1, signY: 1 | -1, digits: number): DxfEntity[] {
  const center = (sign: number) => Number(decimal(sign * sample.tenths, digits + 1));
  return [{ type: 'circle', layer: 'CUT', center: { x: center(signX), y: center(signY) }, radius: 0.75 }];
}

function rectangle(x0: number, x1: number, y0: number, y1: number): DxfEntity[] {
  return [
    line({ x: x0, y: y0 }, { x: x1, y: y0 }),
    line({ x: x1, y: y0 }, { x: x1, y: y1 }),
    line({ x: x1, y: y1 }, { x: x0, y: y1 }),
    line({ x: x0, y: y1 }, { x: x0, y: y0 })
  ];
}

function line(start: DxfPoint, end: DxfPoint): DxfEntity {
  return { type: 'line', layer: 'CUT', start, end };
}

/** A counterclockwise half circle with explicit, exactly shared endpoints. */
function arc(center: DxfPoint, radius: number, start: DxfPoint, end: DxfPoint, startAngle: number): DxfEntity {
  return {
    type: 'arc', layer: 'CUT', center, radius, start, end,
    startAngle, endAngle: startAngle + 180, sweepRadians: Math.PI, clockwise: false
  };
}

async function post(installation: Installation, entities: DxfEntity[], digits: number) {
  // The DXF import's own conversion: its plan keeps a zero endpoint tolerance, so only rounding is allowed.
  const source = dxfEntitiesToUpidDocument(entities, {}, { units: MILLIMETERS });
  source.geometryBasis = 'finished-contour';
  const operation = source.plan.operations[0];
  const document = setManualCompensationIntent(source, operation.id, 'outside');
  if (!document) throw new Error('Expected one closed contour.');
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { ...operation.startPoint }, review: 'reviewed' }
  };
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const result = await runPost(compiled.plan, {
    installation, properties: { coordinatePrecision: digits, offsetIndex: 0 }
  });
  return result.ok
    ? { ok: true as const, lines: result.program.lines }
    : {
        ok: false as const,
        codes: result.diagnostics.map(({ code }) => code),
        messages: result.diagnostics.map(({ code, message }) => `${code} ${message}`)
      };
}

async function postLines(installation: Installation, entities: DxfEntity[], digits: number) {
  const result = await post(installation, entities, digits);
  if (!result.ok) throw new Error(result.messages.join('\n'));
  return result.lines;
}

function xWords(lines: readonly string[]) {
  return lines.flatMap((text) => text.split(' ').filter((word) => word.startsWith('X')));
}

function robofilJson(from?: string, to?: string) {
  const json = JSON.parse(readFileSync(resolve(process.cwd(), ROBOFIL_POST), 'utf8'));
  if (from !== undefined && to !== undefined) {
    const code: string = json.source.code;
    if (!code.includes(from)) throw new Error(`Post source no longer contains ${from}.`);
    json.source.code = code.replaceAll(from, to);
  }
  return json;
}

async function installRobofil() {
  const parsed = parseWireEdmPostPackage(JSON.stringify(robofilJson()));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const installed = await installPostPackage(createEmptyPostLibrary(), parsed.package);
  if (!installed.ok) throw new Error(installed.error.message);
  return installed.installation;
}

/**
 * Runs a package without installing it. Installation conformance would refuse these changes: the
 * mutated posts on purpose, and a widened precision because the shipped fixtures do not cover it.
 */
function uninstalled(json: unknown): Installation {
  const parsed = parseWireEdmPostPackage(JSON.stringify(json));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return {
    ref: { packageId: parsed.package.manifest.id, version: parsed.package.manifest.version, contentHash: 'uninstalled' },
    package: parsed.package
  } as Installation;
}

function robofilWithPrecision(digits: number) {
  const json = robofilJson();
  json.manifest.properties.coordinatePrecision.maximum = digits;
  return uninstalled(json);
}

function robofilWithSource(from: string, to: string) {
  return uninstalled(robofilJson(from, to));
}
