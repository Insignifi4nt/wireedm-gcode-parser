import {
  Camera,
  Grid3X3,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Waves,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

export type SimulationCameraPreset = 'isometric' | 'top' | 'front' | 'right';

const CAMERA_PRESETS: ReadonlyArray<{
  value: SimulationCameraPreset;
  label: string;
}> = [
  { value: 'isometric', label: 'ISO' },
  { value: 'top', label: 'TOP' },
  { value: 'front', label: 'FRONT' },
  { value: 'right', label: 'RIGHT' },
];

const VISUAL_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export interface SimulationTransportProps {
  progress: number;
  isPlaying: boolean;
  visualSpeed: number;
  cameraPreset: SimulationCameraPreset;
  showGrid: boolean;
  showTank: boolean;
  disabled?: boolean;
  onProgressChange: (progress: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onVisualSpeedChange: (speed: number) => void;
  onCameraPresetChange: (preset: SimulationCameraPreset) => void;
  onFitView: () => void;
  onGridVisibilityChange: (visible: boolean) => void;
  onTankVisibilityChange: (visible: boolean) => void;
  onReset: () => void;
}

export function SimulationTransport({
  progress,
  isPlaying,
  visualSpeed,
  cameraPreset,
  showGrid,
  showTank,
  disabled = false,
  onProgressChange,
  onPlayingChange,
  onVisualSpeedChange,
  onCameraPresetChange,
  onFitView,
  onGridVisibilityChange,
  onTankVisibilityChange,
  onReset,
}: SimulationTransportProps) {
  const boundedProgress = Math.min(1, Math.max(0, progress));

  return (
    <div
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card/95 px-3 py-2 text-[10px] shadow-[0_-10px_30px_rgba(0,0,0,0.18)]"
      data-simulation-transport
    >
      <div className="flex items-center gap-1 border-r border-border pr-2">
        <Button
          aria-label="Reset visual playback"
          className="size-7 p-0"
          disabled={disabled || boundedProgress === 0}
          onClick={onReset}
          size="sm"
          title="Reset visual playback"
          variant="outline"
        >
          <RotateCcw />
        </Button>
        <Button
          aria-label={isPlaying ? 'Pause visual playback' : 'Play visual playback'}
          className="h-7 min-w-20 px-2"
          disabled={disabled}
          onClick={() => onPlayingChange(!isPlaying)}
          size="sm"
          variant={isPlaying ? 'secondary' : 'default'}
        >
          {isPlaying ? <Pause /> : <Play />}
          {isPlaying ? 'Pause' : 'Play'}
        </Button>
      </div>

      <label className="flex min-w-48 flex-1 items-center gap-2">
        <span className="sr-only">Visual playback progress</span>
        <input
          aria-label="Visual playback progress"
          className="h-1.5 min-w-28 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
          disabled={disabled}
          max={1}
          min={0}
          onChange={(event) => onProgressChange(Number(event.currentTarget.value))}
          step={0.001}
          type="range"
          value={boundedProgress}
        />
        <output
          aria-live="off"
          className="technical-value w-11 text-right text-[10px] tabular-nums text-foreground"
        >
          {(boundedProgress * 100).toFixed(1)}%
        </output>
      </label>

      <label className="flex h-7 items-center gap-1.5 border border-border bg-background px-2 text-muted-foreground">
        <span className="whitespace-nowrap uppercase tracking-[0.04em]">Visual speed</span>
        <select
          aria-label="Visual playback speed"
          className="technical-value bg-transparent text-[10px] text-foreground outline-none"
          disabled={disabled}
          onChange={(event) => onVisualSpeedChange(Number(event.currentTarget.value))}
          value={visualSpeed}
        >
          {VISUAL_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
          {!VISUAL_SPEEDS.includes(visualSpeed as (typeof VISUAL_SPEEDS)[number]) && (
            <option value={visualSpeed}>{visualSpeed}×</option>
          )}
        </select>
      </label>

      <div
        aria-label="Camera presets"
        className="flex items-center gap-1 border-l border-border pl-2"
        role="group"
      >
        <Camera aria-hidden="true" className="mx-1 size-3.5 text-muted-foreground" />
        {CAMERA_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            aria-label={`${preset.label.toLowerCase()} camera preset`}
            aria-pressed={cameraPreset === preset.value}
            className="h-7 px-2 text-[9px]"
            disabled={disabled}
            onClick={() => onCameraPresetChange(preset.value)}
            size="sm"
            variant={cameraPreset === preset.value ? 'secondary' : 'outline'}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          aria-label="Fit simulation to view"
          className="size-7 p-0"
          disabled={disabled}
          onClick={onFitView}
          size="sm"
          title="Fit simulation to view"
          variant="outline"
        >
          <Maximize2 />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-l border-border pl-2">
        <Button
          aria-label={`${showGrid ? 'Hide' : 'Show'} simulation grid`}
          aria-pressed={showGrid}
          className="h-7 px-2"
          disabled={disabled}
          onClick={() => onGridVisibilityChange(!showGrid)}
          size="sm"
          variant={showGrid ? 'secondary' : 'outline'}
        >
          <Grid3X3 />
          Grid
        </Button>
        <Button
          aria-label={`${showTank ? 'Hide' : 'Show'} machine tank`}
          aria-pressed={showTank}
          className="h-7 px-2"
          disabled={disabled}
          onClick={() => onTankVisibilityChange(!showTank)}
          size="sm"
          variant={showTank ? 'secondary' : 'outline'}
        >
          <Waves />
          Tank
        </Button>
      </div>
    </div>
  );
}
