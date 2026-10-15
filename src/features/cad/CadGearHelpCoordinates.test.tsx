import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, createCadPluginProfile, inspectCadPluginProfile, resolveCadPluginProfile, type CadPluginPackage, type CadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { CadGearHelp } from './CadGearHelp';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const numbers = (text: string) => text.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
function profileFor(pkg: CadPluginPackage, far = false) {
  const profile = createCadPluginProfile(pkg);
  Object.assign(profile.inputs, { module: 'size', angle: 'phase', x: 'positionX', y: 'positionY' });
  // The pinned V1 default tolerance is too coarse at this accepted small module.
  if (pkg.version === '1.0.0') profile.inputs.tolerance = 0.00025;
  const parameters = { size: 0.05, phase: 17, positionX: far ? 1000000 : 0, positionY: far ? -1000000 : 0 };
  return { profile, parameters };
}
async function render(profile: CadPluginProfile, parameters: Record<string, number>, name: string) {
  const inspection = inspectCadPluginProfile(profile, parameters);
  expect(inspection.issues).toEqual([]);
  await act(async () => root.render(<CadGearHelp {...{ profile, name }} values={inspection.values} label={name} unit="mm" />));
  const svg = container.querySelector('figure svg'); if (!svg) throw new Error('Gear illustration missing');
  const paths = [...svg.querySelectorAll('path')].map(path => path.getAttribute('d') ?? '');
  return { svg, paths, bounds: numbers(svg.getAttribute('viewBox') ?? ''), inspection };
}
function expectSamePaths(actual: readonly string[], expected: readonly string[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((path, index) => {
    expect(path.match(/[MLAZ]/g)).toEqual(expected[index].match(/[MLAZ]/g));
    const coordinates = numbers(path), before = numbers(expected[index]);
    expect(coordinates).toHaveLength(before.length);
    coordinates.forEach((value, position) => expect(value).toBeCloseTo(before[position], 8));
  });
}

it.each([CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN])(
  'renders the same small $version overview in a local frame at either accepted placement', async pkg => {
    const near = profileFor(pkg), far = profileFor(pkg, true);
    const source = JSON.stringify(far.profile), parameterSource = JSON.stringify(far.parameters);
    const baseline = await render(near.profile, near.parameters, 'module');
    const diagram = await render(far.profile, far.parameters, 'module');
    expect(diagram.bounds).toEqual([-0.55, -0.55, 1.1, 1.1]);
    const circle = diagram.svg.querySelector('circle'); if (!circle) throw new Error('Pitch circle missing');
    expect(numbers(`${circle.getAttribute('cx')} ${circle.getAttribute('cy')} ${circle.getAttribute('r')}`)).toEqual([0, 0, 0.45]);
    expect(2 * Number(circle.getAttribute('r')) / diagram.bounds[3]).toBeCloseTo(0.9 / 1.1, 14);
    for (const value of diagram.paths.flatMap(numbers)) expect(Math.abs(value)).toBeLessThanOrEqual(1);
    expectSamePaths(diagram.paths, baseline.paths);
    const resolved = resolveCadPluginProfile(far.profile, far.parameters);
    if (resolved.kind !== 'path' || resolved.segments[0].kind !== 'line') throw new Error('Exact first flank/root segment missing');
    const expectedStart = [resolved.segments[0].start[0] - far.parameters.positionX, resolved.segments[0].start[1] - far.parameters.positionY];
    numbers(diagram.paths[0]).slice(0, 2).forEach((value, index) => expect(value).toBeCloseTo(expectedStart[index], 8));
    expect(JSON.stringify(far.profile)).toBe(source); expect(JSON.stringify(far.parameters)).toBe(parameterSource);
  }
);

it.each([CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN])(
  'keeps the $version highlighted root transition and framing identical after pure placement', async pkg => {
    const near = profileFor(pkg), far = profileFor(pkg, true), source = JSON.stringify(far.profile);
    const baseline = await render(near.profile, near.parameters, 'cutterTipRadius');
    const diagram = await render(far.profile, far.parameters, 'cutterTipRadius');
    expect(diagram.bounds).toHaveLength(4);
    diagram.bounds.forEach((value, index) => { expect(Math.abs(value)).toBeLessThan(1); expect(value).toBeCloseTo(baseline.bounds[index], 8); });
    expect(diagram.bounds[2]).toBeGreaterThan(0); expect(diagram.bounds[3]).toBeGreaterThan(0);
    expectSamePaths(diagram.paths, baseline.paths);
    const highlighted = diagram.svg.querySelector('path[stroke="#f1bf72"]'); if (!highlighted) throw new Error('Root transition highlight missing');
    const points = numbers(highlighted.getAttribute('d') ?? '');
    expect(Math.max(...points.filter((_, index) => index % 2 === 0)) - Math.min(...points.filter((_, index) => index % 2 === 0))).toBeGreaterThan(0.02);
    expect(Math.max(...points.filter((_, index) => index % 2 === 1)) - Math.min(...points.filter((_, index) => index % 2 === 1))).toBeGreaterThan(0.02);
    expect(JSON.stringify(far.profile)).toBe(source);
  }
);

it('retains the authored rotation and updates linked geometry without rewriting the profile', async () => {
  const { profile, parameters } = profileFor(CAD_GEAR_V3_PLUGIN, true), source = JSON.stringify(profile);
  const initial = await render(profile, parameters, 'module');
  const rotated = await render(profile, { ...parameters, phase: 0 }, 'module');
  expect(rotated.paths).not.toEqual(initial.paths);
  const enlarged = await render(profile, { ...parameters, size: 0.1 }, 'module');
  expect(enlarged.bounds).toEqual([-1.1, -1.1, 2.2, 2.2]);
  expect(enlarged.svg.querySelector('circle')?.getAttribute('r')).toBe('0.9');
  expect(JSON.stringify(profile)).toBe(source);
});
