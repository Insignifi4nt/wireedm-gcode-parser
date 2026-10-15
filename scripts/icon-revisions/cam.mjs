// Critical iteration proposals for the original Wire EDM CAM/simulation set.
// Paths are authored on the catalog's 24-unit grid and are intentionally not
// wired into the production source. The parent integration owns selection.
const contour = 'M5 4h9l6 5v7l-6 4H6l-3-5V8Z';
const insetContour = 'M7 7h6l4 3v5l-3 2h-6l-2-3v-4Z';
const machineFrame = 'M3 4h18v16H3Z';
const paths = (...values) => values;

export const camRevisions = [
  {
    id: 'cam-editor',
    paths: paths(
      contour,
      insetContour,
      'M10 10h8M15 7l3 3-3 3'
    ),
    reason: 'Replace the abstract triangle-and-spoke picture with the same closed part contour and inner offset used by the CAM contour family, plus a travel arrow. This identifies 2D toolpath planning without borrowing the solid-body or planning-geometry silhouette.'
  },
  {
    id: 'offset',
    paths: paths(contour, insetContour),
    reason: 'Retain the nested-contour metaphor but replace generic boxes with the same irregular, closed part contour used by lead-in/out and toolpath. The interior loop is a visibly separated inward offset.'
  },
  {
    id: 'lead-in',
    paths: paths(contour, 'M7 12h10M14 9l3 3-3 3'),
    reason: 'Use a closed, irregular contour shared exactly with lead-out. The arrow runs from inside toward the boundary and stops with a visible 3-unit gap, matching the supported center-pierce entry without merging its arrowhead into the contour. It favors this distinctive entry strategy; arbitrary straight leads can be placed on either side, so the button label remains authoritative.'
  },
  {
    id: 'lead-out',
    paths: paths(contour, 'M17 12H7M10 9l-3 3 3 3'),
    reason: 'Reverse the lead-in motion on the identical closed contour: begin just inside the boundary and travel into the interior, preserving the same visible 3-unit clearance. Keeping the base path byte-identical makes the pair read as direction changes, not different operations.'
  },
  {
    id: 'departure',
    paths: paths(contour, 'M20 12h3M20 9l3 3-3 3'),
    reason: 'Show a distinct outward move that starts at the closed contour boundary. The legacy free-standing vertical bar does not identify what the arrow leaves.'
  },
  {
    id: 'wire',
    paths: paths(machineFrame, 'M6 7h12M6 17h12M12 7v10'),
    reason: 'Use the shared machine modal frame, with upper/lower wire guides joined by the vertical electrode inside it. The current internal rectangle suggests a workpiece more than the wire itself.'
  },
  {
    id: 'simulation',
    paths: paths(machineFrame, 'M6 8h12v8H6Z', 'M12 7v10', 'M8 12h4'),
    reason: 'Use the shared machine modal frame around stock, a traversing wire and its cut position. This replaces another generic machine-front panel; play and pause remain separate temporal controls.'
  },
  {
    id: 'machine-setup',
    paths: paths(machineFrame, 'M7 16h10M8 15V8M8 15h8', 'M6 10l2-2 2 2M14 13l2 2-2 2'),
    reason: 'Use the same machine frame as wire and simulation, with an interior XY adjustment axis. This better matches aligning the imported machine model and keeps the three simulation controls recognizably related.'
  },
  {
    id: 'section-view',
    paths: paths('M2 3h20v18H2Z', 'M7 8l4-2 6 2v7l-6 3-4-3Z', 'M7 8l4 3 6-3M11 11v7', 'M8 10l2 1M8 12l2 1'),
    reason: 'Distinguish a section/cutaway inspection from scan bounds by showing a sectioned solid inside a viewport, with a cut face and light hatch marks. The current corner brackets plus cross-lines duplicate scan/bounds at toolbar sizes.'
  },
  {
    id: 'send-cam',
    paths: paths('M3 8l4-4h6l5 5-4 9H5l-2-5Z', 'M7 9h5v5H7Z', 'M14 12h7M18 9l3 3-3 3'),
    reason: 'Replace file-page lines with a flat closed source sketch/profile and an interior opening, transferred to another workspace. Keep a single clear transfer arrow; the current file with arbitrary text does not communicate geometry handoff. The planar profile also keeps this distinct from the solid section handoff below.'
  },
  {
    id: 'section-cam',
    paths: paths('M3 7l6-3 6 3v9l-6 3-6-3Z', 'M3 7l6 3 6-3M9 10v9', 'M3 12h12', 'M17 12h5M19 9l3 3-3 3'),
    reason: 'Keep the shallow solid used by CAD, show a true plane through it, and direct the resulting section to CAM. In the legacy icon the plane, body edge and transfer arrow compete along one midline.'
  },
  {
    id: 'toolpath',
    paths: paths(contour, 'M20 8v7M17 12l3 3 3-3'),
    reason: 'Replace the ambiguous open zigzag with a closed toolpath around the same contour used by CAM offset and lead icons. A directional marker follows the right-hand cut segment; open paths remain available in adjacent geometry tools.'
  }
];

export default camRevisions;
