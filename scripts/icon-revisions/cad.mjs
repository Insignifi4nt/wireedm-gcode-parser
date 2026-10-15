// Isolated CAD/geometry/view alternatives for iteration 2. These are proposals;
// scripts/icon-source.mjs and generated catalog assets remain unchanged.
export const cadRevisions = [
  {
    id: 'revolve',
    paths: [
      'M12 3v18',
      'M9 7H6v10h3Z',
      'M15 5c4 1 6 4 6 7s-2 6-6 7',
      'M18 17l-3 2 1-4',
      'M6 7h3',
      'M6 17h3',
    ],
    reason: 'Separate a closed source profile from the axis and circular sweep cue; current bracket-like profile and detached arc read as a sideways fixture, not a revolve operation.',
  },
  {
    id: 'loft',
    paths: [
      'M5 5Q12 1 19 5Q12 9 5 5Z',
      'M8 18Q12 15 16 18Q12 21 8 18Z',
      'M5 5L8 18',
      'M19 5L16 18',
      'M12 7v10',
    ],
    reason: 'Use two visibly closed section loops connected by generators. Current outline reads as a tapered sheet with ambiguous interior contours rather than a loft between profiles.',
  },
  {
    id: 'sweep',
    paths: [
      'M3 16h5v5H3Z',
      'M8 18C11 13 15 9 21 7',
      'M17 5l4 2-2 4',
    ],
    reason: 'Make the closed section, curved trajectory, and direction cue separate primitives, with the path visibly starting at the section. Current ribbon endpoint is disconnected from the starting profile and reads as a broad bent strip.',
  },
  {
    id: 'pad',
    paths: [
      'M4 15h5V9h6v6h5v6H4Z',
      'M12 9V3',
      'M9 6l3-3 3 3',
      'M4 15h5',
      'M15 15h5',
    ],
    reason: 'Keep the feature as a closed profile/extrusion diagram, but remove redundant inner joins and clarify that the arrow rises from the profile plane. This retains the more readable orthographic feature language instead of forcing every operation into an isometric solid.',
  },
  {
    id: 'pocket',
    paths: [
      'M4 9h5v6h6V9h5v12H4Z',
      'M12 3v10',
      'M9 10l3 3 3-3',
      'M4 9h5',
      'M15 9h5',
    ],
    reason: 'Match pad’s profile construction and side shoulders while retaining a downward arrow into the closed stock contour; the paired icons should differ by operation direction and cut geometry only.',
  },
  {
    id: 'pad-pocket',
    paths: [
      'M4 20V9h5v6h6V9h5v11Z',
      'M12 8V3',
      'M9 6l3-3 3 3',
      'M12 10v4',
      'M10 12l2 2 2-2',
    ],
    reason: 'Represent additive and subtractive directions together with two small, distinct arrows and a single closed stepped profile. Current path puts one arrow into the contour and reads like a malformed pocket.',
  },
  {
    id: 'shell',
    paths: [
      'M4 4h16v17H4Z',
      'M8 4v12h8V4',
      'M8 16h8',
      'M4 4l4 0',
      'M16 4h4',
    ],
    reason: 'Show a closed outer solid and a closed-bottom internal cavity with consistent wall boundaries. The current U-shaped inner contour ends ambiguously at the top and can read as a forked slot.',
  },
  {
    id: 'boolean',
    paths: [
      'M3 5h11v11H3Z',
      'M10 9h11v11H10Z',
      'M10 9h4v7h-4Z',
      'M7 3v2',
      'M17 20v2',
    ],
    reason: 'Separate both closed operands and the overlap region so the intersection is legible as an operation target. Current internal rectangle is easy to read as an accidental extra box; if filled overlap is needed later, it should be a separately styled path.',
  },
  {
    id: 'imported-body',
    paths: [
      'M4 8l8-4 8 4v9l-8 4-8-4Z',
      'M4 8l8 4 8-4',
      'M12 12v9',
      'M12 2v7',
      'M9 6l3 3 3-3',
    ],
    reason: 'Reuse the body family’s closed isometric volume before adding the incoming import arrow. Current imported-body starts at an open top rim with no apex, so it can read as an open container rather than a solid.',
  },
  {
    id: 'select-face',
    paths: [
      'M3 8l7-4 7 4v9l-7 4-7-4Z',
      'M3 8l7 4 7-4',
      'M10 12v9',
      'M8 7l2 1 2-1',
      'M10 7l7 6-3 .5-1 3.5Z',
    ],
    reason: 'Provide the same complete isometric body used by body/imported/select-body, then point at its top face. Current face-only quadrilateral lacks object context and looks like a loose plane.',
  },
  {
    id: 'select-edge',
    paths: [
      'M3 8l7-4 7 4v9l-7 4-7-4Z',
      'M3 8l7 4 7-4',
      'M10 12v9',
      'M9.2 11.4a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0',
      'M16.2 7.4a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0',
      'M14 9l7 6-3 .5-1 3.5Z',
    ],
    reason: 'Retain the common isometric target body and use the cursor on a visible edge. The current isolated diagonal with endpoints does not share the body’s perspective or selection target scale.',
  },
  {
    id: 'select-body',
    paths: [
      'M3 8l7-4 7 4v9l-7 4-7-4Z',
      'M3 8l7 4 7-4',
      'M10 12v9',
      'M17 12l6 4-3 1-1 4Z',
    ],
    reason: 'Keep this as the reference selection target; it establishes the shared isometric body plus pointer language for face and edge selection.',
  },
  {
    id: 'mirror',
    paths: [
      'M12 3v3M12 9v6M12 18v3',
      'M3 6l6 3v9l-6-3Z',
      'M21 6l-6 3v9l6-3Z',
    ],
    reason: 'Preserve symmetric mirrored solids but close both silhouettes explicitly. This is primarily a contour audit; the original semantics are already strong.',
  },
  {
    id: 'linear-pattern',
    paths: [
      'M3 9h4v6H3Z',
      'M10 9h4v6h-4Z',
      'M17 9h4v6h-4Z',
      'M3 20h18',
      'M18 17l3 3-3 2',
    ],
    reason: 'Close all repeated instance outlines and retain a distinct baseline/direction cue. Current geometry is recognizable but the tiny rectangles rely on open paths and soften at 14px.',
  },
  {
    id: 'circular-pattern',
    paths: [
      'M10 3h4v4h-4Z',
      'M3 16h4v4H3Z',
      'M17 16h4v4h-4Z',
      'M5 12a7 7 0 0 1 3-5',
      'M16 7a7 7 0 0 1 3 5',
      'M9 20h6',
      'M12 10v3',
    ],
    reason: 'Close all instances and make the center/pattern axis read more clearly; current tiny central dot collides visually with the radial arrow-like strokes at toolbar sizes.',
  },
  {
    id: 'datum-plane',
    paths: [
      'M3 12l9-5 9 5-9 5Z',
      'M3 12l9 5',
      'M12 17v3',
      'M4 20h5',
      'M7 20v-4',
    ],
    reason: 'Align the datum plane’s rhombus with the same isometric axis slopes used by body, imported-body, and select-body. The current flatter oblique plane uses a different projection and its detached base marker is underspecified.',
  },
  {
    id: 'view-top',
    paths: [
      'M5 5h14v14H5Z',
      'M3 12h18',
      'M12 3v18',
      'M9 5l3-2 3 2',
    ],
    reason: 'Keep a plan-view square and add a restrained north/up cue to distinguish the top orientation from a generic grid. Do not add perspective to a strictly top-view control.',
  },
  {
    id: 'view',
    paths: [
      'M4 4h16v16H4Z',
      'M12 15V8',
      'M12 15l-4-3',
      'M12 15l5-2',
    ],
    reason: 'Close the view cube outline while preserving its three-axis orientation marker. The existing shape is semantically clear; this is only a contour cleanup.',
  },
];

export default cadRevisions;
