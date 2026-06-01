export interface DxfPoint {
  x: number;
  y: number;
}

export interface DxfLineEntity {
  type: 'line';
  layer: string | null;
  start: DxfPoint;
  end: DxfPoint;
}

export interface DxfArcEntity {
  type: 'arc';
  layer: string | null;
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
  center: DxfPoint;
  radius: number;
}

export interface DxfLwPolylineVertex extends DxfPoint {
  bulge: number;
}

export interface DxfLwPolylineEntity {
  type: 'lwpolyline';
  layer: string | null;
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
