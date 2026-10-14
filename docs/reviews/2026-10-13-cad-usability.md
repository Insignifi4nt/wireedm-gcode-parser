# CAD usability checkpoint, 13 October 2026

The CAD worktree now has a stable canvas, one ordered feature/dependency tree, grouped document parameters, dimensions beside selected sketch geometry, contextual explanations and standalone DXF export. This checkpoint improves the existing modelling workflow without introducing new modelling feature kinds.

## Design references

[Onshape's feature list](https://cad.onshape.com/help/Content/PartStudio/features_and_parts_lists.htm) combines feature order and model history and describes cross-highlighting between geometry and associated features. Its [dimension documentation](https://cad.onshape.com/help/Content/Sketch/dimension.htm) describes editing placed dimension values directly. Those patterns informed our unified tree and on-part dimension controls. We have not implemented Onshape's constraint solver or rollback bar.

Dassault's official [CATIA R2018x Part Design announcement](https://blog.3ds.com/brands/catia/3dexperience-catia-r2018x-part-design-enhancements/) describes a contextual toolbar for easier access to common features. This is a dated design reference, not evidence of every current 3DEXPERIENCE screen. Our choice is to keep configuration near the work while leaving detailed schemas and package inspection available through agent tools.

## Observed flow

### 1. Select the part and inspect its history: healthy

The left list is the ordered feature history. Sequence numbers, functional disclosures, nested sketch profiles and real Inputs/Used by links replace the duplicated bottom timeline. Selection and inspector minimization leave canvas columns unchanged. Every inspector floats, including ordinary feature and topology configuration. The bottom status strip is removed; errors remain marked in the tree and reported through toasts/notifications. Geometry-kernel licenses remain accessible in File.

Selecting a circle, rectangle, slot or supported Spur gear shows compact dimension controls beside it. The original gear remains module 3 with 18 teeth, a 12 mm bore and symmetric 10 mm thickness.

![Original gear with direct tooth-count editing](C:/Users/cristian/code/Wire_EDM/tmp/cad-ux-08-on-part-dimension-final.png)

### 2. Inspect and edit document parameters: healthy

The parameter form opens beside the tree instead of consuming its bottom section. Rows show active uses, unused values and dormant automatic inputs. This makes the original document's unused `module = 4` distinguishable from its profile-local `module = 3` override. Local-input selection navigates to the correct profile and highlights the corresponding geometry.

Groups can be created, renamed and removed without deleting values. New plugin profiles atomically create isolated driver names and a named group with plugin-origin icons. They never reuse unrelated values merely because names match. Renaming parameters rewrites actual scalar expression tokens while preserving embedded package definitions and scientific literals. Origin is historical creation provenance and can outlive the original feature.

![Floating parameter editor](C:/Users/cristian/code/Wire_EDM/tmp/cad-ux-06-parameter-editor-final.png)

The browser verification temporarily added a second sketch/plugin through the shared atomic API. Its group and `p_spur_gear_*` drivers were visible and matched `cad_inspect_parameters`; the existing `module = 4` remained unchanged. The temporary addition was undone and removed from redo history before handoff.

![Automatic plugin group and current-geometry help](C:/Users/cristian/code/Wire_EDM/tmp/cad-ux-07-correlated-groups-help.png)

### 3. Configure dimensions and understand gear roots: healthy

Plugin fields show numerical values first. Exact named bindings update their parameter drafts; compound expressions remain read-only until explicitly edited through fx. Apply commits related values and geometry as one undo step. Valid pending values preview in the sketch without changing the accepted document. Invalid values remain available for correction. Unfinished relation text, direct dimension edits and parameter editors block conflicting human/agent operations.

Info controls support hover, keyboard focus, click pinning, Escape and outside dismissal. Gear illustrations use the current domain geometry. Selecting a field highlights pitch/base/root circles or actual tooth/root segments. X, Y and rotation share one compact row. Derived dimensions remain read-only. Conditional editing locks are distinguished from automatic replacement of dormant settings.

Rack-tip-radius help explains that the rounded generating tool creates a trochoidal root with varying curvature. It exposes the current radius and its dependence on module, pressure angle, clearance and available tip width. The root is not independently adjustable as an arbitrary gear-corner radius. Generated root and involute chords retain their declared tolerance; exact circle arcs remain exact. These are nominal geometries, not strength or mating-clearance certification.

![Actual generated root and contextual explanation](C:/Users/cristian/code/Wire_EDM/tmp/cad-ux-09-generated-root-help.png)

Profile bounds are memoized independently of viewport position, so positioning dimension controls during pan/zoom reuses resolved geometry. Native topology limits remain intact; previous root-sampling improvements preserve the requested tolerance rather than silently coarsening a gear.

### 4. Export document geometry independently: healthy

File > Export DXF opens a separate workflow. No DXF download remains inside sketch or curve properties. Sources are a chosen sketch, an open reference curve or a current solid section. The section asks for a body, plane and normal offset, starts at the body's middle height and requires a real preview. A body arriving after a same-version rebuild becomes selectable.

The guarded export operation recomputes the exact section and validates cancellation, draft version and workflow ownership before downloading. It neither saves CAD nor creates CAM. Native modal help stays inside the dialog. Projection of an arbitrary solid silhouette remains unsupported and is explained in contextual help rather than exposed as an inert control.

![Standalone exact section export](C:/Users/cristian/code/Wire_EDM/tmp/cad-ux-05-standalone-dxf-export.png)

The original gear's XY section at offset 0 produced two closed contours and 1,154 entities. Its real downloaded file parsed as millimetres with 1,116 lines and 38 circular arcs. Native circular sections may be represented by multiple exact arcs. The CAD version, unsaved state and saved receipt did not change during export.

## Follow-up: profile selection, curve accuracy and configurable roots

The reported black/white rounded rectangle was Chromium's native focus outline on a pointer-focused SVG group. The outline was measured in drawing coordinates. Profile focus now suppresses that native outline in both pointer and keyboard states. Pointer down prevents native descendant focus and focuses the canvas; keyboard activation remains available with contour feedback. Actual browser clicks on the gear boundary leave the canvas focused and the gear selected, with no oversized bounding box.

Closed plugin/path profiles now render as one continuous SVG path. Every source line endpoint and signed circular arc is retained. This removes segment seams and gives the selected contour a proper fill; it does not convert the model to splines or change CAM/export geometry.

![Original gear after pointer selection, with root configuration entry](C:/Users/cristian/code/Wire_EDM/tmp/cad-gear-profile-selection-fixed.png)

Spur gear v3 introduces **Tooth root → Automatic / Custom → Cutter tip radius**. Existing v2 parts expose **Configure tooth root**, which prepares a pending upgrade. Apply accepts it; Cancel leaves the original package, linked inputs and parameters intact. The root is the envelope of the nominal rounded generating rack tool and has varying curvature. The input controls the tool radius, rather than adding a separate circular fillet. This distinction is supported by the [authored AGMA gear-root study](https://gearsolutions.com/features/effects-of-asymmetric-cutter-tip-radii-on-gear-tooth-root-bending-stress/). Limits are specific to this full-depth rack model, including positive tip land and an app regularity lower bound; the UI does not present them as a universal manufacturing standard.

At module 3, 18 teeth and 20° pressure angle, the automatic tool tip radius is 1.139853 mm. A 0.5 mm custom-radius preview updates automatic shift to 0.087537 and outside diameter to 60.52522 mm. An attempted 2 mm radius is rejected against the current 0.003–1.139853 mm range and disables Apply. The preview diagram and root highlight use the actual configured geometry. Both browser experiments were canceled; recursive comparison of the restored draft found no field differences, and its saved receipt was unchanged.

![Verified custom-radius preview and current-geometry explanation, canceled before handoff](C:/Users/cristian/code/Wire_EDM/tmp/cad-gear-root-custom-final.png)

**Curve accuracy** now has its own disclosure explaining maximum geometric deviation in millimetres. These remain real chord edges in sketches, native solids, STEP and DXF. Other representations such as [tolerance-bounded B-splines](https://dev.opencascade.org/doc/occt-7.5.0/refman/html/_geom_convert___approx_curve_8hxx.html) can reduce topology, but are not claimed here. V3 uses a proved normal-deviation certificate for the involute and tighter interval bounds for the root. At 0.005 mm accuracy, module 3 / 18 teeth uses 864 edges instead of v2's 1,152; 50 teeth uses 1,900 instead of 2,400. V1/v2 package definitions and their sampling remain pinned unchanged.

Independent review also found and fixed a v3 preflight using the older sampler's budget. Module 1 / 36 teeth at 0.00005 mm accuracy now accepts its actual 6,984-edge boundary, while existing versions retain their previous budget behavior. V3 manual shift limits now admit the same valid shift as Automatic for 12 teeth at 14.5° with a 1 mm tool radius, while enforcing root clearance and tip thickness. Native tests check custom-root volume and section contours, plus topology-budget rejection.

## Verification and limits

- Final complete Vitest run after the gear follow-up: **310 files, 3,312 tests passed**, including pure-domain and browser suites.
- Production TypeScript/Vite build, documentation/schema parity, corresponding-source distributions and release checklist pass. Existing bundler chunk-size and externalization notices remain.
- Independent review checked modal/portal isolation, cancellation, stale section results, previews, parameter provenance and cache/folder integrity. Fixes include group-only dirty-draft protection, deferred body selection and keyboard opening of Plugins closing competing expression portals.
- Actual Codex browser verification covered integer validation, unfinished-expression guards, stable layout, automatic groups, field/geometry correlation, contextual root help and a downloaded section DXF. The complete original draft was preserved locally before refresh and compared recursively after restoration; no data-field differences remain. Saved documents were not overwritten.
- Screenshots show desktop layout and visible interaction. Keyboard focus, Escape and workflow behavior also have DOM/browser tests; this is not a complete accessibility or touch-device audit.
- All work is in the existing CAD worktree. It is locally reviewable and running; no merge or deployment is claimed. Installed post/machine packages, saved CAM revisions, controller output and their schema/API versions remain unchanged. Optional CAD grouping/provenance fields require current CAD readers; old strict previews may reject those fields. No automatic migration or pinned-package rewrite occurs.

Original draft backup: `C:/Users/cristian/code/Wire_EDM/tmp/cad-ux-original-draft.json`. The accepted screenshot files above were captured from the running browser and inspected locally. Earlier screenshots missing an intended popup were rejected for that state and replaced with the final captures.
