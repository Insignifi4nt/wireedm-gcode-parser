import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Upload, X } from 'lucide-react';
import { MACHINE_IMPORT_LIMITS, validMachinePlacement, type MachineImportProgress, type MachineModel } from '@/domain/simulation/machine-import';
import { importMachineModel } from './machine-import/importMachineModel';
import { MACHINE_IMPORT_THIRD_PARTY } from './machine-import/thirdPartyNotices';
import type { SceneMachinePlacement } from './SimulationScene';

interface Props {
  machine: MachineModel | null;
  placement: SceneMachinePlacement;
  onMachineChange: (model: MachineModel | null) => void;
  onPlacementChange: (placement: SceneMachinePlacement) => void;
}

const placementKeys = ['x', 'y', 'z', 'rotation'] as const;
type PlacementDraft = Record<typeof placementKeys[number], string>;
const zeroPlacement: SceneMachinePlacement = { x: 0, y: 0, z: 0, rotation: 0 };
const progressLabels: Record<MachineImportProgress['stage'], string> = {
  reading: 'Reading STEP file',
  'loading-parser': 'Loading local CAD parser',
  triangulating: 'Tessellating machine geometry',
  validating: 'Checking model geometry'
};

export function MachineSetupPanel({ machine, placement, onMachineChange, onPlacementChange }: Props) {
  const [draft, setDraft] = useState(() => placementDraft(placement));
  const [alignmentError, setAlignmentError] = useState('');
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const importer = useRef<AbortController | null>(null);

  useEffect(() => {
    setDraft(placementDraft(placement));
    setAlignmentError('');
  }, [machine, placement.x, placement.y, placement.z, placement.rotation]);

  useEffect(() => () => {
    const controller = importer.current;
    importer.current = null;
    controller?.abort();
  }, []);

  function cancelImport() {
    const controller = importer.current;
    importer.current = null;
    controller?.abort();
    setImportProgress(null);
  }

  async function loadMachine(file: File) {
    importer.current?.abort();
    const controller = new AbortController();
    importer.current = controller;
    setImportError('');
    setImportProgress(progressLabels.reading);
    try {
      const imported = await importMachineModel(file, {
        signal: controller.signal,
        onProgress: progress => {
          if (importer.current === controller) setImportProgress(progressLabels[progress.stage]);
        }
      });
      if (importer.current !== controller || controller.signal.aborted) return;
      if (imported.ok) {
        onMachineChange(imported.model);
        onPlacementChange({ ...zeroPlacement });
      } else if (imported.error.code !== 'MACHINE_IMPORT_CANCELLED') {
        setImportError(imported.error.message);
      }
    } catch (error) {
      if (importer.current === controller && !controller.signal.aborted) {
        setImportError(error instanceof Error ? error.message : 'The machine model could not be imported.');
      }
    } finally {
      if (importer.current === controller) {
        importer.current = null;
        setImportProgress(null);
      }
    }
  }

  function applyAlignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { x: Number(draft.x), y: Number(draft.y), z: Number(draft.z), rotation: Number(draft.rotation) };
    const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
    if (placementKeys.some(key => !decimal.test(draft[key].trim())) || !validMachinePlacement({
      translationMm: [next.x, next.y, next.z], rotationZDegrees: next.rotation
    })) {
      setAlignmentError('Enter X, Y and Z within ±10,000,000 mm and a rotation within ±360,000°.');
      return;
    }
    setAlignmentError('');
    onPlacementChange(next);
  }

  return <section className="sim-section" aria-label="Machine model setup">
    <input ref={fileInput} type="file" accept=".step,.stp" hidden aria-label="Machine STEP file" onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void loadMachine(file);
    }} />
    {importProgress
      ? <div className="sim-import-progress" role="status"><LoaderCircle className="animate-spin" size={14} /><span>{importProgress}</span><button type="button" aria-label="Cancel STEP import" onClick={cancelImport}><X size={13} /></button></div>
      : <button className="sim-import" type="button" onClick={() => fileInput.current?.click()}><Upload size={14} />{machine ? 'Replace STEP model' : 'Import STEP model'}<span>≤{MACHINE_IMPORT_LIMITS.fileBytes / (1024 * 1024)} MB</span></button>}
    {importError && <p className="sim-error" role="alert">{importError}</p>}
    {machine && <div className="sim-machine">
      <div><strong title={machine.name}>{machine.name}</strong><button type="button" aria-label="Remove machine model" onClick={() => {
        cancelImport();
        setImportError('');
        onMachineChange(null);
      }}><X size={13} /></button></div>
      <span>{machine.meshes.length} meshes · {machine.triangleCount.toLocaleString()} triangles · mm</span>
      <details className="sim-details"><summary>Align machine model</summary>
        <form onSubmit={applyAlignment}>
          <div className="sim-fields-grid">{placementKeys.map(key => <label key={key}>
            <span>{key === 'rotation' ? 'Rotate Z · °' : `Offset ${key.toUpperCase()}`}</span>
            <input aria-label={`Machine ${key}`} name={key} type="text" inputMode="decimal" value={draft[key]} onChange={event => {
              const value = event.target.value;
              setDraft(current => ({ ...current, [key]: value }));
            }} />
          </label>)}</div>
          {alignmentError && <p className="sim-error" role="alert">{alignmentError}</p>}
          <button className="sim-apply" type="submit"><Check size={13} />Apply alignment</button>
        </form>
      </details>
    </div>}
    <span className="sim-local-note">Local file · this session only</span>
    <details className="sim-details"><summary>STEP importer licenses &amp; source</summary>
      <p>{MACHINE_IMPORT_THIRD_PARTY.notice}</p>
      <ul>{MACHINE_IMPORT_THIRD_PARTY.links.map(link => <li key={link.href}><a href={link.href} target="_blank" rel="noreferrer">{link.label}</a></li>)}</ul>
    </details>
  </section>;
}

function placementDraft(placement: SceneMachinePlacement): PlacementDraft {
  return { x: String(placement.x), y: String(placement.y), z: String(placement.z), rotation: String(placement.rotation) };
}
