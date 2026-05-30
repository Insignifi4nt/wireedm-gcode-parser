export interface GCodeLinearPathPoint {
  type: 'position' | 'rapid' | 'cut';
  x: number;
  y: number;
  line: number;
  meta?: Record<string, string>;
}

export interface GCodeArcPathPoint {
  type: 'arc';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  centerX: number;
  centerY: number;
  clockwise: boolean;
  line: number;
}

export type GCodePathPoint = GCodeLinearPathPoint | GCodeArcPathPoint;

export interface GCodeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface GCodeParseIssue {
  line: number;
  message: string;
  type: 'error' | 'warning';
}

export interface GCodeParseStats {
  totalLines: number;
  processedLines: number;
  linearMoves: number;
  arcMoves: number;
  comments: number;
  errors: number;
}

export interface GCodeParseResult {
  path: GCodePathPoint[];
  bounds: GCodeBounds;
  stats: GCodeParseStats;
  errors: GCodeParseIssue[];
  warnings: GCodeParseIssue[];
}
