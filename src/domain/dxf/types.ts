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

export interface DxfDrawingUnits {
  source: 'dxf-insunits';
  code: number;
  label: string;
  scaleToMillimeters: number | null;
}

export interface DxfLineEntity {
  type: 'line';
  handle?: string | null;
  layer: string | null;
  source?: DxfEntitySource;
  start: DxfPoint;
  end: DxfPoint;
}

export interface DxfArcEntity {
  type: 'arc';
  handle?: string | null;
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
  handle?: string | null;
  layer: string | null;
  source?: DxfEntitySource;
  center: DxfPoint;
  radius: number;
}

export interface DxfLwPolylineVertex extends DxfPoint {
  bulge: number;
}

export interface DxfPolylineVertex extends DxfPoint {
  bulge: number;
}

export interface DxfLwPolylineEntity {
  type: 'lwpolyline';
  handle?: string | null;
  layer: string | null;
  source?: DxfEntitySource;
  closed: boolean;
  vertices: DxfLwPolylineVertex[];
}

export interface DxfPolylineEntity {
  type: 'polyline';
  handle?: string | null;
  layer: string | null;
  source?: DxfEntitySource;
  closed: boolean;
  vertices: DxfPolylineVertex[];
}

export type DxfEntity =
  | DxfLineEntity
  | DxfArcEntity
  | DxfCircleEntity
  | DxfLwPolylineEntity
  | DxfPolylineEntity;

export interface DxfParseResult {
  entities: DxfEntity[];
  units?: DxfDrawingUnits;
  unsupportedEntities: string[];
  warnings: string[];
}
