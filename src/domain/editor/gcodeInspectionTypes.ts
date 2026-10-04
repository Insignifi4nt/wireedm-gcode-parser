import type { GCodeInterpreterState } from './gcodeBlockInterpreter';
import type { GCodeParseIssue, GCodeParseResult } from './types';

export type GCodeCommandCoverage = 'modeled' | 'recognized-not-modeled' | 'controller-specific' | 'unknown';

/** Ephemeral preview context. It never changes saved interpreter profiles or source text. */
export interface GCodeInspectionOptions {
  readonly profile?: GCodeInterpreterState['profile'];
  readonly defaults?: {
    readonly units?: 'mm' | 'in';
    readonly xyMode?: 'absolute' | 'incremental';
    readonly ijMode?: 'absolute' | 'incremental';
    readonly initialPosition?: { readonly x: number; readonly y: number };
  };
  /** Exact-source descriptions are labels, not permission to execute an unknown command. */
  readonly commandDescriptions?: readonly {
    readonly code: string;
    readonly meaning: string;
    readonly scope: string;
  }[];
  /** Exact emitted-line context supplied by an adapter, never inferred from a filename. */
  readonly lineContexts?: readonly {
    readonly line: number;
    readonly ijMode?: 'absolute' | 'incremental';
    /** Exact post semantics cannot be represented by this nominal XY interpreter. */
    readonly previewUnsupported?: string;
    readonly commands?: readonly {
      readonly code: string;
      readonly meaning: string;
      readonly scope: string;
      /** Annotation only; it does not offset preview geometry or enable unknown motion. */
      readonly compensation?: 'off' | 'left' | 'right';
    }[];
  }[];
}

export interface GCodeCommandInspection {
  readonly code: string;
  readonly count: number;
  readonly sourceLines: readonly number[];
  readonly meaning: string;
  readonly coverage: GCodeCommandCoverage;
  readonly scope: string;
}

export interface GCodeModalSnapshot {
  readonly position: { readonly x: number; readonly y: number };
  readonly positionKnown: boolean;
  readonly units: 'mm' | 'in' | null;
  readonly xyMode: 'absolute' | 'incremental';
  readonly ijMode: 'absolute' | 'incremental';
  readonly motion: GCodeInterpreterState['motion'];
  readonly plane: 'XY' | 'XZ' | 'YZ';
  /** Annotation only: the preview never applies controller compensation. */
  readonly compensation: 'off' | 'left' | 'right' | 'unknown';
}

export interface GCodeLineInspection {
  readonly line: number;
  readonly text: string;
  readonly commands: readonly string[];
  readonly before: GCodeModalSnapshot;
  readonly after: GCodeModalSnapshot;
  readonly diagnostics: readonly GCodeParseIssue[];
  readonly previewStatus: 'motion' | 'position' | 'no-motion' | 'omitted';
}

export interface GCodeProgramInspection {
  readonly parseResult: GCodeParseResult;
  readonly commands: readonly GCodeCommandInspection[];
  readonly lines: readonly GCodeLineInspection[];
  readonly diagnostics: readonly GCodeParseIssue[];
  /** Explicit defaults plus existing legacy preview defaults, disclosed to readers. */
  readonly assumptions: readonly string[];
  readonly preview: {
    /** Complete means only the supported nominal XY subset, never controller execution. */
    readonly status: 'complete' | 'limited' | 'unavailable';
    readonly summary: string;
  };
}
