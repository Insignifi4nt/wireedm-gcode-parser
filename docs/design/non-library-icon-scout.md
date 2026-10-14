# Non-library icon scout

Reviewed 2026-10-14 in the active checkout. This inventory covers non-Lucide icon semantics and icon-like visuals. It is a source audit, not an implementation change. The separate CAD/library import inventory remains responsible for Lucide consumers.

## Catalog candidates and missing semantics

| Location | Current visual and meaning | Catalog mapping / disposition | Accessibility notes |
| --- | --- | --- | --- |
| `index.html:7-10` | URI-encoded, hand-authored 64×64 SVG favicon: dark rounded square, bright wire/profile chevron, gold origin dot. This is the app mark. | Add a brand-specific `wire-edm-mark` catalog semantic or retain it as a separately authored brand asset. No matching brand ID exists in the current `icon-source.mjs`; do not force it into `origin`, `sketch`, or `curve`. | Favicon is browser chrome and does not need an in-page accessible name. Check favicon contrast and legibility at 16×16/32×32. |
| `src/features/cad/CadTopologyInspector.tsx:70` | The former `▾` / `▸` disclosure text is now `expand-down` / `expand-right` catalog icons at 12px. | Replaced. | The catalog SVGs are decorative (`aria-hidden="true"`); button label, `aria-expanded`, and `aria-controls` remain authoritative. |
| `src/features/cad/CadPathSegmentFields.tsx:20,24`, `src/features/cad/CadPolygonVertexFields.tsx:18,22` | Previous/next path segment and polygon vertex buttons used `‹` / `›`. | Replaced with `navigate-back` / `navigate-forward` at 14px. | Existing Previous/Next accessible names, boundaries, and disabled guards remain; icons are decorative. |
| `src/features/editor/EditorProgramTree.tsx:125` | Expand/collapse tree controls used `+` / `−`. | Replaced with `expand-right` / `expand-down` at 12px. | Existing dynamic “Expand/Collapse {label}” button name and tree state remain; icons are decorative. |
| `src/features/editor/EditorUpidRail.tsx:80,89,156` | Collapsed/expanded rail controls used `›` / `‹`; the collapsed current-lens switch used `P` / `G`. | Replaced with `panel-left-open`, `panel-left-close`, `file-code`, and the dedicated `geometry` icon at 14px. | Expand/Collapse and Switch to… accessible names and lens state remain; icons are decorative. |
| `src/features/editor/EditorWorkflowMenuBar.tsx:205` | Compact workflow back button used `‹ Categories`. | Replaced with `navigate-back` at 12px, retaining visible “Categories”. | The button remains named “Back to workflow categories”; icon is decorative. |
| `src/features/cad/CadWorkbench.tsx:389,397` | CAD feature and build diagnostics previously used `!` markers. | Replaced with `warning` catalog icons at 12px. | Feature tooltip and full diagnostic alert text remain; warning icons are decorative. |
| `src/features/editor/EditorPathNavigatorPanel.tsx:2254` | Colored `●` beside each spatial machining event. The color distinguishes authored, post-emitted, generated manual-thread pauses, and ordinary events. | No direct icon ID. It marks the event row as spatial; the row remains the selectable action, and `action.label` already names the pause/event (“Authored stop”, “Controller pause · …”, “Manual rethread pause”, etc.). Keep it as a decorative domain marker; don't map it to generic `busy` or `status` icons. | The marker currently has no explicit `aria-hidden`; it is decorative because the event name is adjacent. Hide the bullet from assistive technology if this markup is touched. The text label already preserves pause meaning without color. |
| `src/features/editor/GCodeInspectionWorkspace.tsx:161` | `•` suffix after line numbers with diagnostics. | Exclude from icon catalog: inline diagnostic marker attached to the line number; semantic is already repeated in the diagnostics content. | Ensure the diagnostic relation remains available through text/accessible description; avoid relying on the bullet or amber color alone. |
| `src/features/cad/CadWorkbench.tsx:403`, `src/features/cad/cad-workbench.css:166-167` | CSS circle status dot (green ready, amber error) in CAD status bar. | Exclude as a catalog icon. If kept decorative, mark it `aria-hidden`; state text (“Ready”, “Feature needs attention”, etc.) is adjacent and authoritative. | Current dot is a plain span without `aria-hidden`; it is empty, so usually silent, but explicitly hiding it is clearer. Status is already written as text and must remain so. |

## Inline SVG and CSS audit

- No CSS `::before` / `::after` generated icon shapes or CSS `content:` glyphs were found in `src` or `package-tools`. The CSS matches for `content` were layout properties such as `align-content` / `justify-content`.
- `src/components/icons/WorkbenchIcon.tsx:11-17` renders original catalog paths from `iconCatalog`. Current CAD/editor call sites use its named exports; unlabeled icons are hidden from assistive technology, while a supplied `aria-label` makes a standalone SVG meaningful.
- `src/features/cad/CadSectionDialog.tsx:16-26` is an accessible exact analytic section preview (`role="img"`, label “Exact section preview”), built from line/circle/arc geometry. Exclude from icons: this is user data visualization.
- `src/features/cad/CadSketchCanvas.tsx:227-294` is the interactive sketch/curve drawing surface (`role="application"`) and contains geometry and interaction affordances. Exclude its geometry points, axes, crosshair and profiles from icon assets.
- `src/features/editor/EditorPreview.tsx:1022-1807` is the 2D model/program preview, containing grid/axis lines, toolpath, selected-point rings, measurement guides, and labels. These encode model coordinates and selection/measurement state, not reusable icons. Keep accessibility on the preview itself and do not replace exact geometry with catalog shapes.
- `src/features/cad/cad-workbench.css:166-167` contains the only app CSS-drawn circular status marker found; it is covered above.

## Native controls and package tools

- `summary` disclosure arrows and select/file controls are browser-native widgets (for example `src/features/package-tools/PackageToolsPage.tsx:143,154`, `src/features/simulation/MachineSetupPanel.tsx:114,129`, and many labeled selects/file inputs). Do not draw catalog replacements for browser chrome or native picker affordances. Preserve native keyboard behavior and labels.
- Package authoring UI (`src/features/package-tools/PackageToolsPage.tsx` and `package-tools/index.html`) uses text-labeled buttons, file inputs, details/summary, and result headings; it has no non-library icon glyphs or inline icon SVGs. Its single-line stylesheet `src/features/package-tools/package-tools.css:1` defines no pseudo-element artwork.
- The main app imports `src/assets/wire-edm-onboarding-poster.png` in `src/features/onboarding/OnboardingDialog.tsx:4`. This 2.6 MB raster is an onboarding illustration/poster, not a reusable interface icon; leave it outside the catalog.
- No separate `.ico`, raster app icon, or package-tools favicon was found. The main favicon is the encoded inline SVG noted above.

## Text notation to keep as text

Unicode arrows and multiplication signs in measurements, coordinates, and workflow copy (for example `→` in `src/app/MachinePostSettingsPanel.tsx:220`, `×` in `src/features/dashboard/DxfImportConfirmationDialog.tsx:351` and `src/features/simulation/SimulationPanel.tsx:184`, and `↑↓` keyboard guidance in `src/features/editor/GCodeInspectionWorkspace.tsx:167`) are mathematical notation, directional values, or keyboard hints. They are not icon instances and should not be substituted with icons.
