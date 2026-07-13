# Robofil Multi-Contour Route V2 Design

Date: 2026-07-14

## Goal

Add a versioned, testable Robofil 100 multi-contour export lifecycle and make the planned rapid route visible, editable, optimizable, and fully operable by humans and browser agents. Preserve the existing single-contour verified post as version 1.

## Acceptance Fixture

The primary acceptance fixture is `C:\Users\cristian\Documents\Catia\COGEME\Prisma\Prisma fixa 1 cog.dxf`.

After placement, its finished-contour bounds must be exactly:

- X: `-32.500` through `32.500` (centered on X0);
- Y: `0.000` through `64.500` (bottom on Y0);
- document center: `0.000, 32.250`;
- two circular holes centered near `X=-17.500` and `X=17.500`, both at `Y=24.900`.

The recommended program begins from the center of one hole, travels by a deliberate linear lead to the selected circle start, cuts both holes before the exterior, and exposes every inter-operation rapid in the editor and export trace.

## Safety and Evidence Boundary

The existing Robofil post version 1 remains unchanged and single-contour. Version 2 is a separate policy requiring explicit user verification. It implements the operator-confirmed invariant that rapid traverse must occur with controller compensation cancelled.

Every version-2 rapid boundary must follow this modal structure:

```gcode
G39
G40
G0 X... Y...
G41 D0
```

or `G42 D0` according to resolved kept-material intent and actual winding. `G39` and `G40` are separate traceable blocks. The initial program setup remains `G92 X0 Y0`, `G60`, `G38`, and `G90`. Version 2 must never emit a `G0` while the tracked compensation state is `G41` or `G42`.

Generated files are test candidates, not declarations of machine readiness. They must be clearly labelled with their policy version and require simulation/dry-run confirmation.

## Domain Architecture

### Machine policy

Robofil post version 2 uses an operation-scoped `charmilles-g39` cancellation lifecycle. The machine-profile fingerprint includes the post version and lifecycle fields, so changing from v1 to v2 invalidates prior verification. A helper creates an unverified v2 candidate profile; browser tests explicitly acknowledge it before compensated export.

### Planned travel

Planned travel is independent from posted travel. The editor always renders canonical planned rapid links derived from the path document, even when machine posting is blocked. Ready export may overlay posted transitions, but an empty or blocked posted trace must not erase the plan.

Rapid endpoints remain canonical rather than duplicated:

- the first rapid starts at `document.options.startPoint`;
- each rapid ends at the operation entry point;
- for closed contours, the previous rapid source is the previous operation start/end;
- editing a rapid destination updates that operation's start;
- editing a non-first rapid source updates the previous closed operation's start;
- editing the first rapid source updates the document start point.

### Route optimization

The recommended route preserves containment prerequisites (holes before their containing exterior), then minimizes rapid travel jointly across eligible operation order and available contour start candidates. Existing manual order/start overrides remain authoritative until the user explicitly reapplies automatic planning.

For native circles, the optimizer may choose a start on the circumference closest to the preceding route position. Manual circle starts are stored as explicit start overrides without degrading the circle geometry.

### Lead movements

The Prisma acceptance program uses hole-center pierce/approach points as rapid destinations and linear lead movements from each hole center to its selected circumference start. Controller compensation is activated on the linear lead, not during the preceding rapid. Exterior entry uses a validated linear lead from a safe exterior approach point. Lead geometry is included in preview, metrics, trace, and modal audit.

## UI and Browser-Agent Contract

Every human action required by this workflow has a stable accessible name and semantic `data-*` hook:

- select planned rapid;
- inspect rapid source, destination, and length;
- edit first rapid source coordinates;
- set rapid destination from canvas or exact X/Y fields;
- optimize/reapply route;
- select a Robofil post version;
- acknowledge the v2 test candidate;
- open export preview and download a named test artifact.

The UI distinguishes `Planned rapid` from `Posted rapid`. Browser automation must not depend on icon position, CSS class, or incidental text order.

## Export Artifacts

Verification writes test candidates under `artifacts/robofil-v2/prisma-fixa-1-cog/`:

- a recommended v2 multi-contour program;
- a reversed-direction variant proving G41/G42 recomputation;
- a source-order comparison variant;
- a v1 blocked-result report;
- a generic-profile comparison program;
- a JSON manifest recording bounds, route, modal audit, hashes, diagnostics, and verification commands.

Artifacts are never imported into application defaults or labelled machine-ready.

## Testing

Domain tests cover post-version normalization and verification, exact modal sequences, no rapid under compensation, per-contour compensation resolution, route ordering, circle starts, lead moves, placement, and atomic blocking.

Component tests cover planned-route visibility under blocked v1 posting, exact coordinate editing, undo/redo, accessible browser-agent controls, and export preview trace semantics.

End-to-end tests import the real Prisma DXF through browser cache, confirm units, place it at the acceptance bounds, choose/verify v2, optimize the route, inspect/edit rapid links, export, and assert the downloaded bytes.

The full Vitest suite, production build, Playwright suite, and an interactive browser verification run are required before completion.

## Deferred Scope

`.CMD`, `.TEC`, rough/skim orchestration, automatic threading/cut-wire codes, generator/flushing codes, and U/V taper output remain deferred until exact-machine fixtures exist. Version 2 must not infer those codes from generic Charmilles or Robofil 440 references.
