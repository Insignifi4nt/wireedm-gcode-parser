import type { WireEdmExecutionEvent, WireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import type { Point2 } from '@/domain/path-intel/types';

export interface SimulationStock {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  readonly bottomZ: number;
}

/** Local viewing assumptions; these are never controller feeds or saved machining intent. */
export interface SimulationSettings {
  readonly stock: SimulationStock;
  readonly wireDiameter: number;
  readonly cutSpeedMmPerSecond: number;
  readonly rapidSpeedMmPerSecond: number;
  readonly eventHoldSeconds?: number;
  readonly retention?: 'fall' | 'retain';
  readonly supportFloorZ?: number | null;
  readonly guideClearanceMm?: number;
  /** Approximate horizontal guide envelope at each end of the vertical wire. */
  readonly guideRadiusMm?: number;
}

export interface ResolvedSimulationSettings extends SimulationSettings {
  readonly eventHoldSeconds: number;
  readonly retention: 'fall' | 'retain';
  readonly supportFloorZ: number | null;
  readonly guideClearanceMm: number;
  readonly guideRadiusMm: number;
}

export interface SimulationDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly operationId: string | null;
}

export interface SimulationStep {
  readonly event: WireEdmExecutionEvent;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly lengthMm: number;
  /** Rendering polyline. Playback itself interpolates source lines/arcs exactly. */
  readonly path: readonly Point2[];
  readonly wireThreaded: boolean;
}

export interface SimulationPiece {
  readonly id: string;
  readonly operationId: string;
  readonly polygon: readonly Point2[];
  readonly releaseSeconds: number;
  readonly releaseEventId: string;
  readonly parentPieceId: string | null;
}

export interface SimulationWarning {
  readonly id: string;
  readonly code: 'SIMULATION_UNCUT_STOCK_OBSTRUCTION' | 'SIMULATION_RELEASED_PIECE_OBSTRUCTION';
  readonly message: string;
  readonly elapsedSeconds: number;
  readonly eventId: string;
  readonly operationId: string | null;
  readonly pieceId: string | null;
  readonly envelope: 'wire' | 'guide';
  readonly point: Point2;
}

export interface SimulationPlan {
  readonly format: 'wire-edm-simulation';
  readonly settings: ResolvedSimulationSettings;
  readonly executionPlan: WireEdmExecutionPlan;
  readonly machiningDurationSeconds: number;
  readonly durationSeconds: number;
  readonly steps: readonly SimulationStep[];
  readonly pieces: readonly SimulationPiece[];
  readonly diagnostics: readonly SimulationDiagnostic[];
  readonly warnings: readonly SimulationWarning[];
}

export type SimulationCompileResult =
  | { readonly ok: true; readonly plan: SimulationPlan }
  | { readonly ok: false; readonly diagnostics: readonly SimulationDiagnostic[] };

export interface SimulationPieceSnapshot {
  readonly id: string;
  readonly operationId: string;
  readonly polygon: readonly Point2[];
  readonly holes: readonly (readonly Point2[])[];
  readonly bottomZ: number;
  readonly topZ: number;
  readonly state: 'retained' | 'falling' | 'supported';
}

export interface SimulationSnapshot {
  readonly elapsedSeconds: number;
  readonly progress: number;
  readonly phase: 'cutting' | 'positioning' | 'paused' | 'rethreading' | 'idle' | 'complete';
  readonly activeEventId: string | null;
  readonly operationId: string | null;
  readonly wire: {
    readonly point: Point2;
    readonly bottomZ: number;
    readonly topZ: number;
    readonly threaded: boolean;
    readonly cutting: boolean;
  };
  readonly completedStepCount: number;
  readonly activeStepIndex: number | null;
  readonly activeStepFraction: number;
  readonly stockHoles: readonly (readonly Point2[])[];
  readonly pieces: readonly SimulationPieceSnapshot[];
  /** Cumulative findings up to this seek position; not a safety certification. */
  readonly warnings: readonly SimulationWarning[];
}
