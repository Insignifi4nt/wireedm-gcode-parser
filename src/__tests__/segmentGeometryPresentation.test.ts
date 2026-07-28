import { describe, expect, it } from 'vitest';

import { buildSegmentGeometryPresentation } from '@/features/editor/segmentGeometryPresentation';

describe('segment geometry presentation', () => {
  it('presents a line using endpoints, deltas, heading, and length', () => {
    const presentation = buildSegmentGeometryPresentation({
      end: { x: 13, y: 8 },
      geometry: {
        endTangent: { x: 0.6, y: 0.8 },
        headingDegrees: 53.130102,
        kind: 'line',
        startTangent: { x: 0.6, y: 0.8 },
        vector: { x: 3, y: 4 }
      },
      length: 5,
      start: { x: 10, y: 4 }
    });

    expect(presentation.summary).toEqual({
      length: 5,
      lengthLabel: 'Length'
    });
    expect(presentation.points).toEqual([
      {
        key: 'start',
        label: 'Start',
        point: { x: 10, y: 4 },
        selectableRole: 'start'
      },
      {
        key: 'end',
        label: 'End',
        point: { x: 13, y: 8 },
        selectableRole: 'end'
      }
    ]);
    expect(presentation.derivedFields).toEqual([
      { format: 'number', key: 'delta-x', label: 'ΔX', value: 3 },
      { format: 'number', key: 'delta-y', label: 'ΔY', value: 4 },
      { format: 'degrees', key: 'heading', label: 'Heading', value: 53.130102 }
    ]);
  });

  it('presents an arc using its endpoints, center, radius, arc length, direction, and sweep', () => {
    const presentation = buildSegmentGeometryPresentation({
      end: { x: 0, y: 10 },
      geometry: {
        center: { x: 0, y: 0 },
        clockwise: false,
        endAngleDegrees: 90,
        endTangent: { x: -1, y: 0 },
        kind: 'arc',
        radius: 10,
        startAngleDegrees: 0,
        startTangent: { x: 0, y: 1 },
        sweepDegrees: 90,
        sweepRadians: Math.PI / 2
      },
      length: 15.707963,
      start: { x: 10, y: 0 }
    });

    expect(presentation.summary).toEqual({
      direction: 'CCW',
      length: 15.707963,
      lengthLabel: 'Arc length',
      radius: 10,
      sweepDegrees: 90
    });
    expect(presentation.points).toEqual([
      {
        key: 'start',
        label: 'Start',
        point: { x: 10, y: 0 },
        selectableRole: 'start'
      },
      {
        key: 'end',
        label: 'End',
        point: { x: 0, y: 10 },
        selectableRole: 'end'
      },
      {
        key: 'center',
        label: 'Center',
        point: { x: 0, y: 0 },
        selectableRole: 'center'
      }
    ]);
  });

  it('presents a clean circle using one cut start instead of duplicate endpoints or sweep', () => {
    const presentation = buildSegmentGeometryPresentation({
      end: { x: -80, y: -85 },
      geometry: {
        center: { x: -75, y: -85 },
        clockwise: false,
        endAngleDegrees: 180,
        endTangent: { x: 0, y: -1 },
        kind: 'circle',
        radius: 5,
        startAngleDegrees: 180,
        startTangent: { x: 0, y: -1 },
        sweepDegrees: 360,
        sweepRadians: Math.PI * 2
      },
      length: 31.415927,
      start: { x: -80, y: -85 }
    });

    expect(presentation.summary).toEqual({
      direction: 'CCW',
      length: 31.415927,
      lengthLabel: 'Circumference',
      radius: 5
    });
    expect(presentation.points).toEqual([
      {
        key: 'center',
        label: 'Center',
        point: { x: -75, y: -85 },
        selectableRole: 'center'
      },
      {
        key: 'cut-start',
        label: 'Cut start',
        point: { x: -80, y: -85 },
        selectableRole: 'start'
      }
    ]);
    expect(presentation.advancedFields).toEqual([
      { format: 'degrees', key: 'start-angle', label: 'Start angle', value: 180 },
      {
        format: 'point',
        key: 'start-tangent',
        label: 'Start tangent',
        value: { x: 0, y: -1 }
      }
    ]);
  });

  it('exposes both raw circle closure sides when topology needs attention', () => {
    const presentation = buildSegmentGeometryPresentation({
      end: { x: -79.996, y: -85 },
      geometry: {
        center: { x: -75, y: -85 },
        clockwise: true,
        endAngleDegrees: 180.045837,
        endTangent: { x: -0.0008, y: 1 },
        kind: 'circle',
        radius: 5,
        startAngleDegrees: 180,
        startTangent: { x: 0, y: 1 },
        sweepDegrees: 360,
        sweepRadians: Math.PI * 2
      },
      length: 31.415927,
      showCircleClosureSides: true,
      start: { x: -80, y: -85 }
    });

    expect(presentation.points).toEqual([
      {
        key: 'center',
        label: 'Center',
        point: { x: -75, y: -85 },
        selectableRole: 'center'
      },
      {
        key: 'start-side',
        label: 'Start side',
        point: { x: -80, y: -85 },
        selectableRole: 'start'
      },
      {
        key: 'end-side',
        label: 'End side',
        point: { x: -79.996, y: -85 },
        selectableRole: 'end'
      }
    ]);
    expect(presentation.advancedFields.map((field) => field.key)).toEqual([
      'start-angle',
      'end-angle',
      'start-tangent',
      'end-tangent'
    ]);
  });
});
