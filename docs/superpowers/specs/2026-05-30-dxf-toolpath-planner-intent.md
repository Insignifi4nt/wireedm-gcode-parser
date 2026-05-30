# DXF Toolpath Planner Intent Notes

Date: 2026-05-30

These notes capture the current product intent for the DXF-to-G-code planner before writing the final implementation design.

## Current Constraints

- Do not implement DXF offset or kerf compensation in the initial planner.
- The target machine is a Charmilles Robofil 100.
- Wire compensation is handled by the machine through `G41`/`G42` configured in the header.
- The DXF import should initially generate the exact path extracted from the DXF, ordered into natural continuous cuts.

## Planner Direction

- Convert parsed DXF geometry into reversible cut segments.
- Use reversible segments so the planner can connect unordered DXF entities and reverse an entire contour direction later.
- Keep the segment, contour recognition, ordering, and G-code emission stages modular and replaceable.
- Endpoint snapping is useful, but should be designed as a configurable tolerance rather than hidden behavior.
- The first implementation can use a conservative default tolerance while keeping exact-coordinate DXFs effectively unchanged.

## Contours And Ordering

- The app should consistently recognize contours and classify them as exterior or interior where possible.
- A DXF may contain one exterior contour, many interior contours, or multiple exterior contours.
- A safe default cut order can be interior before exterior, with nearest-contour ordering for independent contours.
- The user must be able to inspect and change contour cut order.
- The user should eventually be able to reverse contour cutting direction.

## Workbench Direction

- The app is intentionally a workbench, not only a single isolated editor.
- A future canvas may allow multiple contours or parts to be arranged into one larger G-code file.
- The long-term workflow may include setting sheet or machine coordinate bounds, placing multiple contours relative to each other, and running a sequence of cuts without recalibrating between each cut.
- The planner should stay modular enough that future optimizers can be added outside the core import pipeline.

## Out Of Scope For Initial Planner

- Automatic kerf compensation.
- Automatic offset generation.
- Automatic lead-in generation.
- Sheet nesting.
- Advanced optimization beyond simple contour ordering.
