# Dashboard and design contract review

Bounded independent source review against `e62cb88` in `cad-shared-controls/Wire_EDM`. Scope includes the dashboard layout/project cards/start-work groups, shared SearchField and InfoTip, joined action styling, select chevron alignment, theme scales and source typography. No additional broad suite, build or browser operation was run by this reviewer.

## Source assessment

No actionable source regression found within this scope.

- Project filtering still combines search/source/sort over a derived array and preserves the catalog. The search input remains mounted; collapsed empty search leaves the Tab order and accessibility tree, while an active query stays expanded. Opening focuses input, Escape clears/collapses and restores trigger focus, and composing Escape is preserved. No extra query or catalog state was introduced.
- Dashboard actions retain the existing operation callbacks, native disabled conditions and file-input refs. The menu owner still controls initial focus, outside dismissal, Escape/Tab and lock-driven closure. Cards retain keyed project identity; new layout does not add a card-wide action that conflicts with rename/export/delete controls.
- InfoTip uses a named native command button and existing noninteractive shared help. The joined DXF group preserves two separate controls and its existing menu. Corners target first/last button types even while a menu div is mounted. The select alignment change applies only to the supported single-select enhancement; native fallback and listboxes remain available.
- Shrinkable text columns, wrapping controls/metadata and narrow-layout action placement are present. Shared type/height/color substitutions preserve source monospace and existing numeric dimensions. Search and card transitions retain reduced-motion behavior. These source checks do not prove final clipping, contrast or popup geometry on every viewport.

## Enforced contract

`docs/maintainers/ui-components.md` now defines the implemented component/state matrix, semantic palette, consumed type/spacing/density/radius/icon/motion scales, sentence case with acronym/source preservation, picker fallback, help/menu ownership, responsive patterns and workflow integrity. AGENTS links this contract and states ownership. Existing measured technical layouts are explicitly retained; the document does not claim all legacy layout is tokenized.

The existing UI guard gained three meaningful architecture fixtures, each observed red before implementation and green after: forced-uppercase styles; theme-only literal shared-control colors; and reserved `.ui-*` appearance ownership. Positive cases retain comments/source text, mask URL data, native SVG titles, nonpaint layout math and feature status/geometry colors. No per-feature exception list or interface-copy assertion was added.

Verification: all seven focused guard cases pass; `npm run ui:check` passes the actual production corpus; the guard's focused TypeScript check and owned-file whitespace check pass. The reviewer changed only the four authorized standards files plus this evidence record. Root owns the ongoing full unit/affected browser runs and actual dashboard visual acceptance; their results must be recorded separately.
