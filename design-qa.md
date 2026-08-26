# Segment Geometry Presentation — Design QA

## Reference

The user-provided 1355 × 898 screenshot showed the previous full-circle segment
presentation:

- duplicated `From` and `To` coordinates for the same closure point;
- `Length`, `R`, and `sweep 360°` presented as an undifferentiated block;
- two nested endpoint cards repeating `Endpoint`, role, action guidance, and XY;
- clean topology metadata occupying the same visual weight as geometry.

## Verification Environment

- URL: `http://localhost:3777/wireedm-gcode-parser/`
- Browser: `npx agent-browser`
- Viewport: 1355 × 898
- Real project: `DXF-test-subjects/z18f25.dxf`
- Focused circle fixture: radius 5 at center `-75, -85`

## States Inspected

### Line

- Collapsed row shows segment identity and length.
- Expanded details show three aligned metrics: `ΔX`, `ΔY`, and `Heading`.
- Exactly two compact selectable rows appear: `Start` and `End`.
- `From`, `To`, nested endpoint badges, and clean topology text are absent.

### Arc

- Collapsed row shows segment identity, direction, and arc length without
  clipping.
- Expanded details show `Radius` and `Sweep`, then `Start`, `End`, and
  informational `Center` rows.
- The Statistics Inspector shows combined direction/sweep, arc length, points,
  and a collapsed Advanced geometry disclosure.

### Circle

- Collapsed row shows `CIRCLE`, direction, and circumference.
- Expanded details show `Radius`, `Center`, and one selectable `Cut start`.
- No duplicate end point or `360°` sweep is visible.
- Selecting `Cut start` selects the underlying raw start role.
- The Statistics Inspector uses Geometry, Path, and Source sections; Advanced
  geometry is collapsed and contains only start angle and start tangent for a
  clean circle.

## QA Fixes

1. **P1 — clean topology metadata remained visible**
   - Exact endpoint clusters with sub-display-precision differences were
     rendered as warnings.
   - Fixed by displaying cluster summaries only for `within-tolerance`
     topology.

2. **P1 — line metrics clipped in the rail**
   - The two-column inline layout truncated delta and heading values.
   - Fixed with a three-column label-over-value metric strip.

3. **P1 — React list-key warning**
   - Shared presentation point rows were returned directly from a map.
   - Fixed with keyed fragments; browser errors and console are now empty.

4. **P2 — curve summaries clipped in dense rows**
   - Radius and sweep competed with identity and length in the collapsed row.
   - Fixed by keeping identity/direction/length in the row and moving radius
     and sweep into the expanded type-specific metric strip.

## Interaction Checks

- Segment detail disclosures open and close.
- Line and arc selection highlights the corresponding canvas geometry.
- Cut-start selection maps to the raw start endpoint.
- Advanced geometry disclosure opens and closes.
- Inspector previous/next segment navigation remains present.
- Browser errors: none.
- Browser console warnings/errors after the final interaction pass: none.

## Final Result

final result: passed
