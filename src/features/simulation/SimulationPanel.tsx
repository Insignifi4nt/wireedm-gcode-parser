import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Box, Check, ChevronRight, FileBox, Info, LoaderCircle, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { sampleSimulation, resolveSimulationSettings, type SimulationSettings } from '@/domain/simulation';
import type { MachineModel } from '@/domain/simulation/machine-import';
import { MachineSetupPanel } from './MachineSetupPanel';
import { defaultSimulationSettings } from './simulationDefaults';
import { SimulationViewport, type SimulationCapture } from './SimulationViewport';
import type { SceneMachinePlacement, ScenePresentation } from './SimulationScene';
import { useMachineCollisionScan } from './useMachineCollisionScan';
import { useSimulationPlan } from './useSimulationPlan';
import './simulation.css';

interface Props {
  document: PathPlanningDocument;
  projectName: string;
  savedAt: string;
  dirty: boolean;
  active: boolean;
  onEdit: () => void;
  onCaptureReady: (capture: SimulationCapture | null) => void;
}

const zeroPlacement: SceneMachinePlacement = { x: 0, y: 0, z: 0, rotation: 0 };
type SetupPanel = 'stock' | 'machine' | 'checks' | 'info';
const panelTitles: Record<SetupPanel, string> = { stock: 'Stock', machine: 'Machine model', checks: 'Checks', info: 'About this preview' };
const phaseNames = { cutting: 'Cutting', positioning: 'Positioning', paused: 'Program stop', rethreading: 'Wire transition', idle: 'Ready', complete: 'Complete' };
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

export default function SimulationPanel({ document, projectName, savedAt, dirty, active, onEdit, onCaptureReady }: Props) {
  const [settings, setSettings] = useState<SimulationSettings>(() => defaultSimulationSettings(document));
  const { result, retry } = useSimulationPlan(document, settings);
  const plan = result?.ok ? result.plan : null;
  const operationStarts = useMemo(() => plan?.steps.flatMap(step => step.event.kind === 'operation-start'
    ? [{ id: step.event.operationId, name: step.event.name, time: step.startSeconds }] : []) ?? [], [plan]);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [finalPartOnly, setFinalPartOnly] = useState(false);
  const [showStock, setShowStock] = useState(true);
  const [showWaste, setShowWaste] = useState(false);
  const presentation = useMemo<ScenePresentation>(() => ({ showStock, showWaste, finalPartOnly }), [showStock, showWaste, finalPartOnly]);
  const snapshot = useMemo(() => plan ? sampleSimulation(plan, elapsed) : null, [plan, elapsed]);
  const [machine, setMachine] = useState<MachineModel | null>(null);
  const [placement, setPlacement] = useState(zeroPlacement);
  const machineScan = useMachineCollisionScan(plan, machine, placement);
  const [formError, setFormError] = useState('');
  const [openPanel, setOpenPanel] = useState<SetupPanel | null>(null);
  const popoverId = useId();
  const checksDescriptionId = useId();
  const setupTools = useRef<HTMLDivElement>(null);
  const setupPopover = useRef<HTMLDivElement>(null);
  const lastSetupTrigger = useRef<HTMLButtonElement | null>(null);
  function closeSetup(restoreFocus = false) {
    setOpenPanel(null);
    if (restoreFocus) lastSetupTrigger.current?.focus();
  }
  useEffect(() => {
    if (!openPanel) return;
    const firstControl = setupPopover.current?.querySelector<HTMLElement>(`[data-sim-panel="${openPanel}"]`)
      ?.querySelector<HTMLElement>('input:not([type=file]):not(:disabled), select:not(:disabled), button:not(:disabled), summary');
    (firstControl ?? setupPopover.current)?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeSetup(true); } };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !setupTools.current?.contains(event.target) && !setupPopover.current?.contains(event.target)) closeSetup();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', outside); };
  }, [openPanel]);
  useEffect(() => { if (!active) setOpenPanel(null); }, [active]);
  useEffect(() => { setPlaying(false); setElapsed(0); }, [plan]);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    if (!playing || !plan || !active || finalPartOnly) return;
    let frame = 0; let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.1) * speed; previous = now;
      setElapsed(value => Math.min(value + delta, plan.durationSeconds));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, plan, speed, active, finalPartOnly]);
  useEffect(() => { if (plan && elapsed >= plan.durationSeconds) setPlaying(false); }, [elapsed, plan]);

  function applyStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    const next: SimulationSettings = { ...settings, stock: {
      width: number('width'), depth: number('depth'), thickness: number('thickness'),
      originX: number('originX'), originY: number('originY'), bottomZ: number('bottomZ')
    }, wireDiameter: number('wireDiameter'), supportFloorZ: number('supportFloorZ'),
    retention: data.get('retention') === 'retain' ? 'retain' : 'fall',
    wasteHandling: data.get('wasteHandling') === 'keep' ? 'keep' : 'remove-before-next-operation' };
    const lowerWireZ = next.stock.bottomZ - (next.guideClearanceMm ?? 20);
    if (next.supportFloorZ !== null && next.supportFloorZ !== undefined && next.supportFloorZ < lowerWireZ) {
      setFormError(`Support Z must be at or above the lower wire end (${lowerWireZ} mm).`); return;
    }
    if (!resolveSimulationSettings(next)) {
      setFormError(next.supportFloorZ !== null && next.supportFloorZ !== undefined && next.supportFloorZ > next.stock.bottomZ
        ? 'Support floor Z must be at or below the stock bottom Z.'
        : 'Enter finite dimensions greater than zero. Position values may be negative.'); return;
    }
    setFormError(''); setSettings(next); closeSetup(true);
  }

  function step(direction: -1 | 1) {
    if (!plan) return;
    setPlaying(false);
    const times = [...new Set([0, ...plan.steps.filter(item => item.event.kind === 'operation-start' || item.event.kind === 'program-stop').map(item => item.startSeconds), plan.durationSeconds])].sort((a, b) => a - b);
    setElapsed(direction === 1 ? times.find(time => time > elapsed + 0.001) ?? plan.durationSeconds : [...times].reverse().find(time => time < elapsed - 0.001) ?? 0);
  }
  const activeOperation = operationStarts.find(operation => operation.id === snapshot?.operationId);
  const warnings = plan?.warnings ?? [];
  const machineWarnings = machineScan.status === 'ready' ? machineScan.result.warnings : [];
  const diagnostics = result?.ok ? result.plan.diagnostics : result?.diagnostics ?? [];
  const actionableDiagnostics = diagnostics.filter(diagnostic => diagnostic.severity !== 'info'
    && !['SIMULATION_MATERIAL_ASSUMPTIONS', 'SIMULATION_NOMINAL_COMPENSATION'].includes(diagnostic.code));
  const workerFailed = diagnostics.some(diagnostic => /^SIMULATION_(WORKER_|COMPILE_)/.test(diagnostic.code));
  const machineCheckFailed = machineScan.status === 'error';
  const machineCheckIncomplete = machineScan.status === 'ready' && !machineScan.result.complete;
  const findingCount = actionableDiagnostics.length + warnings.length + machineWarnings.length + Number(machineCheckFailed || machineCheckIncomplete);
  const checksDescription = `${findingCount} ${findingCount === 1 ? 'finding' : 'findings'}.${machineCheckFailed
    ? ' Machine surface check failed.' : machineCheckIncomplete ? ' Machine surface check incomplete.'
      : machineScan.status === 'scanning' ? ' Machine surface check in progress.' : ''}`;
  function setupButton(panel: SetupPanel, label: string, content: ReactNode) {
    return <button type="button" aria-label={label} aria-expanded={openPanel === panel} aria-controls={popoverId} aria-haspopup="dialog"
      aria-describedby={panel === 'checks' ? checksDescriptionId : undefined}
      className={panel === 'checks' && findingCount ? 'sim-tool has-findings' : 'sim-tool'} onClick={event => {
        lastSetupTrigger.current = event.currentTarget;
        setPlaying(false); setOpenPanel(current => current === panel ? null : panel);
      }}>{content}</button>;
  }

  return <section className="sim-workspace" aria-label="Saved process simulation" data-final-part={finalPartOnly}>
    <div className="sim-main">
      <div className="sim-context-bar">
        {plan && <div className="sim-presentation-switch" role="group" aria-label="Simulation view">
          <button type="button" aria-pressed={!finalPartOnly} onClick={() => setFinalPartOnly(false)}>Process</button>
          <button type="button" aria-pressed={finalPartOnly} onClick={() => { setPlaying(false); setFinalPartOnly(true); closeSetup(); }}>Final part</button>
        </div>}
        {plan && !finalPartOnly && <select className="sim-operation-select" aria-label="Simulation operation" value={activeOperation?.id ?? ''} onChange={event => {
          const operation = operationStarts.find(item => item.id === event.target.value);
          if (operation) { setPlaying(false); setElapsed(operation.time); }
        }}><option value="" disabled>Jump to operation</option>{operationStarts.map((operation, index) => <option key={operation.id} value={operation.id ?? ''}>{index + 1}. {operation.name}</option>)}</select>}
        <div className="sim-tools" ref={setupTools}>
          {setupButton('stock', 'Stock settings', <><Box size={14} /><span>Stock</span><small>{[settings.stock.width, settings.stock.depth, settings.stock.thickness].map(value => Number(value.toFixed(3))).join(' × ')}</small></>)}
          {setupButton('machine', 'Machine model settings', <><FileBox size={14} /><span>Machine</span>{machine && <i aria-label="Model loaded" />}</>)}
          {setupButton('checks', 'Simulation checks', <><AlertTriangle size={14} /><span>Checks</span><b>{findingCount}</b></>)}
          <span id={checksDescriptionId} className="sr-only" aria-live="polite">{checksDescription}</span>
          {setupButton('info', 'Simulation information', <Info size={15} />)}
        </div>
      </div>
      {dirty && <div className="sim-draft-notice"><AlertTriangle size={13} />Unsaved editor changes are excluded.<button type="button" onClick={onEdit}>Return to editor to save<ChevronRight size={12} /></button></div>}
      {!result ? <div className="sim-unavailable" role="status"><LoaderCircle className="animate-spin" size={28} /><h2>Preparing the saved process</h2><p>Building the timeline and checking material obstructions. You can return to the editor while this runs.</p><button type="button" onClick={onEdit}><ArrowLeft size={14} />Return to editor</button></div> : plan && snapshot ? <>
        <div className="sim-scene-wrap"><SimulationViewport plan={plan} snapshot={snapshot} machine={machine} placement={placement} presentation={presentation} onCaptureReady={onCaptureReady} />
          {finalPartOnly ? <div className="sim-state-card"><strong>Final part</strong><span>Nominal geometry</span></div> : <div className="sim-state-card"><span className={snapshot.wire.cutting ? 'sim-state-dot cutting' : 'sim-state-dot'} />
            <strong>{snapshot.phase === 'complete' ? 'Complete' : elapsed >= plan.machiningDurationSeconds ? 'Settling' : !playing && elapsed === 0 ? 'Ready' : !playing ? 'Paused' : phaseNames[snapshot.phase]}</strong>
            {!snapshot.wire.threaded && <span>Wire separated</span>}
          </div>}
          {finalPartOnly && plan.finalMaterial.status !== 'ready' && <div className={plan.finalMaterial.solids.length ? 'sim-final-notice' : 'sim-render-message'} role="status">
            <strong>{plan.finalMaterial.solids.length ? 'Partial result' : 'Final part unavailable'}</strong>
            <span>{plan.finalMaterial.diagnostics[0]?.message ?? 'Complete a supported closed boundary with a defined kept side to inspect the final material.'}</span>
          </div>}
        </div>
        {!finalPartOnly && <div className="sim-playback">
          <input aria-label="Simulation timeline" type="range" min={0} max={plan.durationSeconds || 1} step="any" value={elapsed}
            onKeyDown={event => {
              if (event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault(); setPlaying(false); setElapsed(event.key === 'End' ? plan.durationSeconds : 0);
            }} onChange={event => {
              setPlaying(false);
              const value = Number(event.target.value);
              setElapsed(value >= plan.durationSeconds - Math.max(1, plan.durationSeconds) * 1e-12 ? plan.durationSeconds : value);
            }} />
          <div className="sim-playback-row"><div className="sim-transport">
            <button type="button" aria-label="Restart simulation" onClick={() => { setPlaying(false); setElapsed(0); }}><RotateCcw size={14} /></button>
            <button type="button" aria-label="Previous simulation event" onClick={() => step(-1)}><SkipBack size={14} /></button>
            <button className="sim-play" type="button" aria-label={playing ? 'Pause simulation' : 'Play simulation'} onClick={() => { if (elapsed >= plan.durationSeconds) setElapsed(0); setPlaying(value => !value); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
            <button type="button" aria-label="Next simulation event" onClick={() => step(1)}><SkipForward size={14} /></button>
            <span className="sim-time">{timeLabel(elapsed)}<span> / {timeLabel(plan.durationSeconds)}</span></span>
          </div><div className="sim-rate"><select aria-label="Simulation playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[0.25, 0.5, 1, 2, 5, 10].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></div></div>
        </div>}
      </> : <div className="sim-unavailable"><AlertTriangle size={28} /><h2>{workerFailed ? 'Simulation preparation stopped' : 'Finish the machining setup'}</h2><p>{workerFailed ? 'The saved project is unchanged.' : 'The saved process needs explicit machining intent before it can be simulated.'}</p><ul>{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>)}</ul>{workerFailed && <button type="button" onClick={retry}>Retry simulation</button>}<button type="button" onClick={onEdit}><ArrowLeft size={14} />Review in editor</button></div>}
    </div>
    <div ref={setupPopover} id={popoverId} role="dialog" aria-modal="false" aria-label={openPanel ? panelTitles[openPanel] : 'Simulation setup'} tabIndex={-1} className="sim-setup-popover" hidden={!openPanel}>
      <div className="sim-popover-heading"><strong>{openPanel ? panelTitles[openPanel] : ''}</strong><button type="button" aria-label="Close simulation settings" onClick={() => closeSetup(true)}><X size={15} /></button></div>
      <div data-sim-panel="stock" hidden={openPanel !== 'stock'}>
      <form onSubmit={applyStock} className="sim-section"><div className="sim-section-title"><span>Dimensions</span><span>mm</span></div>
        <div className="sim-dimensions">{(['width', 'depth', 'thickness'] as const).map(key => <label key={key}><span>{key === 'width' ? 'Width · X' : key === 'depth' ? 'Depth · Y' : 'Height · Z'}</span><input aria-label={`Stock ${key}`} name={key} type="number" step="any" min="0.001" required defaultValue={settings.stock[key]} /></label>)}</div>
        <label className="sim-select-row"><span>Released pieces</span><select aria-label="Released piece behavior" name="retention" defaultValue={settings.retention}><option value="fall">Fall under gravity</option><option value="retain">Retained in place</option></select></label>
        <label className="sim-select-row"><span>Waste handling</span><select aria-label="Waste handling" name="wasteHandling" defaultValue={settings.wasteHandling ?? 'remove-before-next-operation'}><option value="remove-before-next-operation">Remove between cuts</option><option value="keep">Keep for interference</option></select></label>
        <details className="sim-details"><summary>Placement & wire</summary><div className="sim-fields-grid">{(['originX', 'originY', 'bottomZ'] as const).map(key => <label key={key}><span>{key === 'originX' ? 'Origin X' : key === 'originY' ? 'Origin Y' : 'Bottom Z'}</span><input aria-label={`Stock ${key}`} name={key} type="number" step="any" required defaultValue={settings.stock[key]} /></label>)}<label><span>Wire Ø</span><input aria-label="Wire diameter" name="wireDiameter" type="number" step="any" min="0.001" required defaultValue={settings.wireDiameter} /></label><label><span>Support Z</span><input aria-label="Support floor Z" name="supportFloorZ" type="number" step="any" required defaultValue={settings.supportFloorZ ?? settings.stock.bottomZ - (settings.guideClearanceMm ?? 20)} /></label></div></details>
        {formError && <p className="sim-error" role="alert">{formError}</p>}<button className="sim-apply" type="submit"><Check size={13} />Apply stock</button>
      </form>
      <div className="sim-section sim-visibility"><div className="sim-section-title">Process visibility</div>
        <label><input type="checkbox" aria-label="Show remaining stock" checked={showStock} onChange={event => setShowStock(event.target.checked)} />Show remaining stock</label>
        <label><input type="checkbox" aria-label="Show waste material" checked={showWaste} onChange={event => setShowWaste(event.target.checked)} />Show waste material</label>
        <p>Visibility does not change collision checks.</p>
      </div>
      </div>
      <div data-sim-panel="machine" hidden={openPanel !== 'machine'}>
      <MachineSetupPanel machine={machine} placement={placement} onMachineChange={setMachine} onPlacementChange={setPlacement} />
      </div>
      <div data-sim-panel="checks" hidden={openPanel !== 'checks'}>
      <div className="sim-section sim-findings"><div className="sim-section-title"><span>Material</span><span className={warnings.length ? 'sim-warning-count' : ''}>{warnings.length}</span></div>
        {actionableDiagnostics.map((diagnostic, index) => <p className="sim-diagnostic" key={`${diagnostic.code}-${index}`}>{diagnostic.message}</p>)}
        {warnings.length ? <div className="sim-warning-list">{warnings.map(warning => <button key={warning.id} type="button" onClick={() => { setPlaying(false); setFinalPartOnly(false); setElapsed(warning.elapsedSeconds); }}><AlertTriangle size={13} /><span>{warning.message}<small>{timeLabel(warning.elapsedSeconds)} · {warning.envelope}</small></span></button>)}</div> : <p>{plan ? 'No material obstruction flagged.' : 'Waiting for a valid saved process.'}</p>}
        {machineScan.status === 'scanning' && <p role="status">Checking wire motion against machine surfaces…</p>}
        {machineScan.status === 'error' && <p className="sim-error" role="alert">{machineScan.message}</p>}
        {machineScan.status === 'ready' && <div className="sim-machine-findings">
          <div className="sim-section-title"><span>Machine surfaces</span><span>{machineScan.result.warnings.length}</span></div>
          {!machineScan.result.complete && <p className="sim-error">{machineScan.result.message}</p>}
          <div className="sim-warning-list">{machineWarnings.map(warning => <button key={warning.id} type="button" onClick={() => { setPlaying(false); setFinalPartOnly(false); setElapsed(warning.elapsedSeconds); }}><AlertTriangle size={13} /><span>{warning.message}<small>{timeLabel(warning.elapsedSeconds)} · {warning.approximate ? 'approximate envelope' : 'surface intersection'}</small></span></button>)}</div>
          <details className="sim-details"><summary>Machine scan limits</summary><ul>{machineScan.result.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul></details>
        </div>}
        <p className="sim-screening-note">Approximate checks · not verified machine clearance.</p>
      </div>
      </div>
      <div data-sim-panel="info" className="sim-section sim-information" hidden={openPanel !== 'info'}>
        <p><strong>{projectName}</strong> · SAVED UPID</p><p title={savedAt}>Saved {new Date(savedAt).toLocaleString()}</p>
        <p>Geometric preview with assumed speeds; no machine-cycle or cut-quality prediction. Settings and machine models last for this session.</p>
        {plan && <details className="sim-details"><summary>Assumptions & limitations</summary><ul>{diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>)}</ul></details>}
      </div>
    </div>
  </section>;
}
