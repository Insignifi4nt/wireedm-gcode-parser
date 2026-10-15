# WebMCP-only plugin-library gear workflow

15 October 2026. Production app at `http://localhost:3778/wireedm-gcode-parser/`, checkpoint `6661035`, Node 24.22.0. This is a separate saved part; the user's earlier modeled tabs and histories are preserved.

## Result

The complete library-to-solid workflow succeeds using public WebMCP only. No application clicks, imported seed part, repository package, direct storage writes or private controller calls author the gear. The public library operations cover discovery, immutable package reading, instantiation and configuration. No API repair is needed for this journey.

| Setting | Accepted value |
| --- | --- |
| Module / teeth / pressure angle | 3 mm / 18 / 20° |
| Tooth root | Custom generating-rack cutter tip, 1 mm |
| Profile shift / thinning | Automatic, resolved 0 / 0 mm |
| Pitch / outside / root diameter | 54 / 60 / 46.5 mm |
| Bore / extrusion | 12 mm diameter / 10 mm, positive XY normal |
| Result | One native solid, no build diagnostics |
| Material volume | 21344.063921829482 mm³, exactly matching the earlier UI gear |

The complete 39-call journal is retained locally as `tmp/cad-webmcp-only-gear-journal.json`. The screenshot before the shared-control update is `tmp/cad-webmcp-only-gear-before-controls.png`. Browser observation and download-event handling do not replace application operations.

## Discovery and correlated edits

`cad_list_plugins` returns two real installed entries. The chosen `wireedm.spur-gear` v3.0.0 has package hash `3bdd2484ccc7cf1264280a520e8956335669e2f76b388ee8c10509b33f45c6e7`. `cad_read_plugin` reads all exact 4,096-character chunks with this identity/version/hash pinned until `nextOffset: null`. `cad_describe_features` supplies the actual Sketch and Extrude schemas.

A new document receives the empty XY sketch and `add-plugin-profile` in one atomic edit. The operation creates the `Spur gear` parameter group and separately scoped module, tooth-count, pressure-angle and backlash dimensions. Their actual generated names are discovered from the response and profile. The other editable inputs and complete embedded package remain intact when changing tooth roots.

The dynamic maximum cutter-tip radius at the selected settings is 1.139852523435553 mm. A deliberate 1.2 mm edit fails with `invalid-plugin-inputs` and the exact permitted interval; a fresh context confirms the draft version is unchanged. A valid 1 mm edit, circle bore with an explicit diameter constraint, and Extrude succeed together.

Changing only the accepted cutter-tip radius to 0.5 mm resolves a minimum shift of 0.08753668458967934, applied automatic shift of 0.08753669458967933 and outside diameter of 60.52522016753808 mm. One public Undo restores the complete baseline document JSON exactly, including its package, expressions, profile configuration, explicit bore dimension and extrusion. These checks exercise the existing shared relation rules rather than hard-coded agent calculations.

## Save and downloads

Saved document: `cad_a9e7ea79-9656-4989-915d-ceb014480682`, named `Module 3 gear - WebMCP`. Saved fingerprint: `b7633c6e8c318ee5126b092f57507d208e7426e21c03c58cd7e556fbdbd5ca8c`. The final context reports a clean saved draft with two features and the same valid solid.

Actual download events and public receipts confirm:

- `Module 3 gear - WebMCP.step`: 3,326,629 bytes.
- `Module 3 gear - WebMCP-section-XY.dxf`: 100,292 bytes, section at XY +5 mm, two closed contours and 830 analytic entities.
- `Module 3 gear - WebMCP.cad.json`: 8,434 bytes, complete editable parametric document.

Files are in the user's Downloads directory. `cad_set_viewport` fits the finished part in Isometric view; view changes do not alter its source or saved fingerprint.

The 18 public operations used are `cad_open_workspace`, `cad_get_context`, `cad_list_plugins`, `cad_describe_features`, `cad_read_plugin`, `cad_create_document`, `cad_edit_document`, `cad_inspect_plugin`, `cad_get_feature`, `cad_build`, `cad_read_document`, `cad_history`, `cad_save_document`, `cad_export_solid`, `cad_export_section_dxf`, `cad_export_document`, `cad_set_viewport` and `cad_get_viewport`.

## Updated shared-control browser check

The rebuilt app, `main-BZyAFsX3.js`, opens the exact saved part through WebMCP in a fresh tab. Its native volume, complete source JSON and saved fingerprint match the baseline exactly; the draft stays clean. The earlier WebMCP construction tab retains its complete Undo/Redo history. Source proof and UI receipts are retained in `tmp/cad-shared-select-browser-report.json`.

The view-angle selector and plugin Tooth root selector both render the shared `ui-select` with the same token colors. Every view option has an opaque background. Measured computed text contrast is 14.43:1 on the trigger and at least 12.76:1 on the four options. The real accessibility tree confirms the native menu expands; native keyboard input selects Top and the public viewport inspector confirms Top. A visible 2 px focus ring uses the shared ring token. The plugin editor shows Custom / 1 mm, with the same menu styling. Native popup chrome is browser/OS owned and is omitted from page screenshots; this check combines native expansion/selection with rendered CSS, without claiming cross-platform pixel equivalence.

All modeling and save/export actions remain public WebMCP calls. Human interaction here only inspects the dropdown and its contextual disclosure/help. It never configures or rebuilds the gear. After QA, public viewport commands finish sketch editing, clear selection and return the saved solid to Isometric. The final screenshot is `tmp/cad-shared-select-finished-gear.png`; the root editor screenshot is `tmp/cad-shared-select-gear-roots.png`.

The migration passes the full local gate: 391 files / 4,135 tests, production TypeScript/Vite, 92 documentation checks, pinned native corresponding sources, UI ownership and release compatibility. Independent source review finds no material issue. An alias-aware source comparison confirms the 24 migrated components differ only in shared Select imports/tags and control presentation; their surrounding handlers, options and labels are exact. The refreshed icon catalogue retains all 54 shared dropdown uses and its native template, including the machine-settings import alias; no duplicated browser-arrow location is lost by the component extraction.
