# CAD iteration 3 review coverage

63 CAD/geometry/view catalog IDs reviewed, plus 1 related view icon outside those categories. This is a semantic review of source paths; it does not modify catalog assets.

| ID | Disposition | Review note |
| --- | --- | --- |
| `body` | retain | Reference isometric solid; source primitive remains unchanged. |
| `imported-body` | compare | Compare closed body with central import arrow and external arrow badge. |
| `datum-plane` | compare | Align the plane to the body’s exact projection; omit free-floating support strokes. |
| `pad` | retain | Current closed orthographic extrusion profile and upward arrow read clearly. |
| `pocket` | retain | Current closed orthographic cut profile and downward arrow read clearly. |
| `pad-pocket` | compare | Current is too close to pad; compare one stepped profile with +/- cues. |
| `fillet` | retain | Rounded corner treatment remains distinct from chamfer. |
| `chamfer` | retain | Beveled corner treatment remains distinct from fillet. |
| `shell` | retain | Reject v2: its full top bar closes the opening and reads as a double square. |
| `revolve` | compare | Compare closed profile plus axis/circular motion against an explicit turned result. |
| `loft` | compare | Compare current and v2 against closed section loops plus generators. |
| `sweep` | compare | Compare operation inputs against a closed curved-tube result with visible section. |
| `boolean` | retain | Reject v2 decorative ticks; current overlap cue is sufficiently direct. |
| `boolean-union` | retain | Current union silhouette is distinct. |
| `boolean-subtract` | retain | Current subtraction silhouette is distinct. |
| `boolean-intersect` | retain | Current intersection silhouette is distinct. |
| `linear-pattern` | retain | Current instances and direction baseline already use closed box paths. |
| `circular-pattern` | retain | Current radial instances and rotation cue are recognizable. |
| `pattern` | retain | Current generic pattern command remains distinct from linear/circular modes. |
| `mirror` | retain | Current instance contours are already explicitly closed. |
| `select` | retain | Generic selection cursor remains unchanged. |
| `select-face` | compare | Keep isolated target; align its projection and pointer with select-body. |
| `select-edge` | compare | Keep isolated target; align edge slope and pointer with select-body. |
| `select-body` | retain | Reference object-plus-pointer modifier. |
| `sketch` | retain | Current sketch axes and closed profile remain recognizable. |
| `curve` | retain | Current reference curve remains distinct from a polyline. |
| `circle` | retain | Current circle profile is clear. |
| `circle-center` | retain | Current center marker adds the required distinction. |
| `rectangle` | retain | Current rectangle profile is clear. |
| `slot` | retain | Current closed slot outline is clear. |
| `polyline` | retain | Open connected segments and vertices are intentional. |
| `closed-path` | retain | Current closed contour is distinct from polyline. |
| `arc` | retain | Open arc and three-point markers are intentional. |
| `line` | retain | Current endpoint-marked line is clear. |
| `construction` | retain | Current construction strokes use intentional separated dashes. |
| `measure` | retain | Current dimension ticks are intentional. |
| `origin` | retain | Current crosshair origin is clear. |
| `move` | retain | Current planar transform arrows remain distinct. |
| `move-3d` | retain | Current three-axis transform cue remains recognizable. |
| `rotate-clockwise` | retain | Current clockwise direction arc is clear. |
| `rotate-counterclockwise` | retain | Current counterclockwise direction arc is clear. |
| `flip-horizontal` | retain | Current mirrored shapes and axis remain clear. |
| `flip-vertical` | retain | Current mirrored shapes and axis remain clear. |
| `snap` | retain | Current magnet metaphor is distinct from geometry selection. |
| `turn` | retain | Current corner-direction cue remains distinct from camera rotation. |
| `trim` | retain | Current scissors metaphor is appropriate for trim. |
| `link` | retain | Current linked-expression chain symbol remains clear. |
| `plugin` | retain | Current parametric plugin puzzle-piece metaphor remains clear. |
| `fit-view` | retain | Current viewport-corner glyph remains clear. |
| `zoom-in` | retain | Current magnifier-plus glyph remains clear. |
| `zoom-out` | retain | Current magnifier-minus glyph remains clear. |
| `grid` | retain | Current construction grid is clear. |
| `view` | retain | Current orientation cube uses an orthographic view cue. |
| `view-top` | retain | Current top-view square remains distinct from generic orientation. |
| `camera-orbit` | retain | Current orbit arrows remain distinct from pan. |
| `camera-pan` | retain | Current hand/pan metaphor remains recognizable. |
| `camera-capture` | retain | Current camera capture glyph remains clear. |
| `visible` | retain | Current visibility eye is clear. |
| `hidden` | retain | Current crossed visibility eye is clear. |
| `scan` | retain | Current bounds scan brackets remain clear. |
| `section-view` | retain | Current viewport section cue is separate from the CAM section command. |
| `layers` | retain | Current stacked-layer symbol remains clear. |
| `navigation-mouse` | retain | Current mouse navigation shape is clear. |
| `navigation-trackpad` | retain | Current trackpad navigation shape is clear. |
