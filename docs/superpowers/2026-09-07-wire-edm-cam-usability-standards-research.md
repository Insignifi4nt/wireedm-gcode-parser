# Wire EDM CAM usability standards research
Date: 2026-09-07
## Scope
Primary evidence comes from Autodesk, Hexagon ESPRIT, OPEN MIND OPTICAM, Camtek
PEPS, and Mastercam product documentation. CATIA's detailed pages are an
unverified documentation mirror; Dassault's [official documentation index](https://www.3ds.com/support/documentation)
confirms the user-guide source exists, but the guide content is access-controlled.
“Direct” means the linked source explicitly documents the feature; “inference”
means a recommended 2D workbench behavior derived from that evidence.
## Direct evidence and applicable standards
### Measurement and selection
- Autodesk [Fusion Measure](https://help.autodesk.com/view/fusion360/ENU/?contextId=DESIGN-INSPECT-MEASURE-CMD)
  documents distance, angle, area, radius, position, length, precision,
  secondary units, Clear Selection, result highlighting/copying, and `Show Snap
  Points`; Ctrl/Command locks a snap point and Shift hides it.
- Fusion [selection filters](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION-FILTERS.htm)
  distinguish bodies, edges, faces, vertices, sketches, profiles, and Select
  Through behavior.
- CATIA's mirrored [selection behavior](https://help-3dexperience.aesvietnam.com/English/D3reUserMap/review-c-MeasureAssemblies.htm)
  and [measurement criteria](https://help-3dexperience.aesvietnam.com/English/LdaUserMap/measure-c-Measure-CriteriaRefine.htm)
  document preselection, dynamic highlighting, invalid-filter warnings,
  Point/Edge/Surface modes, exact versus approximate calculation, and
  multiple/chain/fan measurement modes. Treat these as secondary corroboration,
  not verified Dassault-hosted evidence.
- **2D inference:** expose typed pick modes, hover endpoint/midpoint/center/
  nearest-point feedback, snap lock, immediate invalid-pick status, precision and
  unit readouts, XY delta/distance/angle/length/radius/area, and reset. “Magnetic”
  snapping is a UX recommendation; Fusion documents snap points and locking, not
  a required snap radius.
### Contour start, direction, and entry/exit
- Hexagon [ESPRIT Wire EDM](https://espritcam.hexagon.com/en-emea/product/wire-edm)
  lists initial thread location, profile start point, cut direction, entry/exit
  techniques, rough/skim strategies, automatic cut/rethread, and sequencing.
- Autodesk [FeatureCAM Wire Start](https://help.autodesk.com/cloudhelp/2018/ENU/FCAM/files/GUID-7E41F21D-688F-4B57-811A-22DE1F08125B.htm)
  supports picking the start point and curve segment, shows X/Y coordinates,
  offers perpendicular leads, and warns that the wrong side can gouge.
- Mastercam [Wire](https://www.mastercam.com/solutions/products/wire/) documents
  wire-motion, entry/exit, automatic leads, tabs, associativity, and verification;
  its [training outline](https://www.mastercam.com/support/product-training/courses/mastercam-wire/)
  covers contour chaining and custom leads.
- OPEN MIND [OPTICAM wire EDM](https://www.openmind-tech.com/en-gb/cam/wire-spark-erosion-edm/)
  documents straight/angled/arc/meander lead-on/off with overrun, start holes,
  tags, event points, and segmented cut/offset/lead settings.
- **2D inference:** show a contour arrow with direct reverse; keep start point,
  lead-in/out, overrun, side, and direction in one contextual panel; preview all
  markers and validate wrong-side or lead/part intersection. Keep start holes
  (pierce location) distinct from leads (approach/exit motion).
### Sequencing, threading, stops, and transitions
- ESPRIT documents roughing/skimming/cut-off classification, multi-feature
  sequencing, slug/tabs, automatic wire cutting/rethreading, and alternating cut
  direction to avoid returning to the start point.
- OPTICAM documents automatic/diagonal threading, wire cutting, positioning,
  reverse cutting, slug cut-off, events/segments, and start holes/tags.
- Camtek's [PEPS Wire EDM training PDF](https://www.camtek.de/assets/template/Medien/Dateien/PEPS/Schulungen/PEPS_Schulung_Wire_EDM.pdf)
  lists start-point editing, operation start, technology/wire selection, strategy,
  offsets, tags/bridges and removal, extra M codes, simulation, setup-sheet output,
  and start-hole-file creation. Camtek's [PEPS overview](https://www.camtek.de/en/peps/peps-overview.html)
  also cites feature recognition and unattended-run strategies.
- **2D inference:** store an ordered operation list with reorder and canvas
  numbers/arrows. Represent transition intent (stay threaded, cut/rethread,
  stop/pause, end); resolve NC/M codes only through the active machine package.
  Do not add inert stop buttons or invent controller syntax.
### Contextual panels and status
- Fusion's [operation parameter overview](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-OVERVIEW-PARAMETERS-OVERVIEW.htm)
  groups settings into Tool, Geometry, Heights, Passes, and Linking tabs. Its
  [interface guide](https://help.autodesk.com/cloudhelp/ENU/Fusion-GetStarted/files/GS-THE-FUSION-INTERFACE.htm)
  documents contextual tabs/environments and explicit exit; the [2D Profile guide](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-2D-PROFILE)
  shows geometry arrows before tabs/linking and generation.
- Fusion [CAM Task Manager](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TASK-MANAGER-OVERVIEW.htm)
  reports description, state, percentage, duration, pause/cancel; its [reference](https://help.autodesk.com/view/fusion360/ENU/?guid=GUID-D8C0E34D-1763-4287-89AD-D872207D2962)
  documents browser progress and preview updates during generation.
- **2D inference:** use one contextual panel with Geometry, Process, Transitions,
  Output, and Validate groups. Give each operation incomplete/valid/stale/
  generating/generated/warning/error state with a next action.
### Preview and validation
- OPTICAM documents collision-checked 3D removal simulation, offsets, machine
  heads/clamps, and cutting-time calculation. Mastercam documents wirepath
  verification and associative updates. PEPS training lists wireframe simulation,
  standard simulation, and separation test.
- **2D inference:** animate/scrub the ordered path, distinguish cut versus rapid,
  and show operation/pass/start/lead/rethread/stop markers. Before output check
  closure/continuity, open contours, self-intersections, zero-length segments,
  side/direction, lead intersection, order, and package transition support. Use a
  2D separation/topology check; do not claim 3D machine collision simulation.
## Priority for client-only 2D
P0: typed snapping/selection and measurement; contour start/direction/side and
lead preview; ordered operations and package-defined transitions; contextual
panels with lifecycle status; deterministic path preview and geometry/order/lead/
transition validation.
P1: repeated chain/fan measurements; rough/skim rows; package-defined tabs,
stops, start-hole/setup-sheet data; stale associative regeneration; estimated time
when package technology data exists.
Defer 4-axis synchronization, taper/land, rotary EDM, no-core pocketing, and full
machine simulation. They are real commercial features but exceed the client-only
2D contract and should not be added for parity.
