export interface DxfPoint {
  x: number;
  y: number;
}

export interface DxfInsertTransformSource {
  insertion: DxfPoint;
  localOffset?: DxfPoint;
  rotationDegrees: number;
  scaleX: number;
  scaleY: number;
}

export interface DxfInsertSource {
  blockName: string;
  column: number;
  row: number;
  layer: string | null;
  transform: DxfInsertTransformSource;
}

export interface DxfEntitySource {
  blockName: string | null;
  insertChain: DxfInsertSource[];
}

export interface DxfLineEntity {
  type: 'line';
  layer: string | null;
  source?: DxfEntitySource;
  start: DxfPoint;
  end: DxfPoint;
}

export interface DxfArcEntity {
  type: 'arc';
  layer: string | null;
  source?: DxfEntitySource;
  center: DxfPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  clockwise: boolean;
  start: DxfPoint;
  end: DxfPoint;
}

export interface DxfCircleEntity {
  type: 'circle';
  layer: string | null;
  source?: DxfEntitySource;
  center: DxfPoint;
  radius: number;
}

export interface DxfLwPolylineVertex extends DxfPoint {
  bulge: number;
}

export interface DxfLwPolylineEntity {
  type: 'lwpolyline';
  layer: string | null;
  source?: DxfEntitySource;
  closed: boolean;
  vertices: DxfLwPolylineVertex[];
}

export type DxfEntity =
  | DxfLineEntity
  | DxfArcEntity
  | DxfCircleEntity
  | DxfLwPolylineEntity;

export interface DxfParseResult {
  entities: DxfEntity[];
  unsupportedEntities: string[];
  warnings: string[];
}
