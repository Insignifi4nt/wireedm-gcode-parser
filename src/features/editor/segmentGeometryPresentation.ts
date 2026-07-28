import type { Point2 } from '@/domain/path-intel/types';
import type { UpidSelectedPathSegmentGeometry } from '@/domain/upid/projectRail';

export type SegmentGeometryPointKey =
  | 'center'
  | 'cut-start'
  | 'end'
  | 'end-side'
  | 'start'
  | 'start-side';

export interface SegmentGeometryPointPresentation {
  key: SegmentGeometryPointKey;
  label: string;
  point: Point2;
  selectableRole: 'center' | 'start' | 'end' | null;
}

export interface SegmentGeometryFieldPresentation {
  format: 'degrees' | 'number' | 'point';
  key: string;
  label: string;
  value: number | Point2;
}

export interface SegmentGeometrySummaryPresentation {
  direction?: 'CCW' | 'CW';
  length: number;
  lengthLabel: 'Arc length' | 'Circumference' | 'Length';
  radius?: number;
  sweepDegrees?: number;
}

export interface SegmentGeometryPresentation {
  advancedFields: SegmentGeometryFieldPresentation[];
  derivedFields: SegmentGeometryFieldPresentation[];
  kind: UpidSelectedPathSegmentGeometry['kind'];
  points: SegmentGeometryPointPresentation[];
  summary: SegmentGeometrySummaryPresentation;
}

export interface SegmentGeometryPresentationInput {
  end: Point2;
  geometry: UpidSelectedPathSegmentGeometry;
  length: number;
  showCircleClosureSides?: boolean;
  start: Point2;
}

export function buildSegmentGeometryPresentation({
  end,
  geometry,
  length,
  showCircleClosureSides = false,
  start
}: SegmentGeometryPresentationInput): SegmentGeometryPresentation {
  if (geometry.kind === 'line') {
    return {
      advancedFields: [
        {
          format: 'point',
          key: 'start-tangent',
          label: 'Start tangent',
          value: geometry.startTangent
        },
        {
          format: 'point',
          key: 'end-tangent',
          label: 'End tangent',
          value: geometry.endTangent
        }
      ],
      derivedFields: [
        { format: 'number', key: 'delta-x', label: 'ΔX', value: geometry.vector.x },
        { format: 'number', key: 'delta-y', label: 'ΔY', value: geometry.vector.y },
        {
          format: 'degrees',
          key: 'heading',
          label: 'Heading',
          value: geometry.headingDegrees
        }
      ],
      kind: geometry.kind,
      points: [
        { key: 'start', label: 'Start', point: start, selectableRole: 'start' },
        { key: 'end', label: 'End', point: end, selectableRole: 'end' }
      ],
      summary: {
        length,
        lengthLabel: 'Length'
      }
    };
  }

  if (geometry.kind === 'circle') {
    return {
      advancedFields: showCircleClosureSides
        ? [
            {
              format: 'degrees',
              key: 'start-angle',
              label: 'Start angle',
              value: geometry.startAngleDegrees
            },
            {
              format: 'degrees',
              key: 'end-angle',
              label: 'End angle',
              value: geometry.endAngleDegrees
            },
            {
              format: 'point',
              key: 'start-tangent',
              label: 'Start tangent',
              value: geometry.startTangent
            },
            {
              format: 'point',
              key: 'end-tangent',
              label: 'End tangent',
              value: geometry.endTangent
            }
          ]
        : [
            {
              format: 'degrees',
              key: 'start-angle',
              label: 'Start angle',
              value: geometry.startAngleDegrees
            },
            {
              format: 'point',
              key: 'start-tangent',
              label: 'Start tangent',
              value: geometry.startTangent
            }
          ],
      derivedFields: [],
      kind: geometry.kind,
      points: showCircleClosureSides
        ? [
            { key: 'center', label: 'Center', point: geometry.center, selectableRole: 'center' },
            {
              key: 'start-side',
              label: 'Start side',
              point: start,
              selectableRole: 'start'
            },
            { key: 'end-side', label: 'End side', point: end, selectableRole: 'end' }
          ]
        : [
            { key: 'center', label: 'Center', point: geometry.center, selectableRole: 'center' },
            { key: 'cut-start', label: 'Cut start', point: start, selectableRole: 'start' }
          ],
      summary: {
        direction: geometry.clockwise ? 'CW' : 'CCW',
        length,
        lengthLabel: 'Circumference',
        radius: geometry.radius
      }
    };
  }

  return {
    advancedFields: [
      {
        format: 'degrees',
        key: 'start-angle',
        label: 'Start angle',
        value: geometry.startAngleDegrees
      },
      {
        format: 'degrees',
        key: 'end-angle',
        label: 'End angle',
        value: geometry.endAngleDegrees
      },
      {
        format: 'point',
        key: 'start-tangent',
        label: 'Start tangent',
        value: geometry.startTangent
      },
      {
        format: 'point',
        key: 'end-tangent',
        label: 'End tangent',
        value: geometry.endTangent
      }
    ],
    derivedFields: [],
    kind: geometry.kind,
    points: [
      { key: 'start', label: 'Start', point: start, selectableRole: 'start' },
      { key: 'end', label: 'End', point: end, selectableRole: 'end' },
      { key: 'center', label: 'Center', point: geometry.center, selectableRole: 'center' }
    ],
    summary: {
      direction: geometry.clockwise ? 'CW' : 'CCW',
      length,
      lengthLabel: 'Arc length',
      radius: geometry.radius,
      sweepDegrees: geometry.sweepDegrees
    }
  };
}
