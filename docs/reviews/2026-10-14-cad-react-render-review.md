# React render and help review

Scope: the reviewed display/interaction diff after `8375c29`. The full CAD goal remains active.

The React performance checklist finds no actionable issue in this patch. Expensive immutable profile resolution is memoized in a top-level component. Pan/Fit changes relative placement without regenerating its exact entities. Geometry and parameter identities invalidate the cache; neither saved values nor evaluator results are rounded. Internal functions returning SVG content are ordinary calculations, not nested React component types that remount on updates.

View ownership is a scoped context through the existing portals. Hidden controls stay mounted, but their help cannot open or retain a body portal. Listener/timer effects run only while help is shown and release on close/unmount. Canvas and configuration help remain independent. No dependency or generic listener framework is introduced for these contextual disclosures.

Accessible selection labels, keyboard operations, pending inputs and exact world-coordinate interaction remain intact. The owner and independent numerical/lifecycle records contain source hashes and red/green tests. Complete focused gates pass 174 rendering/interaction cases and 115 dock/workbench cases; these scopes overlap and are not summed. The actual browser proves visible far-origin geometry, a complete matching PNG receipt, retained frame after an edit and exact Fit translation with identical overlays. Full current GitHub execution is the remaining gate.
