# Workbench design system

This is the implementation contract for the library, CAD, CAM, simulation, settings and standalone package tools. `src/components/ui/` owns reusable controls and interaction patterns. `src/components/ui/theme.css`, imported by both application entry points, owns palette and scale tokens. Features own domain labels, eligibility, validation, commands and layout.

Use the supported components before adding another implementation. Add a shared component or variant only when a real consumer needs behavior the current set cannot express. A component migration must preserve the native element, editing contract and workflow guards.

## Tokens, type and hierarchy

New work uses semantic theme tokens. Shared control CSS contains no literal colors or private palettes. Put new reusable color roles in `theme.css` and consume them by role. Keep foreground/background pairs together.

| Role | Existing tokens |
| --- | --- |
| Page and panels | `--background` / `--foreground`, `--card` / `--card-foreground`, `--surface-raised`, `--surface-inset` |
| Popups and help | `--popover` / `--popover-foreground`, `--popup-shadow` |
| Main action | `--primary` / `--primary-foreground`, `--primary-hover` |
| Quiet action and selection | `--secondary` / `--secondary-foreground`, `--accent` / `--accent-foreground` |
| Secondary information | `--muted`, `--muted-foreground`; essential values remain foreground text |
| Destructive and invalid | `--destructive` / `--destructive-foreground`, `--destructive-hover`, `--destructive-subtle` |
| Edges and focus | `--border`, `--input`, `--control-hover-border`, `--ring` |
| Scrolling | `--scrollbar-thumb`, `--scrollbar-track` |

Selection, diagnostic and geometry colors carry domain meaning and may remain in feature rendering. They do not authorize another control palette. Meaningful color needs a label, icon, state attribute or diagnostic text.

| Scale | Canonical values |
| --- | --- |
| Type | `--text-caption` 10px, `--text-control` 11px, `--text-body` 12px, `--text-heading` 14px, `--text-title` 20px |
| Families | `--font-sans` for interface text; `--font-mono` for source, expressions, coordinates and technical values |
| Container spacing | `--space-1/2/3/4/6/8` are 4/8/12/16/24/32px |
| Density | `--control-height` 24px; `--field-height` 28px |
| Corners | `--control-radius` 4px, `--popup-radius` 6px, `--panel-radius` 8px |
| Icons | `--icon-control` 14px; `--icon-standalone` 16px |
| Motion | `--motion-fast` 120ms; `--motion-expand` 180ms with `--motion-ease` |

These are defaults for new work. Existing measured layouts and shared controls' intrinsic padding, strokes and alignment may use smaller increments. Canvas handles, source rows and narrow technical rails retain functional sizing. This does not claim every legacy layout already uses every token.

Use sentence case for headings, labels, help and commands. Preserve authored acronyms such as CAD, CAM, DXF and UPID, axis names, identifiers, filenames and source text. Forced-uppercase styles are banned. Do not rewrite stored values or program text to satisfy a presentation rule.

Use weight, spacing and grouping to distinguish headings. Keep secondary metadata quieter than its value. Technical readouts may use tabular numerals. Formatting human summaries must not round pending edit text or replace raw expressions.

## Supported components and states

Icons come from `@wire-edm/icons-react`. Use semantic named exports such as `PadIcon` and `PocketIcon`, or the individual `icons/pad` entry. Normal imports retain only used drawings; the full dynamic renderer/catalog is a separate subpath. SVGs inherit the control's color and state. Keep the standard 24-unit grid, 1.75 stroke, theme sizes and control's accessible name. Glyphs are decorative by default; a standalone image requires an accessible label. Change geometry in `scripts/icon-source.mjs` and regenerate package modules and SVGs together. Do not add another inline action glyph or icon library. `npm run icons:check` checks generation, purpose mapping, behavior and isolated packed consumers.

| Component or pattern | Contract |
| --- | --- |
| `Button` | Native props/ref and omitted-type behavior. Default `ghost` / `compact` is quiet and 24px. `primary` and its `default` alias identify the main action; `secondary`, `outline`, `danger`, `menu` and `scrim` express existing intent. Sizes are `compact`, its `sm` alias, `md` at 28px, `icon` and `menu`. Use explicit `type="button"` for commands inside forms. `asChild` retains child semantics. |
| `Input` | Native types, labels, constraints, values and refs. Default 28px; `density="compact"` is 24px. Checkbox, radio, range, color and file types retain native behavior and intrinsic size. |
| `Textarea` | Native multiline editing, selection, reset, rows and refs. Content/layout owns height; source editors retain monospace, whitespace and independent scrolling. |
| `Select` | One native select with options/optgroups, native values, forms and keyboard behavior. `density="compact"` gives a quiet 24px toolbar trigger. No mirrored selection state. |
| `MenuSurface`, `MenuItem`, `MenuCheckboxItem`, `MenuRadioItem`, `MenuLabel`, `MenuSeparator` | Shared command rows and fallback Arrow/Home/End/typeahead navigation. Owner key handlers run first. Checkbox and radio rows expose `aria-checked` without a nested control. Radio groups keep one selected value. Menu commands default to `type="button"`. |
| `Tooltip` | Descriptive, noninteractive help. Hover opens after 400ms; focus opens without another Tab stop. Portals use collision handling. Leaving the trigger closes pointer help. Help never intercepts command clicks. Escape closes help while preserving the original event for the native field and workflow owner. |
| `InfoTip` | An icon button with an explicit accessible label and descriptive content, for optional heading help. Prefer it to permanent explanatory paragraphs in compact sections. |
| `SearchField` | One controlled query and stable native input. Empty search may collapse; an active query stays visible. Opening focuses input. Escape clears/collapses and restores trigger focus; composing Escape stays with the input method. Blur outside collapses an empty query. |
| `SlidingTabs` | Labeled tablist, selected indicator, roving Tab stop, disabled tabs and Arrow/Home/End selection. The owner supplies tab/panel IDs and relationships. |
| `RailResizeHandle` | Focusable separator with orientation and current/min/max values. Pointer and keyboard resizing share bounds. Preserve drag cleanup and arrow/Shift/Home/End behavior. |
| `.ui-button-group` | Joined corners for adjacent related buttons, such as an action and menu trigger. Keep separate names, disabled states and menu ownership. |

Shared styles own hover, focus, pressed/expanded, disabled and invalid appearance. Native `disabled` and inherited disabled fieldsets remain authoritative. Link invalid fields to an explanation. Validation and recovery stay in the feature. Menus may deliberately keep `aria-disabled` commands focusable to explain a reason, but must prevent execution. An attribute alone is not a guard.

Use the common focus ring and visible outline. Do not add feature halos or suppress focus without a replacement. Icon-only controls need explicit names; decorative icons are hidden from assistive technology. Hidden controls must not remain tabbable.

## Picker, menus and help ownership

Supporting browsers use `appearance: base-select`: a themed top-layer picker, selected checkmark, scrolling and browser collision positioning. `data-description` supplies optional option explanations. Unsupported browsers retain an accessible native picker with explicit theme colors; identical rendering is not promised. Multiple and expanded selects retain native listbox behavior. Inspect the actual open picker when changing its CSS.

Menu owners retain anchoring, outside dismissal, workflow locking, initial focus and focus return. Escape closes the owned menu; Tab leaves according to the workflow. Keep explanations available without enabling invalid commands. Do not add a second independent open/selection state.

Button/field `title` props become shared help. Names identify controls; help describes them. Preserve existing description IDs. Provider/root/trigger structure stays stable as help and disabled state change, so edits, focus, refs, selection and chosen files survive.

Shared help has no links or actions. `pointer-events: none` and Radix's nonhoverable-content behavior keep it clear of commands. Rich illustrated CAD help remains `CadContextHelp`, with preview, pinning, dismissal and an interactive close control. Interactive content does not belong in a pointer-transparent tooltip.

Portal context menus use `--layer-context-menu`; shared tooltip portals use the higher `--layer-tooltip`. Keep that order so an open menu cannot obscure its own explanation. `MenuItem` places help to the side, with normal collision handling. `Button.tooltipSide` can select a side when a real layout needs it; ordinary controls retain the default. Help remains pointer-transparent; feature-specific tooltip layering is unnecessary.

## Layout and responsive patterns

- Headers group a sentence-case title, optional `InfoTip`, and real commands. Give the main task one clear primary action; utilities and metadata use secondary emphasis.
- Cards/panels use common edges, fills and radius. Group with spacing and thin dividers. Avoid making every value or status another card.
- Toolbars align compact controls. Narrow layouts wrap, stack or use an existing compact menu while preserving keyboard order and enabled commands. Joined actions use the shared group pattern.
- Fields keep associated labels, units and readable invalid explanations. Use shrinkable columns with `minmax(0, 1fr)` / `min-width: 0`. Disclosures hold secondary detail without hiding current values or required decisions.
- Multiline commands use content-driven height and a compact minimum. Diagnostics, source rows and filenames must not be squeezed into a single-line button height.
- Source containers own scrolling/resizing while fields retain selection, whitespace, spellcheck choices and code typography. Layout cleanup must not normalize or capitalize source input.
- Panels/popups stay within the viewport. Keep the main work area usable. Reuse drawer/floating-panel owners and let long technical content scroll independently.
- Empty/loading/failure states describe real conditions and available next actions. Keep disabled reasons and diagnostics readable. Do not add sample rows, fake counts or navigation-only action buttons.

Motion explains state changes without delaying work. Controls use theme timing; search uses expansion timing. Preserve reduced-motion overrides. Existing specialized transitions remain deliberate exceptions until their owning workflow changes.

## Workflow integrity

Preserve labels, form submission/reset, controlled/uncontrolled values, refs, file selection, selection ranges, focus, input methods and keyboard owners. Test meaningful user actions, such as cancelling a focused draft with open help, rather than removed tags or capitalization strings.

Eligibility, dirty/build/version checks, cancellation and persistence stay in shared application operations. Styling, menus and help must not accept drafts, change selection, bypass stale-build/export guards or write saved records. Human and agent commands retain the same operations and checks.

## Enforcement and review

`npm run ui:check` scans production TS/TSX and CSS. It rejects:

- Native button/input/textarea/select elements and factories, raw menu/tooltip roles, and native hover titles outside their shared owners.
- Forced-uppercase utilities in JSX, class helpers and control-prop objects, inline uppercase transforms, CSS uppercase declarations and `@apply` utilities.
- Literal palette colors in shared control CSS outside `theme.css`, including hex, named colors, color functions and literals in mixes/shadows.
- Feature CSS that paints reserved `.ui-*` selectors. Feature rules may place/size controls; palette, outline, opacity and interaction appearance belong to shared CSS.

Comments, source strings, semantic SVG titles, test fixtures, nonpaint layout math and feature geometry/status palettes are outside those bans. There is no per-feature exception list. Do not evade ownership through aliases, factories, generated elements or another local palette.

Guard fixtures cover architecture boundaries, not interface copy. Control tests cover native editing and meaningful keyboard/form behavior. Review still checks names, guards, status meaning and layout. Actual-browser acceptance inspects open pickers, help over adjacent commands, focus, disabled help, source editing and narrow/wide layouts. A static guard cannot establish those behaviors by itself.
