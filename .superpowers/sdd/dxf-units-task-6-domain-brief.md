# DXF units Task 6 domain/post brief

## Scope

Implement the domain/post portion of DXF import units Task 6 under TDD, without touching the active Task 4 confirmation-dialog/controller/E2E work.

## Required behavior

- UPID geometry and posted X/Y/I/J remain canonical millimetres.
- Detect executable G20 words with the shared G-code interpreter, including compact and zero-padded words.
- Ignore G20 in parenthesized or semicolon comments and do not mistake G200 for G20.
- Block only UPID composition when the effective header, footer, candidate posted body, or selected project profile requests G20.
- Emit a blocking `post-inch-units-unsupported` diagnostic.
- Atomically remove the generated body, moves, operations, blocks, metrics, and program-operation trace from the blocked post.
- Keep `preferredDxfImportUnit: 'inches'` independent from output units and leave coordinates unchanged.
- Preserve external `gcode-text` import/normalization/export behavior, including files that contain G20.
- Preserve the physically verified Robofil/z39 output bytes and omit G20/G21 there.

## Files owned

- `src/domain/path-intel/types.ts`
- `src/domain/post/templateModalPolicy.ts`
- `src/domain/post/__tests__/templateModalPolicy.test.ts`
- `src/domain/upid/upidDocument.ts`
- `src/domain/upid/__tests__/upidDocument.test.ts`
- `src/__tests__/editorImportExport.test.tsx`
- `.superpowers/sdd/dxf-units-task-6-domain-brief.md`
- `.superpowers/sdd/dxf-units-task-6-domain-report.md`

## Explicit exclusions

- No Task 4 controller, dialog, DXF app-flow, or E2E changes.
- No coordinate conversion to inches.
- No global rejection of G20 in machine-profile files or external machine-program text.
- No edits to the Robofil verified post envelope.

## Verification

Run focused template/UPID/external-text tests, Robofil/z39 regressions, the full Vitest suite, production build, and `git diff --check`. Commit this slice separately and request independent review.
