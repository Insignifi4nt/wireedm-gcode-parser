# CAD shared controls migration

Migrated the CAD portion of the whole-app control standard from `6e85fd84ac85893fd0eff516031f223aeab507d8`. The completed source is in the recovered `cad-shared-controls/Wire_EDM` worktree. This slice changes CAD TSX/CSS and its focused interaction assertions. Shared primitives, theme, guards, dependency work and browser verification remain root-owned.

## Changes

- Thirty CAD modules now use shared `Button`, `Input` and `Textarea` for all 175 existing native buttons and fields. Native refs, values, event handlers, input types, form submission, disabled fieldsets and domain guards remain intact. Apply/finish, destructive actions and on-part dimension chips use the shared primary, danger and outline variants. The compact Named view control uses the shared Select's quiet toolbar appearance.
- Context, Pattern, edge-treatment and File popups use `MenuSurface`, `MenuItem`, `MenuSeparator` and `MenuLabel` where applicable. Existing portal placement, outside dismissal, popup clamping, command checks and keyboard owners remain. The kernel-license menu link remains an actual anchor.
- Existing control hints use the shared Tooltip without replacing accessible names. Informational filename, placement, provenance and calculation hints use Tooltip composition. Loft option metadata uses `data-description` for the customizable native picker. SVG model titles remain intact. Rich `CadContextHelp` keeps its hover/focus preview, click pinning, dismissal and focus return.
- Removed feature control palettes, custom focus/disabled styles and the DXF brightness hover override. Shared controls own those states. CAD retains layout, sizing, transparent overlays and token-based tree/context/diagnostic indicators. Native model geometry, sketch strokes/fills and viewport layout are unchanged.

## Verification

Before migration, five focused files passed 22 cases. A new File-menu keyboard regression failed because opening left focus on the trigger. Its small focus owner now selects the first command, keeps shared arrow navigation, returns Escape to File and sends Tab to the next toolbar control. The same test verifies that the session snapshot stays identical.

Final focused run: 22 browser/UI files, 237 cases passed in 13.72 seconds, with four workers. Coverage includes Workbench workflows, scalar drafts, linked and locked plugin inputs, source metadata, quantities, menus/help, parameter forms, plugin authoring, DXF/section dialogs, previews, dimensions and depth interactions. Existing explanation assertions now verify shared accessible descriptions with unchanged expected text. An independent AST comparison checked the 175 native control contracts; the only nonappearance differences are the intentional menu semantics and File focus ownership.

No server, browser, storage mutation or commit was performed by this slice. Root owns final type/build, full-suite and actual visual checks.
