# broCAD/M logo verification

Final result: **passed**.

Scope: the user's selected third monochrome logo, its horizontal dashboard adaptation and matching b favicon. This report covers the brand integration in PR #49, not a pixel comparison of unrelated workspaces.

## References and captures

- Approved reference: [stacked master](docs/design/brand/brocadm/stacked-master.png), 1254 × 1254.
- Implementation source: [horizontal wordmark](src/assets/brocadm-wordmark.png), 2172 × 724; [favicon](src/assets/brocadm-favicon.png), 1254 × 1254.
- Prompts and provenance: [brand record](docs/design/brand/brocadm/README.md).
- Actual Chromium screenshots: `tmp/agent-feedback/empty-library-1440.png`, `empty-library-393.png`, `brocadm-logo-header-1440.png` and `brocadm-logo-header-393.png`.
- Joint comparison: `tmp/agent-feedback/brocadm-logo-comparison-full.png`, captured in the built-in browser from `tmp/brocadm-logo-comparison.html`. The approved master, horizontal source and both actual rendered headers were inspected together in this single view. Screenshots are local verification artifacts, not shipped application assets.

## Comparison method

Desktop viewport was 1440px wide and phone viewport 393px, at 1× screenshot density. Full-page screenshots and original header captures were also inspected at native size. The focused board displays the source and captures at 4× for stencil/counter inspection; enlarging an existing 1× capture softens its edges. Desktop header is 40px high, phone header 72px. The phone capture keeps its aspect ratio and uses a vertical crop to align the logo for comparison. An initial comparison-board stretch was corrected before the final review; the application screenshot was unaffected.

Intentional adaptations: the selected stacked logo becomes one horizontal line for the compact header; black ink reverses to white on the dark header. These are generated image variants, preserving the joined bro lettering and stencil CAD/M, rather than reconstructed font text. Original source pixels remain unchanged.

## Fidelity review

| Surface | Observed result |
| --- | --- |
| Lettering and geometry | Joined b/r, circular o and CAD/M stencil cuts retained. The failed distressed transparent variant is excluded. |
| Size, spacing and layout | 133 × 24px ink frame fits both headers with open counters and no clipping. Dashboard commands remain available. |
| Tone and contrast | Single white mark on the shared dark header, with no visible source-image rectangle. Black-on-white favicon and master retained. |
| Assets and rendering | Actual PNG wordmark used, not a font substitute. Desktop and phone native-size captures are readable. |
| Content and accessibility | Exact broCAD/M alternative text; failed-image fallback exposes the product name. CAD/CAM headers have no wordmark. |

No remaining blocking visual findings. The source assets are raster PNGs; a future vector master would improve arbitrary-size print delivery, but is not claimed as part of this change.

## Behavior checks

Seven focused app-entry tests and 27 Chromium journeys pass, including desktop/phone first-run import, dashboard-only branding through CAD/CAM navigation, failed artwork recovery, reduced motion and responsive editor layouts. Production build/native TypeScript, zero-finding lint, UI ownership checks and icon integration audit pass. No storage, post, revision or controller-output behavior changes.

Combined release verification also passes 138 focused tests and 12 Chromium journeys. The app retains the agent attachment dialog alongside the new dashboard; removing the welcome popup must not remove other application dialogs. The large-file journey checks dialog visibility before attaching its DXF and multi-megabyte UPID.
