# Task 5 Brief — Exact compensation transitions and readiness

## Binding context

- Follow `/home/cristian/code/WireEDM_app/AGENTS.md`.
- Follow `docs/superpowers/specs/2026-07-13-controller-compensation-machine-profiles-design.md`, especially Transition Geometry, Header and Footer Policy, Error Handling, and Structured Post.
- Implement only Task 5 from `docs/superpowers/plans/2026-07-13-controller-compensation-machine-profiles.md`.
- Preserve the physically verified Robofil 100 post exactly: native G38 activation, program-end cancellation, absolute I/J, D0, M02, CRLF, three decimals, one compensated operation, and no fabricated explicit lead-out.
- Use strict test-driven development: tests must fail for the intended missing behavior before production implementation.

## Scope

1. Add strict oriented endpoint tangent helpers for lines, arcs, and circles.
2. Add a pure, deterministic explicit-linear transition generator. It may rotate returned effective refs for an automatic start but must not mutate the UPID document.
3. Add compensated-export readiness validation for profile, intent, templates, lifecycle, transition geometry, work-area extent, and output precision.
4. Extend the existing template modal policy. Generic structured compensation rejects executable exact G20/G41/G42 words; comments, G200, G21, and G40 remain permitted. The Robofil comments-only rule remains stricter.
5. Add focused tests and a Task 5 report.

## Explicit safety decisions

- A manual start is never relocated. An unsafe manual start blocks.
- Sharp closure/start corners are not accepted for explicit-linear activation/cancellation. Automatic selection may rotate only to an existing safe endpoint, deterministically. It does not reverse traversal or split geometry.
- This intentionally resolves the plan's square inconsistency in favor of safety: the later Task 6 generic golden fixture must use a smooth existing start or deliberately implement a reviewed split. A sharp-corner square must not be made ready by weakening Task 5.
- The maximum-offset envelope is mandatory for explicit-linear compensation. A D index alone is not a physical clearance bound.
- Exact centreline intersections and overlaps block except the intended endpoint contact. The physical offset corridor must also be conservatively collision-free.
- Work-area checks compare the total geometry/transition/envelope extents with configured width/length; no absolute coordinate window is inferred.
- Output precision must keep each transition move nonzero after formatting.
- Existing circle-centre radial lead overrides block controller-compensated readiness.
- Native verified Robofil profiles bypass explicit-linear generation. Their controller-native transition remains governed by the existing verified post envelope.
- Profile verification for a manually selected compensated operation must not depend on `enabledByDefault`; that flag only controls automatic initialization.

## Files

- Create `src/domain/compensation/pathTangents.ts`
- Create `src/domain/compensation/linearTransitionGeometry.ts`
- Create `src/domain/compensation/validateCompensatedExport.ts`
- Create `src/domain/compensation/__tests__/linearTransitionGeometry.test.ts`
- Create `src/domain/compensation/__tests__/validateCompensatedExport.test.ts`
- Extend `src/domain/post/templateModalPolicy.ts`
- Extend `src/domain/post/__tests__/templateModalPolicy.test.ts`
- Modify `src/domain/path-intel/intersections.ts` only if a reusable exact classifier is genuinely required.
- Do not integrate Task 6 posting and do not edit Task 7 UI/preview files.

## Required verification

- Record focused RED output before production implementation.
- Run focused GREEN tests for Task 5 and template policy.
- Run full `npm test -- --run` and `npm run build`.
- Stage only Task 5 files and this brief/report; unrelated Task 7 changes remain untouched.
- Commit separately as `feat: validate compensation transitions`.
