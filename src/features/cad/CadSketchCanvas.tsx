import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Grid2X2, Magnet, Maximize2, Undo2, X } from 'lucide-react';
import type { CadCurveFeature, CadPathSegment, CadProfile, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { resolveCadCurve } from '@/domain/cad/cadCurve';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadAnalyticPathMetrics, cadProfileToEntities, resolveCadProfile } from '@/domain/cad/cadSketchGeometry';
import type { DxfEntity } from '@/domain/dxf/types';
import { captureSvgPreview } from '@/features/editor/captureEditorPreview';
import { ToolError } from '@/features/webmcp/siteTools';
import type { CadRenderedViewControls, CadRenderedViewState } from './cadViewportControls';
import { closeSketchPolygon, snapSketchPathPoint, snapSketchPoint, twoPointSketchProfile, type SketchPoint, type SketchTool } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { createCadSketchProfilePicker } from './cadSketchPicking';
import { cadPathDraftEndpoint, closeCadPathDraft, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, updateCadPathDraft, type CadPathDrawingAction } from './cadPathDrawing';
import { CadPathDraftGeometry, CadPathSegmentGeometry } from './CadPathDraftGeometry';

function AnalyticEntity({ entity }: { entity: DxfEntity }) {
  switch (entity.type) {
    case 'line': return <line x1={entity.start.x} y1={entity.start.y} x2={entity.end.x} y2={entity.end.y} />;
    case 'circle': return <circle cx={entity.center.x} cy={entity.center.y} r={entity.radius} />;
    case 'arc': return <path d={cadArcSvgPath(entity)} />;
    case 'polyline':
    case 'lwpolyline': throw new Error('CAD path previews require analytic line, arc or circle entities.');
    default: { const exhaustive: never = entity; throw exhaustive; }
  }
}

function ProfileGeometry({ geometry, parameters }: { geometry: CadProfile; parameters: Readonly<Record<string, number>> }) {
  const value = (scalar: number | string) => evaluateCadScalar(scalar, parameters);
  switch (geometry.kind) {
    case 'rectangle': return <rect x={value(geometry.x)} y={value(geometry.y)} width={value(geometry.width)} height={value(geometry.height)} rx={value(geometry.cornerRadius)} />;
    case 'circle': return <circle cx={value(geometry.x)} cy={value(geometry.y)} r={value(geometry.radius)} />;
    case 'polygon': return <polygon points={geometry.points.map(([x, y]) => `${value(x)},${value(y)}`).join(' ')} />;
    case 'path': return <g>{cadProfileToEntities(resolveCadProfile(geometry, parameters)).map((entity, index) => <AnalyticEntity key={index} entity={entity} />)}</g>;
    case 'slot': {
      const x = value(geometry.x), y = value(geometry.y), length = value(geometry.length), width = value(geometry.width);
      return <rect x={x - length / 2} y={y - width / 2} width={length} height={width} rx={width / 2} transform={`rotate(${value(geometry.angle)} ${x} ${y})`} />;
    }
  }
}

const SafeProfile = memo(function SafeProfile({ profile, parameters }: { profile: CadSketchProfile; parameters: Readonly<Record<string, number>> }) {
  try { return ProfileGeometry({ geometry: profile.geometry, parameters }); }
  catch { return null; }
});

const NO_PROFILES: readonly CadSketchProfile[] = Object.freeze([]);

export function CadSketchCanvas({ sketch, parameters, tool, selectedProfileId, onSelectProfile, onAddProfile, onAddCurve, onCancelCurve, curveCreation = false, onPendingChange, onError, cancelSignal, interactionLocked = false, onControlsReady, viewLocked = false }: {
  sketch: CadSketchFeature | CadCurveFeature;
  parameters: Readonly<Record<string, number>>;
  tool: SketchTool;
  selectedProfileId: string | null;
  onSelectProfile(id: string | null): void;
  onAddProfile(geometry: CadProfile): void;
  onAddCurve?(segments: readonly CadPathSegment[]): void;
  onCancelCurve?(): void;
  curveCreation?: boolean;
  onPendingChange(pending: boolean): void;
  onError(message: string): void;
  cancelSignal: number;
  interactionLocked?: boolean;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
  viewLocked?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const [points, setPoints] = useState<readonly SketchPoint[]>([]);
  const [pathDraft, setPathDraft] = useState(createCadPathDraft);
  const [cursor, setCursor] = useState<SketchPoint>([0, 0]);
  const [center, setCenter] = useState<SketchPoint>([0, 0]);
  const [span, setSpan] = useState(160);
  const [aspect, setAspect] = useState(1.3);
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(true);
  const [gridStep, setGridStep] = useState(5);
  const pan = useRef<{ x: number; y: number; center: SketchPoint; pointerId: number; buttonMask: number; element: SVGSVGElement } | null>(null);
  const finishPan = useCallback((pointerId?: number) => {
    const active = pan.current;
    if (!active || pointerId !== undefined && pointerId !== active.pointerId) return;
    pan.current = null;
    try { if (active.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId); }
    catch { /* Capture may already have ended when the browser cancelled the pointer. */ }
  }, []);
  useEffect(() => {
    const blurred = () => finishPan();
    window.addEventListener('blur', blurred);
    return () => { window.removeEventListener('blur', blurred); finishPan(); };
  }, [finishPan]);
  const profiles = sketch.kind === 'sketch' ? sketch.profiles : NO_PROFILES;
  const savedCurve = useMemo(() => {
    if (sketch.kind !== 'curve' || !sketch.segments.length) return null;
    try { return resolveCadCurve(sketch, parameters); } catch { return null; }
  }, [sketch, parameters]);
  const profilePicker = useMemo(() => createCadSketchProfilePicker(profiles, parameters), [profiles, parameters]);
  const width = span * aspect;
  const viewRevision = useRef({ signature: '', revision: 0 });
  const viewSignature = JSON.stringify([sketch.plane, center, span, aspect, grid, snap, gridStep]);
  if (viewRevision.current.signature !== viewSignature) { viewRevision.current = { signature: viewSignature, revision: viewRevision.current.revision + 1 }; }
  const currentView = useRef<CadRenderedViewState>({ mode: sketch.kind, available: false, plane: sketch.plane, gridVisible: grid, snapEnabled: snap, gridStepMm: gridStep, centerMm: center, heightSpanMm: span, revision: viewRevision.current.revision });
  currentView.current = Object.freeze({ mode: sketch.kind, available: Boolean(svg.current), plane: sketch.plane, gridVisible: grid, snapEnabled: snap, gridStepMm: gridStep, centerMm: Object.freeze([...center] satisfies [number, number]), heightSpanMm: span, revision: viewRevision.current.revision });
  const fitView = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const container = host.current;
    if (!container) return;
    const measure = () => { if (container.clientWidth && container.clientHeight) setAspect(container.clientWidth / container.clientHeight); };
    // Commit the actual aspect before another task can see capture availability.
    // ResizeObserver's first asynchronous delivery then repeats this measurement.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const controls: CadRenderedViewControls = {
      getState: () => Object.freeze({ ...currentView.current, available: Boolean(svg.current) }),
      fit: () => fitView.current?.(),
      setGrid: setGrid,
      async capture(signal) {
        signal.throwIfAborted();
        const element = svg.current;
        if (!element) throw new ToolError('CAPTURE_UNAVAILABLE', 'Open a visible sketch first.');
        const revision = currentView.current.revision;
        const image = await captureSvgPreview(element, signal);
        signal.throwIfAborted();
        if (svg.current !== element || currentView.current.revision !== revision) throw new ToolError('STALE_VIEW', 'The sketch view changed during capture. Capture the current view again.');
        return image;
      },
    };
    onControlsReady?.(controls);
    return () => onControlsReady?.(null, controls);
  }, [onControlsReady]);
  useEffect(() => { setPoints([]); setPathDraft(createCadPathDraft()); }, [sketch.id, tool, cancelSignal]);
  const pathPending = tool === 'path' && pathDraft.kind !== 'idle';
  useLayoutEffect(() => { onPendingChange(points.length > 0 || pathPending); }, [points.length, pathPending, onPendingChange]);
  const getRawPoint = (event: { clientX: number; clientY: number }): SketchPoint | null => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [center[0] + (event.clientX - rect.left - rect.width / 2) / rect.width * width, center[1] - (event.clientY - rect.top - rect.height / 2) / rect.height * span];
  };
  const snapPoint = (point: SketchPoint): SketchPoint => tool === 'path'
    ? snapSketchPathPoint(point, pathDraft.kind === 'idle' ? null : pathDraft.start, span / (svg.current?.getBoundingClientRect().height || Infinity), gridStep, snap)
    : snapSketchPoint(point, gridStep, snap);
  const getPoint = (event: { clientX: number; clientY: number }): SketchPoint => snapPoint(getRawPoint(event) ?? [0, 0]);
  const changePath = (action: CadPathDrawingAction, focus = false) => {
    if (interactionLocked) return;
    try { setPathDraft(updateCadPathDraft(pathDraft, action)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this path.'); }
    if (action.kind === 'cancel' && curveCreation) onCancelCurve?.();
    if (focus) svg.current?.focus();
  };
  const closePath = () => {
    if (interactionLocked) return;
    try {
      if (sketch.kind === 'curve') {
        if (!onAddCurve || !curveCreation) throw new Error('Edit the existing curve dimensions in Properties.');
        onAddCurve(finishCadCurveDraft(pathDraft));
      } else onAddProfile(closeCadPathDraft(pathDraft));
      setPathDraft(updateCadPathDraft(pathDraft, { kind: 'cancel' }));
    }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to close this path.'); }
    svg.current?.focus();
  };
  const add = (geometry: CadProfile) => {
    try { onAddProfile(geometry); setPoints([]); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to add this profile.'); }
  };
  const close = () => {
    try { add(closeSketchPolygon(points)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to close this profile.'); }
  };
  const fit = () => {
    const coordinates: SketchPoint[] = [];
    if (savedCurve) coordinates.push([savedCurve.bounds.minX, savedCurve.bounds.minY], [savedCurve.bounds.maxX, savedCurve.bounds.maxY]);
    for (const profile of profiles) {
      try {
        const geometry = resolveCadProfile(profile.geometry, parameters);
        switch (geometry.kind) {
          case 'rectangle': coordinates.push([geometry.x, geometry.y], [geometry.x + geometry.width, geometry.y + geometry.height]); break;
          case 'circle': coordinates.push([geometry.x - geometry.radius, geometry.y - geometry.radius], [geometry.x + geometry.radius, geometry.y + geometry.radius]); break;
          case 'polygon': coordinates.push(...geometry.points); break;
          case 'path': {
            const bounds = cadAnalyticPathMetrics(geometry).bounds;
            coordinates.push([bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]); break;
          }
          case 'slot': {
            const angle = geometry.angle * Math.PI / 180;
            for (const [x, y] of [[-geometry.length / 2, -geometry.width / 2], [geometry.length / 2, geometry.width / 2], [-geometry.length / 2, geometry.width / 2], [geometry.length / 2, -geometry.width / 2]]) coordinates.push([geometry.x + x * Math.cos(angle) - y * Math.sin(angle), geometry.y + x * Math.sin(angle) + y * Math.cos(angle)]);
            break;
          }
        }
      } catch { /* Invalid profiles retain their diagnostic in the property editor. */ }
    }
    if (!coordinates.length) { setCenter([0, 0]); setSpan(160); return; }
    const xs = coordinates.map((point) => point[0]), ys = coordinates.map((point) => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    setCenter([(minX + maxX) / 2, (minY + maxY) / 2]);
    setSpan(Math.max(20, maxY - minY, (maxX - minX) / aspect) * 1.25);
  };
  fitView.current = fit;
  useLayoutEffect(() => { if (sketch.kind === 'curve' && !curveCreation) fitView.current?.(); }, [sketch.id, sketch.kind, curveCreation]);
  const pathPreview = useMemo(() => tool === 'path' ? previewCadPathDraft(pathDraft, cursor) : { kind: 'none' as const }, [tool, pathDraft, cursor]);
  const pathMode = pathDraft.kind === 'arc-through' ? 'arc' : pathDraft.mode;
  const pathEnd = pathDraft.kind === 'idle' ? null : cadPathDraftEndpoint(pathDraft);
  const pathNeedsClosingLine = pathDraft.kind === 'ready' && pathDraft.segments.length > 0 && pathEnd !== null
    && (pathEnd[0] !== pathDraft.start[0] || pathEnd[1] !== pathDraft.start[1]);
  const instruction = tool === 'path' ? pathDraft.kind === 'idle' ? sketch.kind === 'curve' ? 'Click the curve start.' : 'Click the path start.' : pathDraft.kind === 'arc-through' ? pathPreview.kind === 'invalid' ? pathPreview.message : 'Click a point on the arc.' : pathMode === 'arc' ? 'Click the arc endpoint.' : sketch.kind === 'curve' ? 'Click the next endpoint; Finish curve to save.' : 'Click the next endpoint; Close profile to finish.' : tool === 'select' ? sketch.kind === 'curve' ? 'Edit curve dimensions in Properties.' : 'Select a profile to edit dimensions' : tool === 'polygon' ? points.length ? 'Click vertices. Click the first point or Close profile to finish.' : 'Click the first vertex of a closed profile' : points.length ? tool === 'circle' ? 'Click to set the radius' : tool === 'slot' ? 'Click an axis endpoint. Edit the slot width in Properties.' : 'Click the opposite corner' : tool === 'circle' ? 'Click the circle center' : tool === 'slot' ? 'Click the slot center' : 'Click the first corner';
  let preview: CadProfile | null = null;
  const first = points[0];
  if (first && (tool === 'rectangle' || tool === 'circle' || tool === 'slot')) {
    try { preview = twoPointSketchProfile(tool, first, cursor); } catch { /* The preview starts at zero size. */ }
  }
  const placePoint = (point: SketchPoint) => {
    if (interactionLocked) return;
    if (tool === 'select') { onSelectProfile(null); return; }
    if (tool === 'path') { changePath({ kind: 'point', point }); return; }
    if (tool === 'polygon') {
      if (first && points.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) < span * 0.018) { close(); return; }
      if (!points.some(([x, y]) => x === point[0] && y === point[1])) setPoints([...points, point]);
    } else if (first) {
      try { add(twoPointSketchProfile(tool, first, point)); }
      catch (error) { onError(error instanceof Error ? error.message : 'Unable to draw this profile.'); }
    } else setPoints([point]);
  };
  return <div className={`cad-sketch-viewport ${sketch.kind === 'curve' ? 'cad-curve-viewport' : ''}`} ref={host}>
    <svg ref={svg} className={`cad-sketch-canvas ${tool !== 'select' ? 'is-drawing' : ''}`} role="application" tabIndex={interactionLocked ? -1 : 0} aria-label={sketch.kind === 'curve' ? 'Curve drawing canvas' : 'Sketch drawing canvas'} aria-describedby={instructionsId} viewBox={`${center[0] - width / 2} ${-center[1] - span / 2} ${width} ${span}`} preserveAspectRatio="none"
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => { if (!event.ctrlKey && !event.metaKey) setSpan((current) => Math.max(0.1, Math.min(100000, current * Math.exp(event.deltaY * 0.001)))); }}
      onPointerDown={(event) => {
        if (pan.current || event.isPrimary === false) return;
        if (event.button === 1 || event.button === 2) {
          pan.current = { x: event.clientX, y: event.clientY, center, pointerId: event.pointerId, buttonMask: event.button === 1 ? 4 : 2, element: event.currentTarget };
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { finishPan(); }
        } else if (event.button === 0 && !interactionLocked) event.currentTarget.focus();
      }}
      onPointerUp={(event) => finishPan(event.pointerId)}
      onPointerCancel={(event) => finishPan(event.pointerId)}
      onLostPointerCapture={(event) => finishPan(event.pointerId)}
      onPointerMove={(event) => {
        const active = pan.current;
        if (active) {
          if (event.pointerId !== active.pointerId) return;
          if (!(event.buttons & active.buttonMask)) { finishPan(event.pointerId); return; }
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) { finishPan(event.pointerId); return; }
          setCenter([active.center[0] - (event.clientX - active.x) / rect.width * width, active.center[1] + (event.clientY - active.y) / rect.height * span]);
        } else setCursor(getPoint(event));
      }}
      onKeyDown={(event) => {
        if (interactionLocked || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.target !== event.currentTarget) return;
        const step = gridStep * (event.shiftKey ? 10 : 1);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          setCursor(([x, y]) => snapSketchPoint([x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)], gridStep, snap));
        } else if ((event.key === 'Enter' || event.key === ' ') && tool !== 'select') {
          event.preventDefault();
          if (event.key === 'Enter' && tool === 'path' && pathDraft.kind === 'ready') closePath();
          else if (event.key === 'Enter' && tool === 'polygon' && points.length >= 3) close();
          else placePoint(cursor);
        } else if (tool === 'path' && pathPending && (event.key === 'Backspace' || event.key === 'Escape')) { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }); }
        else if (event.key === 'Backspace' && points.length) { event.preventDefault(); setPoints((current) => current.slice(0, -1)); }
        else if (event.key === 'Escape' && points.length) { event.preventDefault(); setPoints([]); }
        else if (event.key.toLowerCase() === 'f' && !viewLocked) { event.preventDefault(); fit(); }
      }}
      onClick={(event) => {
        // Chromium's click PointerEvent reports isPrimary=false even for the
        // primary mouse; primary-pointer filtering belongs to pointerdown.
        if (event.button !== 0 || interactionLocked) return;
        if (tool === 'select') {
          const point = getRawPoint(event); const rect = svg.current?.getBoundingClientRect();
          if (point && rect?.height) onSelectProfile(profilePicker.pick(point, span / rect.height));
        } else placePoint(getPoint(event));
      }}>
      <defs><pattern id="cad-sketch-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M ${gridStep} 0 H 0 V ${gridStep}`} fill="none" stroke="#29373f" strokeWidth={span / 1000} /></pattern></defs>
      {grid && span / gridStep < 2000 && <rect x={center[0] - width / 2} y={-center[1] - span / 2} width={width} height={span} fill="url(#cad-sketch-grid)" />}
      <path d={`M ${center[0] - width / 2} 0 H ${center[0] + width / 2}`} className="cad-axis-x" strokeWidth={span / 700} />
      <path d={`M 0 ${-center[1] - span / 2} V ${-center[1] + span / 2}`} className="cad-axis-y" strokeWidth={span / 700} />
      <g transform="scale(1,-1)" strokeWidth={span / 450}>
        {savedCurve && <g className="cad-profile is-selected"><CadPathDraftGeometry segments={savedCurve.segments} preview={false} /></g>}
        {profiles.map((profile) => <g key={profile.id} role="button" aria-label={`Select ${profile.name} profile`} aria-pressed={profile.id === selectedProfileId} tabIndex={tool === 'select' && !interactionLocked ? 0 : -1} className={`cad-profile ${profile.construction ? 'is-construction' : ''} ${profile.id === selectedProfileId ? 'is-selected' : ''}`} strokeDasharray={profile.construction ? `${span / 80} ${span / 120}` : undefined} onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && tool === 'select' && !interactionLocked) { event.preventDefault(); event.stopPropagation(); onSelectProfile(profile.id); } }} onClick={(event) => { if (event.detail === 0 && event.button === 0 && tool === 'select' && !interactionLocked) { event.stopPropagation(); onSelectProfile(profile.id); } }}><SafeProfile profile={profile} parameters={parameters} /></g>)}
        {preview && <g className="cad-profile cad-profile-preview"><ProfileGeometry geometry={preview} parameters={parameters} /></g>}
        {tool === 'polygon' && points.length > 0 && <polyline className="cad-profile cad-profile-preview" points={[...points, cursor].map(([x, y]) => `${x},${y}`).join(' ')} />}
        {tool === 'path' && pathDraft.kind !== 'idle' && <>
          <CadPathDraftGeometry segments={pathDraft.segments} />
          {(pathPreview.kind === 'line' || pathPreview.kind === 'arc') && <g className="cad-profile cad-profile-preview"><CadPathSegmentGeometry segment={pathPreview.segment} /></g>}
          {pathDraft.kind === 'arc-through' && pathPreview.kind === 'invalid' && <polyline className="cad-path-invalid" points={[pathPreview.start, pathPreview.through, pathPreview.end].map(([x, y]) => `${x},${y}`).join(' ')} />}
          <circle cx={pathDraft.start[0]} cy={pathDraft.start[1]} r={span / 170} className="cad-sketch-vertex" />
          {pathDraft.kind === 'arc-through' && <circle cx={pathDraft.end[0]} cy={pathDraft.end[1]} r={span / 170} className="cad-sketch-vertex" />}
        </>}
        {points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={span / 170} className="cad-sketch-vertex" />)}
        {tool !== 'select' && <g className="cad-crosshair"><path d={`M ${cursor[0] - span / 70} ${cursor[1]} h ${span / 35} M ${cursor[0]} ${cursor[1] - span / 70} v ${span / 35}`} /></g>}
      </g>
    </svg>
    <p id={instructionsId} className="cad-sr-only">{interactionLocked ? 'Drawing is paused while another edit or operation is active.' : instruction} Keyboard: arrow keys move the cursor, Shift moves ten grid steps, Space adds a point, Enter accepts an arc through-point or closes a ready path or polyline, Backspace undoes the last point or segment, Escape cancels drawing, F fits the sketch.</p>
    <div className="cad-view-tools"><span className="cad-plane-label">{sketch.plane}</span><button aria-label={sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'} disabled={viewLocked} onClick={fit}><Maximize2 size={14} /></button><button aria-label="Toggle sketch grid" disabled={viewLocked} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={14} /></button><button aria-label="Toggle grid snapping" disabled={viewLocked} aria-pressed={snap} onClick={() => setSnap(!snap)}><Magnet size={14} /></button><label className="cad-grid-step">Grid <input aria-label="Grid spacing" disabled={viewLocked} type="number" min="0.01" value={gridStep} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && Number.isFinite(value)) setGridStep(value); }} /> mm</label></div>
    {!interactionLocked && (tool !== 'select' || points.length > 0) && <div className={`cad-sketch-instruction ${tool === 'path' ? 'cad-path-instruction' : ''}`} onKeyDown={event => {
      if (tool !== 'path' || !pathPending || interactionLocked || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace' || event.key === 'Escape') { event.preventDefault(); changePath({ kind: event.key === 'Backspace' ? 'undo-last' : 'cancel' }, true); }
    }}><span>{instruction}</span>
      {tool === 'path' && <>
        <div className="cad-path-modes" role="group" aria-label="Path segment mode"><button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'line'} onClick={() => changePath({ kind: 'mode', mode: 'line' }, true)}>Line</button><button disabled={interactionLocked || pathDraft.kind === 'arc-through'} aria-pressed={pathMode === 'arc'} onClick={() => changePath({ kind: 'mode', mode: 'arc' }, true)}>3-point Arc</button></div>
        {pathPending && <><button aria-label={sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'} title={sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'} disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={closePath}><Check size={13} />{sketch.kind === 'curve' ? 'Finish curve' : pathNeedsClosingLine ? 'Close with line' : 'Close profile'}</button><button disabled={interactionLocked} onClick={() => changePath({ kind: 'undo-last' }, true)}><Undo2 size={13} /> Undo last</button><button disabled={interactionLocked} onClick={() => changePath({ kind: 'cancel' }, true)}><X size={13} /> Cancel drawing</button></>}
      </>}
      {tool === 'polygon' && points.length >= 3 && <button disabled={interactionLocked} onClick={close}><Check size={13} /> Close profile</button>}{points.length > 0 && <button onClick={() => setPoints([])}><X size={13} /> Cancel drawing</button>}</div>}
    <div className="cad-view-caption">{cursor[0].toFixed(2)}, {cursor[1].toFixed(2)} mm</div>
    <div className="cad-view-help">Right drag to pan · Scroll to zoom · Esc cancels drawing</div>
  </div>;
}
