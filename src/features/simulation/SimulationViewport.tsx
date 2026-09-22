import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Box, Eye, EyeOff, Maximize, Scan, ScanLine, View } from 'lucide-react';
import type { SimulationPlan, SimulationSnapshot } from '@/domain/simulation';
import type { MachineModel } from '@/domain/simulation/machine-import';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';
import { createSimulationScene, type SceneMachinePlacement, type ScenePresentation, type SimulationScene } from './SimulationScene';

export type SimulationCapture = (signal: AbortSignal) => Promise<EditorPreviewCapture>;

interface Props {
  plan: SimulationPlan;
  snapshot: SimulationSnapshot;
  machine: MachineModel | null;
  placement: SceneMachinePlacement;
  presentation: ScenePresentation;
  onCaptureReady: (capture: SimulationCapture | null) => void;
}

export function SimulationViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SimulationScene | null>(null);
  const latest = useRef(props); latest.current = props;
  const [status, setStatus] = useState<'loading' | 'WebGPU' | 'WebGL2' | 'error'>('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [machineVisible, setMachineVisible] = useState(true);
  const failScene = useCallback((reason: unknown) => {
    const failed = sceneRef.current;
    sceneRef.current = null;
    failed?.dispose();
    latest.current.onCaptureReady(null);
    setError(reason instanceof Error ? reason.message : 'The 3D renderer could not draw the scene.');
    setStatus('error');
  }, []);
  const withScene = useCallback((action: (scene: SimulationScene) => void) => {
    const scene = sceneRef.current;
    if (!scene) return;
    try { action(scene); }
    catch (reason) { failScene(reason); }
  }, [failScene]);
  useEffect(() => {
    if (!host.current) return;
    const controller = new AbortController();
    setStatus('loading');
    void createSimulationScene(host.current, props.plan, controller.signal).then(scene => {
      if (controller.signal.aborted) { scene.dispose(); return; }
      sceneRef.current = scene;
      scene.update(latest.current.snapshot);
      scene.setMachine(latest.current.machine, latest.current.placement);
      scene.setPresentation(latest.current.presentation);
      latest.current.onCaptureReady(signal => scene.capture(signal));
      setStatus(scene.backend);
    }).catch(reason => {
      if (controller.signal.aborted) return;
      failScene(reason);
    });
    return () => {
      controller.abort(); sceneRef.current?.dispose(); sceneRef.current = null;
      latest.current.onCaptureReady(null);
    };
  }, [props.plan, retry, failScene]);
  useEffect(() => { withScene(scene => scene.update(props.snapshot)); }, [props.snapshot, withScene]);
  useEffect(() => { withScene(scene => scene.setMachine(props.machine, props.placement)); }, [props.machine, props.placement, withScene]);
  useEffect(() => { withScene(scene => scene.setPresentation(props.presentation)); }, [props.presentation, withScene]);
  useEffect(() => { setMachineVisible(true); }, [props.machine]);
  useEffect(() => { withScene(scene => scene.setMachineVisible(machineVisible)); }, [machineVisible, status, withScene]);
  return <div className="sim-viewport" data-renderer={status}>
    <div ref={host} className="sim-render-host" />
    <div className="sim-view-controls" aria-label="Simulation camera">
      <button type="button" title={props.presentation.finalPartOnly ? 'Fit final part' : 'Isometric view · fit stock'} aria-label={props.presentation.finalPartOnly ? 'Fit final part' : 'Fit simulation stock'} onClick={() => withScene(scene => props.presentation.finalPartOnly ? scene.fitPart() : scene.setView('isometric'))}><Maximize size={14} /></button>
      <button type="button" title="Top view" aria-label="Simulation top view" onClick={() => withScene(scene => scene.setView('top'))}><Scan size={14} /></button>
      <button type="button" title="Front view" aria-label="Simulation front view" onClick={() => withScene(scene => scene.setView('front'))}><View size={14} /></button>
      {props.machine && !props.presentation.finalPartOnly && <>
        <button type="button" title="Fit machine and stock" aria-label="Fit machine model" onClick={() => withScene(scene => scene.fitMachine())}><ScanLine size={14} /></button>
        <button type="button" title={machineVisible ? 'Hide machine model · collision checks stay active' : 'Show machine model'} aria-label={machineVisible ? 'Hide machine model' : 'Show machine model'} onClick={() => setMachineVisible(value => !value)}>{machineVisible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
      </>}
    </div>
    {status === 'loading' && <div className="sim-render-message" role="status"><Box size={25} /><strong>Preparing the 3D workspace</strong><span>Loading the renderer locally…</span></div>}
    {status === 'error' && <div className="sim-render-message" role="alert"><AlertTriangle size={25} /><strong>3D preview unavailable</strong><span>{error}</span><button type="button" onClick={() => setRetry(value => value + 1)}>Retry renderer</button></div>}
  </div>;
}
