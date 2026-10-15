import { readFileSync, writeFileSync } from 'node:fs';
import { iconSource } from './icon-source.mjs';
import { cadV3Coverage } from './icon-revisions/cad-v3.mjs';

const general = JSON.parse(readFileSync('docs/design/icon-review/iteration-3-general/coverage.json', 'utf8')).entries;
const cam = [...readFileSync('docs/design/iteration-3-cam.md', 'utf8').matchAll(/^\| `([^`]+)` \| ([^\n]+)\|$/gm)]
  .map(([, id, reason]) => ({ id, reason: reason.trim() }));
const owners = new Map();
function review(id, group, reason) {
  const existing = owners.get(id) || [];
  owners.set(id, [...existing, { group, reason }]);
}
for (const entry of general) review(entry.id, 'General controls and documents', entry.decision);
for (const [id, , reason] of cadV3Coverage) review(id, 'CAD, geometry and view', reason);
for (const entry of cam) review(entry.id, 'CAM and machine simulation', entry.reason);
for (const id of ['play', 'pause', 'step-back', 'step-forward']) {
  review(id, 'Simulation transport', 'Closed playback triangles and paired pause bars. Previous/next steps mirror the same triangle and stop bar. Retained after review at toolbar size.');
}
review('insert-points', 'Control semantics', 'Measured point markers enter program rows. Replaces an unrelated contour-departure arrow beside Insert Points.');
review('locate', 'Control semantics', 'Crosshair locates a highlighted guide control. Reuses the target geometry with a label separate from the coordinate origin.');

const geometryDecisions = {
  'lead-in': 'Closed shared contour with an interior radial entry arrow.',
  'lead-out': 'Same closed contour and reversed interior radial arrow.',
  offset: 'Closed nested contours. All eight matching sides have a verified three-unit perpendicular inset.',
  toolpath: 'Closed contour with tangential travel, with verified clearance from the contour.',
  wire: 'Upper and lower closed wire guides joined by a suspended electrode. Rejected the shared viewport frame because it read as a window.',
  'cam-editor': 'Closed contour and pencil; no nested offset or lead direction cue.',
  'start-point': 'Program start flag. Lead tree rows now use the matching lead-in or lead-out icon.',
  'insert-points': 'Measured point markers and program rows; dedicated insertion cue.',
  locate: 'Explicit locating action rather than a coordinate datum.',
  'wire-edm-mark': 'Two closed stock/offcut contours separated by a straight wire. Shared by the app heading and favicon.',
  'file-import': 'Shared page outline with an intentionally occluded modifier field; import/export arrows mirror each other.',
  'file-export': 'Shared page outline with an intentionally occluded modifier field; import/export arrows mirror each other.',
  'datum-plane': 'Closed planar rhombus follows the exact body projection.',
  'select-face': 'Closed isolated planar face and shared pointer; distinct from body and edge selection.',
  'select-edge': 'Intentionally open isolated edge with endpoint markers and shared pointer.',
  'select-body': 'Exact body projection and shared pointer.',
  'imported-body': 'Closed body silhouette with an incoming arrow.',
  revolve: 'Closed stepped turned result, axis and circular motion cue.',
  loft: 'Two closed oblique sections and corresponding nonduplicated generators.',
  sweep: 'Closed curved result with an end section; no crowded internal trajectory.',
  'pad-pocket': 'Closed stepped profile with additive and subtractive cues.',
  'navigation-trackpad': 'Two fingers operating a touch surface. Replaces a laptop silhouette and stays distinct from mouse navigation and the full-hand pan icon.',
};
const entries = iconSource.map(entry => {
  const reviews = owners.get(entry.id) || [];
  if (!reviews.length) throw new Error(`No explicit review group owns ${entry.id}`);
  return { id: entry.id, label: entry.label, category: entry.category, reviews,
    integratedDecision: geometryDecisions[entry.id] || 'Retained or locally refined under the owning group review. See linked iteration comparisons and general decision record.' };
});
const output = { phase: 'Integrated critical iteration, awaiting final cross-family review', reviewedCount: entries.length,
  evidence: ['iteration-3-general.md', 'iteration-3-cam.md', 'iteration-4-cad.md', 'general-icon-decisions.md'], entries };
writeFileSync('docs/design/icon-review-coverage.json', JSON.stringify(output, null, 2) + '\n');
writeFileSync('docs/design/icon-review-coverage.md', `# Icon review coverage\n\nAll ${entries.length} catalog IDs have an explicit review owner. This ledger records review coverage, not a claim of perfect standalone recognition. The integration is still undergoing cross-family review.\n\n| ID | Review groups | Integrated decision |\n| --- | --- | --- |\n${entries.map(entry => `| \`${entry.id}\` | ${entry.reviews.map(review => review.group).join('; ')} | ${entry.integratedDecision} |`).join('\n')}\n`);
console.log(`Verified explicit review coverage for all ${entries.length} catalog IDs.`);
