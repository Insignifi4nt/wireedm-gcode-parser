import type { Bounds2 } from '@/domain/path-intel/types';
import type { MachineProfile, WorkbenchProject } from '@/domain/workbench/types';

export const SIMULATION_SCHEMA_VERSION = 1 as const;
export const STOCK_PADDING_MM = 10;

const DEFAULT_STOCK_WIDTH_MM = 100;
const DEFAULT_STOCK_LENGTH_MM = 100;
const DEFAULT_STOCK_THICKNESS_MM = 10;
const DEFAULT_STOCK_MATERIAL = 'Tool steel';
const DEFAULT_ENTRY_HOLE_DIAMETER_MM = 1;
const DEFAULT_VISUAL_PLAYBACK_SPEED = 1;

export type SimulationRenderingQuality = 'performance' | 'balanced' | 'quality';

export interface ProjectSimulationStock {
  widthMm: number;
  lengthMm: number;
  thicknessMm: number;
  originX: number;
  originY: number;
  topZMm: number;
  material: string;
}

export interface ProjectSimulationSettings {
  schemaVersion: typeof SIMULATION_SCHEMA_VERSION;
  machineProfileId: string;
  stock: ProjectSimulationStock;
  entryHoleDiameterMm: number;
  visualPlaybackSpeed: number;
}

export interface MachineSimulationSettings {
  upperGuideZMm: number;
  lowerGuideZMm: number;
  tankDepthMm: number;
  defaultWireDiameterMm: number;
  fixtureClearanceMm: number;
}

export interface WorkbenchSimulationSettings {
  schemaVersion: typeof SIMULATION_SCHEMA_VERSION;
  renderingQuality: SimulationRenderingQuality;
  machines: Record<string, MachineSimulationSettings>;
}

const DEFAULT_MACHINE_SIMULATION_SETTINGS: MachineSimulationSettings = {
  upperGuideZMm: 25,
  lowerGuideZMm: -25,
  tankDepthMm: 80,
  defaultWireDiameterMm: 0.25,
  fixtureClearanceMm: 10
};

export function defaultProjectSimulationSettings(
  project: WorkbenchProject,
  bounds: Bounds2 | null | undefined
): ProjectSimulationSettings {
  const stock = defaultStock(project, bounds);

  return {
    schemaVersion: SIMULATION_SCHEMA_VERSION,
    machineProfileId: project.machine.id,
    stock,
    entryHoleDiameterMm: DEFAULT_ENTRY_HOLE_DIAMETER_MM,
    visualPlaybackSpeed: DEFAULT_VISUAL_PLAYBACK_SPEED
  };
}

export function normalizeProjectSimulationSettings(
  value: unknown,
  project: WorkbenchProject,
  bounds: Bounds2 | null | undefined
): ProjectSimulationSettings {
  const defaults = defaultProjectSimulationSettings(project, bounds);
  const candidate = record(value);
  const stock = record(candidate?.stock);

  return {
    schemaVersion: SIMULATION_SCHEMA_VERSION,
    machineProfileId: nonEmptyString(candidate?.machineProfileId) ?? defaults.machineProfileId,
    stock: {
      widthMm: positiveFinite(stock?.widthMm) ?? defaults.stock.widthMm,
      lengthMm: positiveFinite(stock?.lengthMm) ?? defaults.stock.lengthMm,
      thicknessMm: positiveFinite(stock?.thicknessMm) ?? defaults.stock.thicknessMm,
      originX: finiteNumber(stock?.originX) ?? defaults.stock.originX,
      originY: finiteNumber(stock?.originY) ?? defaults.stock.originY,
      topZMm: finiteNumber(stock?.topZMm) ?? defaults.stock.topZMm,
      material: nonEmptyString(stock?.material) ?? defaults.stock.material
    },
    entryHoleDiameterMm:
      positiveFinite(candidate?.entryHoleDiameterMm) ?? defaults.entryHoleDiameterMm,
    visualPlaybackSpeed:
      positiveFinite(candidate?.visualPlaybackSpeed) ?? defaults.visualPlaybackSpeed
  };
}

export function normalizeWorkbenchSimulationSettings(
  value: unknown,
  machineProfiles: readonly MachineProfile[]
): WorkbenchSimulationSettings {
  const candidate = record(value);
  const machines = record(candidate?.machines);

  return {
    schemaVersion: SIMULATION_SCHEMA_VERSION,
    renderingQuality: renderingQuality(candidate?.renderingQuality),
    machines: Object.fromEntries(
      machineProfiles.map((profile) => [
        profile.id,
        normalizeMachineSimulationSettings(machines?.[profile.id])
      ])
    )
  };
}

function defaultStock(
  project: WorkbenchProject,
  bounds: Bounds2 | null | undefined
): ProjectSimulationStock {
  if (validBounds(bounds)) {
    return {
      widthMm: bounds.maxX - bounds.minX + STOCK_PADDING_MM * 2,
      lengthMm: bounds.maxY - bounds.minY + STOCK_PADDING_MM * 2,
      thicknessMm: DEFAULT_STOCK_THICKNESS_MM,
      originX: bounds.minX - STOCK_PADDING_MM,
      originY: bounds.minY - STOCK_PADDING_MM,
      topZMm: 0,
      material: DEFAULT_STOCK_MATERIAL
    };
  }

  return {
    widthMm: positiveFinite(project.machine.workArea.widthMm) ?? DEFAULT_STOCK_WIDTH_MM,
    lengthMm: positiveFinite(project.machine.workArea.lengthMm) ?? DEFAULT_STOCK_LENGTH_MM,
    thicknessMm: DEFAULT_STOCK_THICKNESS_MM,
    originX: 0,
    originY: 0,
    topZMm: 0,
    material: DEFAULT_STOCK_MATERIAL
  };
}

function normalizeMachineSimulationSettings(value: unknown): MachineSimulationSettings {
  const candidate = record(value);

  return {
    upperGuideZMm:
      finiteNumber(candidate?.upperGuideZMm) ?? DEFAULT_MACHINE_SIMULATION_SETTINGS.upperGuideZMm,
    lowerGuideZMm:
      finiteNumber(candidate?.lowerGuideZMm) ?? DEFAULT_MACHINE_SIMULATION_SETTINGS.lowerGuideZMm,
    tankDepthMm:
      positiveFinite(candidate?.tankDepthMm) ?? DEFAULT_MACHINE_SIMULATION_SETTINGS.tankDepthMm,
    defaultWireDiameterMm:
      positiveFinite(candidate?.defaultWireDiameterMm)
      ?? DEFAULT_MACHINE_SIMULATION_SETTINGS.defaultWireDiameterMm,
    fixtureClearanceMm:
      positiveFinite(candidate?.fixtureClearanceMm)
      ?? DEFAULT_MACHINE_SIMULATION_SETTINGS.fixtureClearanceMm
  };
}

function renderingQuality(value: unknown): SimulationRenderingQuality {
  return value === 'performance' || value === 'quality' || value === 'balanced'
    ? value
    : 'balanced';
}

function validBounds(value: Bounds2 | null | undefined): value is Bounds2 {
  return Boolean(
    value
    && [value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite)
    && value.minX <= value.maxX
    && value.minY <= value.maxY
  );
}

function positiveFinite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
