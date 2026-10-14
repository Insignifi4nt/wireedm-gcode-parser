// CAD iteration 4 alternatives and semantic review dispositions.
// This study does not change the shared icon source or generated assets.
const body = [
  'M4 8l8-4 8 4v9l-8 4-8-4Z',
  'M4 8l8 4 8-4',
  'M12 12v9',
];
const bodyPointer = 'M18 12l4 3-2 1-1 4Z';

export const cadV4 = [
  {
    id: 'revolve', variant: 'stepped-profile-axis',
    paths: [
      'M12 2v20',
      'M10 5H8v3H5v8h3v3h2Z',
      'M16 4c4 2 6 5 6 8s-2 6-6 8',
      'M16 17l-1 3 4-1',
    ],
    reason: 'Close a stepped source profile against a visible axis, with a restrained rotational cue. This is the orthographic input-operation metaphor.',
  },
  {
    id: 'revolve', variant: 'stepped-lathe-result',
    paths: [
      'M7 3H17V7H15V17H17V21H7V17H9V7H7Z',
      'M12 2v20',
      'M19 6c3 3 3 9 0 12',
      'M17 16l2 2 2-2',
    ],
    reason: 'Show a closed symmetric stepped turned body around its axis and an external circular cue. This tests a clearer revolved result than the generic cylinder option.',
  },
  {
    id: 'loft', variant: 'oblique-section-rhombi',
    paths: [
      'M12 3l4 2-4 2-4-2Z',
      'M12 14l8 4-8 4-8-4Z',
      'M12 3v11',
      'M16 5l4 13',
      'M12 7v15',
      'M8 5L4 18',
    ],
    reason: 'Use two closed oblique rhombus sections with different sizes at different heights, joined at corresponding vertices. The projections follow the body’s ±0.5 axes rather than flat horizontal rectangles.',
  },
  {
    id: 'sweep', variant: 'tube-no-centerline',
    paths: [
      'M3 17C7 8 12 3 19 3L21 7C15 8 11 13 8 21Z',
    ],
    reason: 'Keep the closed curved tube body and remove its center trajectory to test whether the result reads more cleanly at 14–16px.',
  },
  {
    id: 'sweep', variant: 'tube-centerline-end-seam',
    paths: [
      'M3 17C7 8 12 3 19 3L21 7C15 8 11 13 8 21',
      'M8 21L3 17',
      'M5.5 19C9 10 14 5 20 5',
    ],
    reason: 'Keep the center trajectory but draw the starting end section as its own seam, so its job is clear and can be compared with the cleaner outline-only result.',
  },
  {
    id: 'select-face', variant: 'isolated-body-axis-face',
    paths: [
      'M4 8l8-4 8 4-8 4Z',
      'M9 7l4 3-2 1-1 4Z',
    ],
    reason: 'Keep an isolated face target with exact body top-face coordinates and slopes. Reuse the select-body pointer silhouette, positioned so its tip lands inside the target face.',
  },
  {
    id: 'select-edge', variant: 'isolated-body-axis-edge',
    paths: [
      'M12 4L20 8',
      'M11 4a1 1 0 1 0 2 0a1 1 0 1 0-2 0Z',
      'M19 8a1 1 0 1 0 2 0a1 1 0 1 0-2 0Z',
      'M16 6l4 3-2 1-1 4Z',
    ],
    reason: 'Keep the edge target isolated, use the exact body top-edge slope and endpoints, and reuse the select-body pointer shape with its tip on the edge.',
  },
  {
    id: 'select-body', variant: 'body-projection-shared',
    paths: [...body, bodyPointer],
    reason: 'Match the shared body source geometry exactly (8/4 slopes rather than the current 7/4 mini-cube) while retaining its existing pointer modifier.',
  },
];

export const cadV4Coverage = [
  ['body', 'reference', 'The shared body primitive has exact 8/4 projected top-face edges.'],
  ['datum-plane', 'retain', 'The v3 datum contour intentionally reuses body’s exact top-face rhombus, without support ticks.'],
  ['revolve', 'iterate', 'Compare a stepped closed profile about an axis with a stepped turned result and rotation cue.'],
  ['loft', 'iterate', 'Compare closed oblique section rhombi joined by corresponding generators.'],
  ['sweep', 'iterate', 'Compare closed tube without a centerline against a visible end seam plus centerline.'],
  ['select-face', 'iterate', 'Isolated face target; exact body projection and shared pointer modifier.'],
  ['select-edge', 'iterate', 'Isolated edge target; exact body projection and shared pointer modifier.'],
  ['select-body', 'iterate', 'Review current 7/4 mini-cube against the body source’s 8/4 projection.'],
  ['boolean', 'retain', 'Two operand boxes and the overlap-result rectangle are all closed; no decorative ticks.'],
  ['boolean-union', 'retain', 'The concave union-result silhouette ends with Z; the plus cue is a separate open mark.'],
  ['boolean-subtract', 'retain', 'The concave subtraction-result silhouette ends with Z; the minus cue is a separate open mark.'],
  ['boolean-intersect', 'retain', 'The output rectangle is closed. The two partial operand guides are intentionally open contextual edges.'],
];

export default cadV4;
