# Datum Sweep placement

Status: implemented and verified locally after Loft checkpoint `c16a15e`. Existing principal Sweep behavior and the saved feature definition are unchanged.

## Source placement and precision

A Sweep uses one active closed section boundary without holes and one active open planar line/arc Curve. Either source may use a world datum. Its section plane must contain the actual rail start and have a normal parallel or antiparallel to the rail's first tangent. The section's own roll, local position and traversal remain authored data; neither source is relocated, rotated, reversed or projected automatically.

Source inspectors and the pair resolver accept a prepared prefix datum lookup. The resolved result retains each actual source frame, section origin, anchor in section coordinates, placement residuals and numerical allowance. All-principal calculations keep their original path. Any-datum placement charges both frames' independent angular/origin uncertainty, offsets, local dimensions, anchor projection/reconstruction, actual mapped world scale and radius-amplified alignment. Per-segment native transport carries that scale into the existing cumulative `1e-7 mm` engineering reserve. Local conservative clearance and tangent continuity remain authoritative. Limits remain 64 rail segments and 2,048 section-edge/rail-segment products.

## Native construction

Six independent probes compared direct-world exact primitives with existing principal Sweep followed by an independent rigid Transform. Straight, clockwise quarter, major arc, G1 line/arc/line with a rolled off-centre section, XZ and antiparallel YZ examples agreed in volume and Common within `8e-13 mm³`; STEP reopen agreed within `9e-11 mm³`. Inverse-placement sections remained analytic. Unlike Loft's fitted surfaces, these exact primitives need no canonical rebase.

Create the section in its owned placed frame. For datum transport, map each authored local line displacement through the rail basis without subtracting large world endpoints. Map each arc centre through the rail frame and signed offset; use that frame's normal for signed revolution. Retain actual LastShape cap reuse, per-piece and fused-solid validation, native topology tolerance checks, and deterministic ownership. Any failure retains the preceding body and blocks partial export.

## Human and agent workflow

Keep the existing Profile sketch, Curve, Operation and Target fields. Inspect prefix frames once for source candidates, preserve stored unavailable IDs, and show one shared pair diagnostic. Do not filter section and rail by matching bases. Source selectors expose compact authored-placement details accessibly and on hover; no extra frame bar or alignment button.

Extract the bounded `cad_inspect_sweep` receipt into a pure document facade. Preserve existing response fields and add units, section placed origin/normal and rail endpoint. Full source bases remain available through `cad_inspect_plane`. No original source, profile or rail array is copied into a preflight response. The controller retains current-version, open/busy, workflow and cancellation checks before and after lazy loading. Eligibility does not certify native construction or a Boolean target.

## Verification

Domain checks cover distinct frames, roll, antiparallel orientation, mixed principal placement, displaced/misaligned sources, uncertainty amplification, cumulative transport and unchanged legacy behavior. Both adapters retain source originals and expressions and reject invalid placement without writes. Native checks cover independent rigid covariance, STEP and analytic sections, Join/Cut, parameter rebuild, native tolerance and interrupted ownership. Browser coverage uses shared preflight, visible creation, rejected radius growth, tilt/radius rebuild, actual PNG pixels, STEP download and explicitly aligned final-solid CAM transfer. Root reviews the numerical envelope, receipt bounds, cancellation and version guards independently.

Final CAD gate: 81 files / 1,003 tests pass. All 34 production CAD/kernel workflows were verified across the full run and a focused rerun correcting a test-only response-shape assertion. Independent native Codex WebMCP creation, capture and save also pass. Review corrected two missing reserve terms: rail-frame angular uncertainty amplified by the complete off-anchor section radius, and generated-profile world extent in cumulative transport arithmetic. The review record contains the evidence and unchanged broader regression baseline.
