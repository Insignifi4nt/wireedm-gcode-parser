# CATIA sketcher workflow notes

Date: 2026-10-19

The CAD workbench takes its interaction model from CATIA V5, kept quieter and more modern, and adds Onshape-style direct manipulation where that saves steps. These notes record what CATIA does, what the workbench now matches, and what is still missing. The source is the CATIA V5 Sketcher user guide (DS online documentation, `dysug` pages), together with common workflow guides.

## Principles taken from CATIA

- **Either order works: select then command, or command then select.** You can pick a plane in the tree or the geometry area and then choose Sketch, or choose Sketch and then pick the plane. Constraints work the same way: select the elements and run the command, or run the command and pick the elements.
- **The command offers only what fits the selection.** "Constraints Defined in Dialog Box" lists the constraints that apply to the selected elements. Constraints that already exist are shown checked, and clearing one removes it.
- **The constraints depend on how many elements are selected:**
  - One element: Fix, Horizontal, Vertical, plus the dimensions Length and Radius/Diameter.
  - Two elements: Coincidence, Concentricity, Tangency, Parallelism, Midpoint, Perpendicularity, plus the dimensions Distance and Angle.
  - Three elements: Symmetry and Equidistant point.
- **Plane references are ordinary operands.** The sketch origin and the H and V axes are selectable and can take constraints. They are drawn as short arrows at the origin, not lines across the whole view.
- **Constraint state uses colour.** White means under-constrained, green fixed or iso-constrained, purple over-constrained, and red inconsistent.
- **SmartPick creates constraints while drawing,** and the H, V, L and A value fields can be typed in the middle of a command.
- **Multi-selection** uses Ctrl+click or a box drag. A right-click on a constraint command switches its type.
- **The background is a graduated gradient,** dark blue at the top fading lower down.

## What the workbench matches after `feature/catia-style-sketch-selection`

- **Slot** draws connected geometry: two tangent lines, two equal end arcs, a construction axis, and a center point held at the middle of that axis. Selecting the center and the origin and applying Coincident moves the whole free slot onto the origin, then holds it there.
- **Origin and axes** are drawn as short H and V arrows, a fixed number of pixels long at any zoom. In Select they work like sketch geometry: hover highlight, click, and Shift+click to add to the selection. During a constraint command they remain pickable operands.
- **Selection-first constraints.** With geometry or plane references selected, the Constrain menu begins with a "For the selection" section:
  - Constraints that can be added are listed.
  - Constraints already in place are checked; choosing one removes the relations that hold it.
  - Constraints that fit the selection but conflict with existing ones are disabled, with the reason as their tooltip.
  - The same entries appear in the right-click menu. The tool-first list stays below for picking after choosing.
- **Rigid placement.** A new positional relation that places a free shape onto the origin, an axis or another shape's point first translates the whole connected shape. The solver then only holds the shape in place. Without the translation, unsigned tangency could flip an arc during a large solver jump.
- **View background** in both the sketch canvas and the 3D view is a navy-to-slate vertical gradient. The lower stop stays dark enough to keep the depth-handle and source-highlight contrast that existing tests check.

## Gaps against CATIA, by tool

| Area | CATIA | Workbench today | Candidate next step |
| --- | --- | --- | --- |
| Entering a sketch | Plane in the tree or the geometry area, either order; planes always visible and highlighted on hover | Plane must be selected first, or picked in a plane request; principal planes appear only during the request and sit in a collapsed Reference folder | Keep the planes visible as small squares at the origin, sync hover between the tree and the canvas, and move the planes to the top level of the tree |
| Constraint colour | White, green, purple and red per element | DOF count in the sketch panel | Colour elements by solve status from the existing degrees-of-freedom analysis |
| Contact constraint | One command that infers coincidence, concentricity or tangency from the pair | Separate Coincident, Concentric and Tangent entries | Use the selection-first list as the base and add a "Contact" default that picks the first available choice |
| Fix together, auto constraint, animate constraint | Available | Not available | Auto constraint fits once relation inference has a domain API |
| Dimensions in the selection list | Length, radius, distance and angle in the same dialog | Separate Dimension command | Add dimension rows to the selection list once a dimension value can be typed inline |
| Profile shapes | Centered rectangle, oriented rectangle, parallelogram, keyhole, hexagon, cylindrical slot | Rectangle, circle, slot, polyline, path | Centered rectangle and keyhole reuse the slot construction pattern |
| Operations | Break, rotate, scale, symmetry, project, intersect | Trim, move, offset loop, mirror copy, pattern, use reference, corner and chamfer | Rotate and scale can reuse rigid placement; Break pairs with Trim |
| Select-then-command everywhere | Most commands accept a preselection | Dimension, move, mirror and pattern accept a selection; constraints now do too | Audit the remaining commands for a preselection path |

## Onshape-style additions to keep

- Drag a 3D face or a depth arrow to change an extrusion directly. The extrude depth handle already does this for length; extend it to other features.
- Drag sketch geometry while the solver keeps relations live, which the graph drag already provides.
- Keep direct manipulation going through the same domain operations and checks as the panels, as the workbench rules require.
