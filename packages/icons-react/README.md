# Wire EDM icons for React

134 original drawings on a 24-unit grid with 1.75-unit rounded strokes. Icons use `currentColor` and inherit the owning control's color. React is a peer dependency; the package has no runtime dependency besides React.

```tsx
import { PadIcon, AddIcon, Plus } from '@wire-edm/icons-react';
import { PadIcon as SinglePad } from '@wire-edm/icons-react/icons/pad';

<button type="button" aria-label="Add extrusion"><PadIcon size={16} /></button>
<AddIcon aria-label="Add" size={24} />
```

The root exports all semantic `*Icon` names and the existing legacy aliases, such as `Plus`, `Save` and `ArrowLeft`. Each individual entry exports its semantic name and aliases. Named modules contain only their own paths and a shared SVG renderer. ESM output, pure factory calls and `sideEffects: false` let bundlers retain only the drawings used.

Icons forward native SVG props and refs, including classes, CSS, events, width/height, stroke and strokeWidth. Defaults are size 24, a `0 0 24 24` viewBox, no fill, currentColor stroke and strokeWidth 1.75. Native SVG overrides remain available. `absoluteStrokeWidth` applies SVG non-scaling stroke to each path, including when size comes from CSS or a string unit.

Glyphs are decorative and unfocusable by default. Name the owning icon-only button. `aria-label` or `aria-labelledby` exposes a standalone icon with image semantics. Native children allow a caller-owned title/description with explicit IDs; the library creates no global IDs. Explicit native accessibility attributes remain available.

## Dynamic lookup and catalog

```tsx
import { WorkbenchIcon, makeIcon } from '@wire-edm/icons-react/dynamic';
import { iconCatalog } from '@wire-edm/icons-react/catalog';
import type { IconName, IconCategory, WorkbenchIconProps } from '@wire-edm/icons-react';

<WorkbenchIcon name="pad" size={16} />
```

Dynamic lookup and catalog access load the full catalog. They are separate from the named root entry. Existing app compatibility modules can explicitly re-export this subpath for their old `WorkbenchIcon` / `iconCatalog` entry point. There are no app aliases or repository paths in the distributed JavaScript or declarations.

## Build and verification

From the repository root:

```sh
npm --prefix packages/icons-react run generate
npm --prefix packages/icons-react run check:generated
npm --prefix packages/icons-react run build
npm --prefix packages/icons-react test
npm --prefix packages/icons-react run check:package
npm pack ./packages/icons-react
```

The root application's `prepare` and `prebuild` hooks call `npm run icons:build`. The root `icons:generate` command coordinates package generation with the app's SVG/catalog assets; `icons:check` combines package verification with the app's asset/integration guards. The prefix commands above remain available for this package alone.

`scripts/icon-source.mjs` remains the editable geometry source shared with the app assets. The package generator creates independent modules, root exports and the optional catalog. `check:generated` fails on missing, changed or obsolete generated source. Build checks generated source without rewriting it, then cleans only this package's dist directory before emitting ESM and declarations. This keeps root prepare/prebuild hooks from masking stale committed output. Run `generate` after changing the drawing source. `prepack` builds automatically. The published package contains dist, this README and its license; using it requires no generator or checkout.

Two runtime checks cover native SVG/ref/stroke behavior and decorative/named/dynamic accessibility. The package check packs and installs the actual tarball offline into an isolated consumer, provides React as a peer, resolves root/individual/dynamic/catalog exports, type-checks its declarations, and bundles one named import. It verifies that only that drawing and the shared renderer remain, without the dynamic catalog.
