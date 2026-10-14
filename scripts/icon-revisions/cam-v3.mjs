// CAM-specific alternatives, authored for comparison only. No production
// catalog or generated SVG is changed by this proposal module.
const outer = 'M7 3h10l4 4v10l-4 4H7l-4-4V7Z';
const inset = 'M8.243 6h7.514L18 8.243v7.514L15.757 18H8.243L6 15.757V8.243Z';
const machineFrame = 'M3 4h18v16H3Z';
const paths = (...values) => values;

export const camV3Revisions = [
  {
    id: 'cam-editor',
    paths: paths(outer, 'M13 6l4 4-6 6-4 1 1-4Z'),
    reason: 'Keep one closed profile and add an unmistakable pencil modifier. This means edit the CAM contour, without adding a parallel offset or toolpath arrow.'
  },
  {
    id: 'offset',
    paths: paths(outer, inset),
    reason: 'Use two closed, four-corner-chamfered contours with matching parallel edges. The inner loop is the exact 3-unit offset of the outer loop, including parallel 45° chamfers. Four matching corners keep the profile from reading as a document.'
  },
  {
    id: 'lead-in',
    paths: paths(outer, 'M6 12h12M15 9l3 3-3 3'),
    reason: 'Use a closed contour with an interior arrow pointing toward its right edge, retaining a 3-unit gap. This reads as the explicit center-pierce direction supported by the Entry panel.'
  },
  {
    id: 'lead-out',
    paths: paths(outer, 'M18 12H6M9 9l-3 3 3 3'),
    reason: 'Reverse the lead-in shaft and arrowhead over the exact same closed base contour; the arrow travels from near the edge back into the interior with matching clearance.'
  },
  {
    id: 'toolpath',
    paths: paths(outer, 'M15 8v6M12 11l3 3 3-3'),
    reason: 'Keep the same closed contour but place the arrow parallel to its right edge. The down direction reads as a tangential cutting move, remains distinct from the radial lead pair, and leaves at least 3 units between the arrowhead and contour.'
  },
  {
    id: 'wire',
    paths: paths('M6 3h12v4H6Z', 'M6 17h12v4H6Z', 'M12 7v10'),
    reason: 'Use two visible guide blocks joined by the vertical wire. The literal suspended electrode reads more clearly than repeating the simulation/setup viewport frame, while retaining the centered wire and 10-unit guide span.'
  },
  {
    id: 'simulation',
    paths: paths(machineFrame, 'M6 11h12v6H6Z', 'M12 8v10', 'M8 14h4'),
    reason: 'Use the common 18-by-16 modal frame as a viewport, with stock, traversing wire and cut location inside. Do not use playback triangles here; simulation transport controls already have dedicated icons.'
  },
  {
    id: 'machine-setup',
    paths: paths(machineFrame, 'M7 16h10M8 15V8M8 15h8', 'M6 10l2-2 2 2M14 13l2 2-2 2'),
    reason: 'Reuse the viewport frame dimensions but give the interior XY adjustment axes. The outer frame unifies the two machine panels; coordinate detail identifies setup rather than a running process.'
  },
  {
    id: 'section-view',
    paths: paths('M4 7l8-4 8 4v10l-8 4-8-4Z', 'M4 7l8 4 8-4M12 11v10', 'M6 9l4 2M6 12l4 2'),
    reason: 'Use a wireframe model with a visible section plane and short cut-face hatch marks. This is an inspected cutaway, not a CAM handoff and not a scan/bounds rectangle.'
  },
  {
    id: 'send-cam',
    paths: paths('M3 7l4-3h7l5 5-4 10H5l-2-5Z', 'M7 9h5v5H7Z', 'M17 12h5M19 9l3 3-3 3'),
    reason: 'Transfer a planar closed sketch profile with a hole. This source shape is intentionally unlike the oblique solid used for section-to-CAM.'
  },
  {
    id: 'section-cam',
    paths: paths('M3 7l6-3 6 3v9l-6 3-6-3Z', 'M3 7l6 3 6-3M9 10v9', 'M3 12h12', 'M17 12h5M19 9l3 3-3 3'),
    reason: 'Keep a shallow CAD solid, expose its section plane, then send that result to CAM. The arrow differentiates this handoff from section-view inspection.'
  }
];

export default camV3Revisions;
