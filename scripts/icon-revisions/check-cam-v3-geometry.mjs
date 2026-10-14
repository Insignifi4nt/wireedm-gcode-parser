import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const { iconSource } = await import(pathToFileURL(resolve('scripts/icon-source.mjs')));
const { default: revisions } = await import(pathToFileURL(resolve('scripts/icon-revisions/cam-v3.mjs')));
const expectedIds = ['cam-editor', 'offset', 'lead-in', 'lead-out', 'toolpath', 'wire', 'simulation', 'machine-setup', 'section-view', 'send-cam', 'section-cam'];
assert.deepEqual(revisions.map(({ id }) => id), expectedIds, 'Only the 11 owned CAM v3 IDs are under review');
const sourceById = new Map(iconSource.map(({ id, paths }) => [id, paths]));
for (const { id, paths } of revisions) assert.deepEqual(sourceById.get(id), paths, `${id} source paths match the reviewed v3 geometry`);
assert.equal(sourceById.get('section-view')[0], sourceById.get('body').join(''), 'Section view uses the exact closed body primitive');

// Read the actual paths. Separate coordinate fixtures can pass after the SVG
// has regressed, so all contour and clearance checks use production geometry.
function linearSubpaths(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g) || [];
  const subpaths = [];
  let current;
  let point = [0, 0];
  let command;
  let index = 0;
  function number() {
    const value = Number(tokens[index++]);
    assert(Number.isFinite(value), `Expected a coordinate in ${d}`);
    return value;
  }
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    assert(command && /^[mlhvz]$/i.test(command), `Unsupported contour command ${command}`);
    const relative = command === command.toLowerCase();
    const kind = command.toUpperCase();
    if (kind === 'Z') {
      assert(current, 'Closing a missing contour');
      current.closed = true;
      point = current.points[0];
      command = undefined;
      continue;
    }
    if (kind === 'H') point = [number() + (relative ? point[0] : 0), point[1]];
    else if (kind === 'V') point = [point[0], number() + (relative ? point[1] : 0)];
    else point = [number() + (relative ? point[0] : 0), number() + (relative ? point[1] : 0)];
    if (kind === 'M') {
      current = { points: [], closed: false };
      subpaths.push(current);
      command = relative ? 'l' : 'L';
    }
    assert(current, 'A contour must begin with moveto');
    current.points.push(point);
  }
  return subpaths;
}
const [outerPath] = linearSubpaths(sourceById.get('offset')[0]);
const [insetPath] = linearSubpaths(sourceById.get('offset')[1]);
assert(outerPath.closed && insetPath.closed, 'Both offset contours must close explicitly');
const outer = outerPath.points;
const inset = insetPath.points;
assert.equal(outer.length, 8, 'Chamfered contour has eight sides');
assert.equal(inset.length, outer.length, 'Inset has a corresponding edge for every contour edge');
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const length = (v) => Math.hypot(v[0], v[1]);
for (let i = 0; i < outer.length; i += 1) {
  const a = outer[i];
  const b = outer[(i + 1) % outer.length];
  const c = inset[i];
  const d = inset[(i + 1) % inset.length];
  const edge = subtract(b, a);
  const insetEdge = subtract(d, c);
  assert(Math.abs(cross(edge, insetEdge)) < 0.01, `Inset edge ${i} remains parallel to its contour edge`);
  for (const point of [c, d]) {
    const distance = Math.abs(cross(edge, subtract(point, a))) / length(edge);
    assert(cross(edge, subtract(point, a)) > 0, `Inset edge ${i} stays inside the contour`);
    assert(Math.abs(distance - 3) < 0.002, `Inset edge ${i} is 3 units from its matching contour edge (got ${distance})`);
  }
}

function pointToSegmentDistance(point, a, b) {
  const ab = subtract(b, a);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return length(subtract(point, [a[0] + t * ab[0], a[1] + t * ab[1]]));
}
function clearance(point) {
  assert(outer.every((a, i) => cross(subtract(outer[(i + 1) % outer.length], a), subtract(point, a)) >= 0), 'Arrow stays inside the contour');
  return Math.min(...outer.map((a, i) => pointToSegmentDistance(point, a, outer[(i + 1) % outer.length])));
}
function assertPolylineClear(points, label) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a, b] = [points[i], points[i + 1]];
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20;
      const sample = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      assert(clearance(sample) >= 3 - 1e-8, `${label} keeps at least 3 units of clearance (got ${clearance(sample)})`);
    }
  }
}
for (const id of ['lead-in', 'lead-out', 'toolpath']) {
  assert.deepEqual(sourceById.get(id)[0], sourceById.get('offset')[0], `${id} uses the same closed contour`);
  for (const subpath of linearSubpaths(sourceById.get(id)[1])) assertPolylineClear(subpath.points, id);
}
const leadIn = linearSubpaths(sourceById.get('lead-in')[1]);
const leadOut = linearSubpaths(sourceById.get('lead-out')[1]);
assert.deepEqual(leadOut.map(path => path.points), leadIn.map(path => path.points.map(([x, y]) => [24 - x, y])), 'Entry and exit arrows mirror exactly about the contour center');

if (!process.argv.includes('--check')) {
const size = 14;
const cell = 52;
const width = revisions.length * cell;
const height = 68;
let markup = '<rect width="100%" height="100%" fill="#111820" />';
revisions.forEach(({ id, paths }, index) => {
  const x = index * cell;
  markup += `<text x="${x + cell / 2}" y="12" text-anchor="middle" fill="#aab6c3" font-size="7" font-family="Arial">${id}</text>`;
  markup += `<g transform="translate(${x + (cell - size) / 2} 25) scale(${size / 24})" fill="none" stroke="#d8dfe7" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}" />`).join('')}</g>`;
});
const png = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markup}</svg>`).render().asPng();
const reviewDir = resolve('docs/design/icon-review/iteration-3-cam');
await mkdir(reviewDir, { recursive: true });
await writeFile(resolve(reviewDir, 'v3-catalog-14px.png'), png);
assert.equal(new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="${sourceById.get('toolpath')[1]}" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`).render().width, size, 'Toolpath preview renders at 14px');
}
console.log('Passed actual-path closure, exact 3-unit inset, inside/clearance checks, mirrored leads and 11-ID reviewed geometry parity.');
