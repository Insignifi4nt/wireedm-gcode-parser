import { useEffect, useMemo, useState } from 'react';
import { Box, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  normalizeProjectSimulationSettings,
  normalizeWorkbenchSimulationSettings,
  type ProjectSimulationSettings
} from '@/domain/simulation/simulationConfig';
import { loadSimulationProject, type LoadedSimulationProject } from '@/domain/simulation/loadSimulationProject';
import { compileSimulationTimeline } from '@/domain/simulation/simulationTimeline';
import type { Bounds2 } from '@/domain/path-intel/types';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { SimulationScene } from './SimulationScene';
import { SimulationSetupPanel } from './SimulationSetupPanel';
import { SimulationTelemetryPanel } from './SimulationTelemetryPanel';
import {
  SimulationTransport,
  type SimulationCameraPreset
} from './SimulationTransport';
import { advanceSimulationProgress } from './simulationPlayback';

export interface SimulationWorkspaceProps {
  workbench: ConnectedWorkbench;
  projectPath: string;
  onClose: () => void;
  onSaveSettings: (settings: ProjectSimulationSettings) => void | Promise<void>;
}

interface ReadyWorkspace {
  loaded: LoadedSimulationProject;
  settings: ProjectSimulationSettings;
}

export function SimulationWorkspace({
  workbench,
  projectPath,
  onClose: _onClose,
  onSaveSettings: _onSaveSettings
}: SimulationWorkspaceProps) {
  const [ready, setReady] = useState<ReadyWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<SimulationCameraPreset>('isometric');
  const [showGrid, setShowGrid] = useState(true);
  const [showTank, setShowTank] = useState(true);
  const [fitRequest, setFitRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReady(null);
    setLoadError(null);

    void loadSimulationProject(workbench, projectPath).then(
      (loaded) => {
        if (cancelled) return;
        setReady({
          loaded,
          settings: normalizeProjectSimulationSettings(
            loaded.project.simulation,
            loaded.project,
            documentBounds(loaded.document)
          )
        });
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      }
    );

    return () => {
      cancelled = true;
    };
  }, [projectPath, workbench]);

  const prepared = useMemo(() => {
    if (!ready) return null;
    const machine = workbench.manifest.machineProfiles.find(
      (profile) => profile.id === ready.settings.machineProfileId
    ) ?? ready.loaded.project.machine;
    const workbenchSettings = normalizeWorkbenchSimulationSettings(
      workbench.manifest.simulation,
      workbench.manifest.machineProfiles
    );
    const machineSettings = workbenchSettings.machines[machine.id]
      ?? normalizeWorkbenchSimulationSettings(undefined, [machine]).machines[machine.id];

    return {
      machineSettings,
      timeline: compileSimulationTimeline(ready.loaded.document, machine)
    };
  }, [ready, workbench]);

  useEffect(() => {
    if (!isPlaying || !ready || !prepared || prepared.timeline.status !== 'ready') return;
    let frameId = 0;
    let previousTimestamp: number | null = null;

    const advance = (timestamp: number) => {
      if (previousTimestamp === null) previousTimestamp = timestamp;
      const elapsedSeconds = Math.max(0, timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;
      setProgress((current) => {
        const next = advanceSimulationProgress(
          current,
          elapsedSeconds,
          ready.settings.visualPlaybackSpeed,
          prepared.timeline.totalDistanceMm
        );
        if (next >= 1) setIsPlaying(false);
        return next;
      });
      frameId = window.requestAnimationFrame(advance);
    };

    frameId = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(frameId);
  }, [isPlaying, prepared, ready]);

  if (loadError) return <WorkspaceMessage message={loadError} onClose={_onClose} role="alert" />;
  if (!ready || !prepared) return <WorkspaceMessage message="Loading 3D simulation…" onClose={_onClose} />;

  const machineProfiles = workbench.manifest.machineProfiles.some(
    (profile) => profile.id === ready.loaded.project.machine.id
  )
    ? workbench.manifest.machineProfiles
    : [ready.loaded.project.machine, ...workbench.manifest.machineProfiles];

  return (
    <section
      aria-label="3D simulation workspace"
      className="fixed inset-0 z-50 grid min-h-0 grid-rows-[42px_minmax(0,1fr)_auto] bg-background text-foreground"
      data-simulation-workspace
    >
      <header className="flex items-center justify-between border-b border-border bg-card px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Box aria-hidden="true" className="size-4 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold">3D Simulation · {ready.loaded.project.name}</p>
            <p className="truncate font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
              Geometric posted-path preview · visual playback only
            </p>
          </div>
        </div>
        <Button
          aria-label="Close 3D simulation"
          className="size-7"
          onClick={_onClose}
          size="icon"
          title="Close 3D simulation"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </header>

      <div className="grid min-h-0 grid-cols-[248px_minmax(0,1fr)_258px]">
        <SimulationSetupPanel
          exportMachineProfileId={ready.loaded.project.machine.id}
          machineProfiles={machineProfiles}
          onSave={handleSave}
          projectName={ready.loaded.project.name}
          saveErrorMessage={saveErrorMessage}
          saveStatus={saveStatus}
          settings={ready.settings}
        />
        <main className="min-h-0 overflow-hidden">
          {prepared.timeline.status === 'ready' ? (
            <SimulationScene
              cameraPreset={cameraPreset}
              fitRequest={fitRequest}
              machineSettings={prepared.machineSettings}
              progress={progress}
              projectSettings={ready.settings}
              showGrid={showGrid}
              showTank={showTank}
              timeline={prepared.timeline}
            />
          ) : (
            <BlockedSimulation timeline={prepared.timeline} />
          )}
        </main>
        <SimulationTelemetryPanel progress={progress} timeline={prepared.timeline} />
      </div>

      <SimulationTransport
        cameraPreset={cameraPreset}
        disabled={prepared.timeline.status !== 'ready'}
        isPlaying={isPlaying}
        onCameraPresetChange={setCameraPreset}
        onFitView={() => setFitRequest((request) => request + 1)}
        onGridVisibilityChange={setShowGrid}
        onPlayingChange={(playing) => {
          if (playing && progress >= 1) setProgress(0);
          setIsPlaying(playing);
        }}
        onProgressChange={(nextProgress) => {
          setIsPlaying(false);
          setProgress(nextProgress);
        }}
        onReset={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onTankVisibilityChange={setShowTank}
        onVisualSpeedChange={(visualPlaybackSpeed) => {
          setReady((current) => current
            ? { ...current, settings: { ...current.settings, visualPlaybackSpeed } }
            : current);
        }}
        progress={progress}
        showGrid={showGrid}
        showTank={showTank}
        visualSpeed={ready.settings.visualPlaybackSpeed}
      />
    </section>
  );

  async function handleSave(settings: ProjectSimulationSettings) {
    setSaveStatus('saving');
    setSaveErrorMessage(null);
    try {
      await _onSaveSettings(settings);
      setReady((current) => current ? { ...current, settings } : current);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      setSaveErrorMessage(errorMessage(error));
    }
  }
}

function WorkspaceMessage({
  message,
  onClose,
  role
}: {
  message: string;
  onClose: () => void;
  role?: 'alert';
}) {
  return (
    <section className="fixed inset-0 z-50 grid place-items-center bg-background" role={role}>
      <div className="grid gap-3 border border-border bg-card p-5 text-center text-xs">
        <p>{message}</p>
        <Button aria-label="Close 3D simulation" onClick={onClose} size="sm" variant="outline">Close</Button>
      </div>
    </section>
  );
}

function BlockedSimulation({ timeline }: { timeline: ReturnType<typeof compileSimulationTimeline> }) {
  return (
    <div className="grid size-full place-items-center bg-[#071014] p-8" role="alert">
      <div className="max-w-xl border border-destructive/50 bg-destructive/10 p-5">
        <h2 className="text-sm font-semibold text-destructive">Simulation blocked</h2>
        <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
          The selected machine post could not produce a safe deterministic wire path.
        </p>
        <ul className="mt-3 grid gap-1 font-mono text-[9px] text-foreground">
          {timeline.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => (
            <li key={diagnostic.id}>{diagnostic.code}: {diagnostic.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function documentBounds(document: LoadedSimulationProject['document']): Bounds2 | null {
  if (document.segments.length === 0) return null;
  return document.segments.reduce<Bounds2>(
    (bounds, segment) => ({
      minX: Math.min(bounds.minX, segment.bounds.minX),
      minY: Math.min(bounds.minY, segment.bounds.minY),
      maxX: Math.max(bounds.maxX, segment.bounds.maxX),
      maxY: Math.max(bounds.maxY, segment.bounds.maxY)
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load the simulation project.';
}
