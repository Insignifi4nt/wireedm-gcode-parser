import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { PathDiagnostic } from '@/domain/path-intel/types';

import {
  composeUpidGCodeExport,
  createUpidFromDxfEntities,
  postUpidToGcode,
  type UniversalPathIntelligenceDocument
} from '../upidDocument';
import { validateUpidDocument } from '../validateUpidDocument';

describe('validateUpidDocument', () => {
  it('accepts a normal closed contour and a valid open G40 centreline', () => {
    const closed = closedDocument();
    const open = createUpidFromDxfEntities([line(0, 0, 10, 0)]);

    expect(validateUpidDocument(closed)).toMatchObject({
      structurallyValid: true,
      valid: true,
      blockingDiagnostics: [],
      structuralDiagnostics: []
    });
    expect(validateUpidDocument(open)).toMatchObject({
      structurallyValid: true,
      valid: true,
      blockingDiagnostics: [],
      structuralDiagnostics: []
    });
  });

  it.each(['missing', 'non-array'])(
    'rejects %s top-level diagnostics without throwing during composition',
    (variant) => {
      const document = closedDocument();
      if (variant === 'missing') {
        delete (document as unknown as Record<string, unknown>).diagnostics;
      } else {
        (document as unknown as Record<string, unknown>).diagnostics = null;
      }

      const report = validateUpidDocument(document);
      const compose = () =>
        composeUpidGCodeExport(document, {
          header: '%\nG90 G21 G17 G40',
          footer: 'M30\n%',
          lineEnding: 'lf'
        });

      expect(report.structurallyValid).toBe(false);
      expect(report.structuralDiagnostics).toContainEqual(
        expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
      );
      expect(compose).not.toThrow();
      expect(compose()).toMatchObject({
        canDownload: false,
        body: '',
        programOperations: []
      });
    }
  );

  it.each(['segments', 'endpointClusters', 'chains', 'contours', 'pathElements', 'operations'])(
    'rejects a null member in the %s collection without throwing',
    (collectionName) => {
      const document = closedDocument();
      const target =
        collectionName === 'operations'
          ? document.plan.operations
          : (document as unknown as Record<string, unknown[]>)[collectionName];
      target.push(null as never);

      let report: ReturnType<typeof validateUpidDocument> | undefined;
      expect(() => {
        report = validateUpidDocument(document);
      }).not.toThrow();
      expect(report?.structurallyValid).toBe(false);
      expect(report?.structuralDiagnostics).toContainEqual(
        expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
      );
    }
  );

  it.each([
    {
      label: 'endpoint-cluster member',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.endpointClusters[0].members.push(null as never);
      }
    },
    {
      label: 'contour child list',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.contours[0].childIds = 1 as never;
      }
    },
    {
      label: 'path-element child list',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.pathElements[0].childIds = 1 as never;
      }
    }
  ])('rejects a malformed nested %s without throwing', ({ mutate }) => {
    const document = closedDocument();
    mutate(document);

    let report: ReturnType<typeof validateUpidDocument> | undefined;
    expect(() => {
      report = validateUpidDocument(document);
    }).not.toThrow();
    expect(report?.structurallyValid).toBe(false);
    expect(report?.structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
    );
  });

  it.each([
    {
      label: 'segment',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.segments.push({ ...document.segments[0] });
      }
    },
    {
      label: 'endpoint cluster',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.endpointClusters.push(structuredClone(document.endpointClusters[0]));
      }
    },
    {
      label: 'chain',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.chains.push(structuredClone(document.chains[0]));
      }
    },
    {
      label: 'contour',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.contours.push(structuredClone(document.contours[0]));
      }
    },
    {
      label: 'path element',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.pathElements.push(structuredClone(document.pathElements[0]));
      }
    },
    {
      label: 'operation',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.plan.operations.push(structuredClone(document.plan.operations[0]));
      }
    },
    {
      label: 'diagnostic',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        const diagnostic: PathDiagnostic = {
          id: 'diag_duplicate_for_validation',
          severity: 'warning',
          code: 'open-chain',
          message: 'duplicate test diagnostic'
        };
        document.diagnostics.push(diagnostic, { ...diagnostic });
      }
    }
  ])('rejects duplicate IDs in the $label collection', ({ mutate }) => {
    const document = closedDocument();
    mutate(document);

    const report = validateUpidDocument(document);

    expect(report.structurallyValid).toBe(false);
    expect(report.valid).toBe(false);
    expect(report.structuralDiagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'upid-duplicate-id'
      })
    );
  });

  it.each([
    {
      label: 'endpoint member segment',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.endpointClusters[0].members[0].segmentId = 'seg_missing';
      }
    },
    {
      label: 'chain segment',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.chains[0].segmentRefs[0].segmentId = 'seg_missing';
      }
    },
    {
      label: 'chain endpoint cluster',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.chains[0].startClusterId = 'ec_missing';
      }
    },
    {
      label: 'contour chain',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.contours[0].chainId = 'chain_missing';
      }
    },
    {
      label: 'path-element contour',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.pathElements[0].contourId = 'contour_missing';
      }
    },
    {
      label: 'path-element chain',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.pathElements[0].chainId = 'chain_missing';
      }
    },
    {
      label: 'path-element operation',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.pathElements[0].operationId = 'op_missing';
      }
    },
    {
      label: 'operation contour',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.plan.operations[0].contourId = 'contour_missing';
      }
    },
    {
      label: 'operation chain',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.plan.operations[0].chainId = 'chain_missing';
      }
    },
    {
      label: 'operation segment',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.plan.operations[0].segmentRefs[0].segmentId = 'seg_missing';
      }
    },
    {
      label: 'root path element',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.rootPathElementIds[0] = 'path_missing';
      }
    },
    {
      label: 'diagnostic ID',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.chains[0].diagnosticIds.push('diag_missing');
      }
    }
  ])('rejects a missing $label reference', ({ mutate }) => {
    const document = closedDocument();
    mutate(document);

    const report = validateUpidDocument(document);

    expect(report.structurallyValid).toBe(false);
    expect(report.structuralDiagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'upid-missing-reference'
      })
    );
  });

  it.each([
    {
      label: 'source metadata',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.source.coordinateScaleToMillimeters = Number.POSITIVE_INFINITY;
      }
    },
    {
      label: 'planning option',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.options.endpointTolerance = Number.NaN;
      }
    },
    {
      label: 'segment point',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.segments[0].start.x = Number.NaN;
      }
    },
    {
      label: 'segment length',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.segments[0].length = Number.POSITIVE_INFINITY;
      }
    },
    {
      label: 'segment bounds',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.segments[0].bounds.maxY = Number.NEGATIVE_INFINITY;
      }
    },
    {
      label: 'endpoint cluster metric',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.endpointClusters[0].toleranceUsed = Number.NaN;
      }
    },
    {
      label: 'chain metric',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.chains[0].metrics.cutLength = Number.POSITIVE_INFINITY;
      }
    },
    {
      label: 'contour representative point',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.contours[0].representativePoint!.x = Number.NaN;
      }
    },
    {
      label: 'contour approximation point',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.contours[0].approximatePolygon[0].y = Number.POSITIVE_INFINITY;
      }
    },
    {
      label: 'operation metric',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.plan.operations[0].metrics.rapidInLength = Number.NaN;
      }
    },
    {
      label: 'path-element point',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.pathElements[0].points[0].point.x = Number.NEGATIVE_INFINITY;
      }
    },
    {
      label: 'plan metric',
      mutate: (document: UniversalPathIntelligenceDocument) => {
        document.plan.metrics.totalCutLength = Number.NaN;
      }
    }
  ])('rejects a non-finite $label', ({ mutate }) => {
    const document = closedDocument();
    mutate(document);

    const report = validateUpidDocument(document);

    expect(report.structurallyValid).toBe(false);
    expect(report.structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
    );
  });

  it('rejects non-finite arc centers, radii, angles, and sweeps', () => {
    const arcDocument = createUpidFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 1,
        startAngle: 0,
        endAngle: 90,
        clockwise: false,
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 }
      }
    ]);

    for (const mutate of [
      (document: UniversalPathIntelligenceDocument) => {
        const segment = document.segments[0];
        if (segment.kind === 'arc') segment.center.x = Number.NaN;
      },
      (document: UniversalPathIntelligenceDocument) => {
        const segment = document.segments[0];
        if (segment.kind === 'arc') segment.radius = Number.POSITIVE_INFINITY;
      },
      (document: UniversalPathIntelligenceDocument) => {
        const segment = document.segments[0];
        if (segment.kind === 'arc') segment.startAngleRadians = Number.NaN;
      },
      (document: UniversalPathIntelligenceDocument) => {
        const segment = document.segments[0];
        if (segment.kind === 'arc') segment.sweepRadians = Number.NEGATIVE_INFINITY;
      }
    ]) {
      const document = structuredClone(arcDocument);
      mutate(document);
      expect(validateUpidDocument(document).structurallyValid).toBe(false);
    }
  });

  it('rejects finite circular fields whose center, radius, and endpoints are not executable', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 1,
        startAngle: 0,
        endAngle: 90,
        clockwise: false,
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 }
      }
    ]);
    const segment = document.segments[0];
    if (segment.kind !== 'arc') throw new Error('Expected test arc.');
    segment.center = { x: 1, y: 0 };

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
    );
  });

  it('rejects stored arc angles and sweep that disagree with executable endpoints', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 1,
        startAngle: 0,
        endAngle: 90,
        clockwise: false,
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 }
      }
    ]);
    const segment = document.segments[0];
    if (segment.kind !== 'arc') throw new Error('Expected test arc.');
    segment.sweepRadians = (3 * Math.PI) / 2;

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects an operation endpoint that disagrees with its oriented segment refs', () => {
    const document = closedDocument();
    document.plan.operations[0].startPoint = { x: 99, y: 99 };

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects unsupported schema/source/options values', () => {
    const unsupportedSchema = closedDocument();
    (unsupportedSchema as unknown as { schemaVersion: number }).schemaVersion = 2;
    const invalidSource = closedDocument();
    invalidSource.source.entityCount = -1;
    const invalidOptions = closedDocument();
    invalidOptions.options.operationOrderStrategy = 'unsafe-order' as never;

    expect(validateUpidDocument(unsupportedSchema).structurallyValid).toBe(false);
    expect(validateUpidDocument(invalidSource).structurallyValid).toBe(false);
    expect(validateUpidDocument(invalidOptions).structurallyValid).toBe(false);
  });

  it('rejects chain, contour, path-element, and operation identity disagreement', () => {
    const document = closedDocument();
    document.pathElements[0].segmentRefs[0].reversed =
      !document.pathElements[0].segmentRefs[0].reversed;

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects a chain endpoint that names the wrong existing cluster', () => {
    const document = closedDocument();
    const chain = document.chains[0];
    const wrongCluster = document.endpointClusters.find(
      (cluster) => cluster.id !== chain.startClusterId
    )!;
    chain.startClusterId = wrongCluster.id;

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects an inflated recorded healing tolerance and stale cluster metrics', () => {
    const document = createUpidFromDxfEntities(
      [
        line(0, 0, 10, 0),
        line(10.004, 0, 10, 5),
        line(10, 5, 0, 5),
        line(0, 5, 0, 0)
      ],
      { endpointTolerance: 0.01, coincidenceEpsilon: 0.000001 }
    );
    const healedCluster = document.endpointClusters.find(
      (cluster) => cluster.method === 'within-tolerance'
    )!;
    healedCluster.toleranceUsed = 0.1;
    healedCluster.maxPairDistance = 0;

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects path-element executable points that disagree with their operation', () => {
    const document = closedDocument();
    const startPoint = document.pathElements[0].points.find((point) => point.role === 'start')!;
    startPoint.point = { x: 99, y: 99 };

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects a path element missing its operation endpoint records', () => {
    const document = closedDocument();
    document.pathElements[0].points = document.pathElements[0].points.filter(
      (point) => point.role !== 'end'
    );

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it('rejects operation role metadata that disagrees with its contour', () => {
    const document = closedDocument();
    document.plan.operations[0].classification = 'hole';
    document.pathElements[0].classification = 'hole';

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
    );
  });

  it.each(['kind', 'duplicate-contour', 'unplanned-refs'])(
    'rejects incomplete path-element identity: %s',
    (variant) => {
      const document = closedDocument();
      const element = document.pathElements[0];
      if (variant === 'kind') {
        element.kind = 'open-chain';
      } else if (variant === 'duplicate-contour') {
        document.pathElements.push({
          ...structuredClone(element),
          id: 'path_duplicate_contour',
          operationId: null,
          orderIndex: null,
          direction: null,
          metrics: null
        });
      } else {
        document.plan.operations = [];
        document.plan.metrics = {
          operationCount: 0,
          totalCutLength: 0,
          totalRapidLength: 0
        };
        element.operationId = null;
        element.orderIndex = null;
        element.direction = null;
        element.metrics = null;
        element.segmentRefs[0].reversed = !element.segmentRefs[0].reversed;
      }

      expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
        expect.objectContaining({ code: 'upid-identity-mismatch', severity: 'error' })
      );
    }
  );

  it('rejects non-finite and missing live manual override values', () => {
    const nonFinite = closedDocument();
    const nonFiniteOperation = nonFinite.plan.operations[0];
    nonFiniteOperation.overrides = {
      start: {
        kind: 'manual',
        point: { x: Number.NaN, y: 0 },
        relation: 'existing-point',
        sourceSegmentId: nonFiniteOperation.segmentRefs[0].segmentId,
        sourceSegmentIndex: 0,
        createdSegmentIds: []
      }
    };
    nonFinite.pathElements[0].overrides = structuredClone(nonFiniteOperation.overrides);

    const missing = closedDocument();
    const missingOperation = missing.plan.operations[0];
    missingOperation.overrides = {
      leadIn: {
        kind: 'manual',
        move: 'cut',
        from: { x: 5, y: 2.5 },
        to: { ...missingOperation.startPoint },
        source: 'circle-center',
        sourceSegmentId: 'seg_missing',
        sourceSegmentIndex: 0
      }
    };
    missing.pathElements[0].overrides = structuredClone(missingOperation.overrides);

    expect(validateUpidDocument(nonFinite).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
    );
    expect(validateUpidDocument(missing).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-missing-reference', severity: 'error' })
    );
  });

  it('rejects a malformed manual-start created-segment list without throwing', () => {
    const document = closedDocument();
    const operation = document.plan.operations[0];
    operation.overrides = {
      start: {
        kind: 'manual',
        point: { ...operation.startPoint },
        relation: 'existing-point',
        sourceSegmentId: 'seg_missing',
        sourceSegmentIndex: 0,
        createdSegmentIds: 'bad' as never
      }
    };
    document.pathElements[0].overrides = structuredClone(operation.overrides);

    let report: ReturnType<typeof validateUpidDocument> | undefined;
    expect(() => {
      report = validateUpidDocument(document);
    }).not.toThrow();
    expect(report?.structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-invalid-value', severity: 'error' })
    );
  });

  it('rejects an oriented discontinuity inside an otherwise referenced operation', () => {
    const document = closedDocument();
    const refs = document.plan.operations[0].segmentRefs;
    [refs[1], refs[2]] = [refs[2], refs[1]];
    document.chains[0].segmentRefs = structuredClone(refs);
    document.pathElements[0].segmentRefs = structuredClone(refs);

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-discontinuity', severity: 'error' })
    );
  });

  it('rejects a closed operation whose final segment does not close to its start', () => {
    const document = closedDocument();
    const operation = document.plan.operations[0];
    const lastRef = operation.segmentRefs.at(-1)!;
    const lastSegment = document.segments.find((segment) => segment.id === lastRef.segmentId)!;
    lastSegment.end = { x: 0, y: 1 };
    lastSegment.bounds.maxY = 5;
    lastSegment.length = 4;
    const lastEndpoint = document.endpointClusters
      .flatMap((cluster) => cluster.members)
      .find((member) => member.segmentId === lastSegment.id && member.side === 'end')!;
    lastEndpoint.point = { x: 0, y: 1 };

    expect(validateUpidDocument(document).structuralDiagnostics).toContainEqual(
      expect.objectContaining({ code: 'upid-broken-closure', severity: 'error' })
    );
  });

  it.each([
    {
      label: 'branching',
      document: () =>
        createUpidFromDxfEntities([
          line(-1, 0, 0, 0),
          line(0, 0, 1, 0),
          line(0, 0, 0, 1)
        ])
    },
    {
      label: 'duplicate',
      document: () => createUpidFromDxfEntities([line(0, 0, 1, 0), line(0, 0, 1, 0)])
    },
    {
      label: 'overlap',
      document: () => createUpidFromDxfEntities([line(0, 0, 2, 0), line(1, 0, 3, 0)])
    },
    {
      label: 'intersection',
      document: () => createUpidFromDxfEntities([line(-1, 0, 1, 0), line(0, -1, 0, 1)])
    },
    {
      label: 'non-finite geometry diagnostic',
      document: () =>
        createUpidFromDxfEntities([line(Number.POSITIVE_INFINITY, 0, 1, 0)])
    }
  ])('keeps a structurally sound $label document inspectable but export-invalid', ({ document }) => {
    const report = validateUpidDocument(document());

    expect(report.structurallyValid).toBe(true);
    expect(report.valid).toBe(false);
    expect(report.blockingDiagnostics.length).toBeGreaterThan(0);
    expect(report.blockingDiagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(new Set(report.blockingDiagnostics.map((diagnostic) => diagnostic.id)).size).toBe(
      report.blockingDiagnostics.length
    );
  });

  it('does not treat historical duplicate diagnostic segment IDs as broken live refs', () => {
    const document = createUpidFromDxfEntities([
      line(0, 0, 1, 0),
      line(0, 0, 1, 0)
    ]);
    const diagnostic = document.diagnostics.find((candidate) => candidate.code === 'duplicate-segment')!;

    expect(diagnostic.relatedSegmentIds?.some(
      (segmentId) => !document.segments.some((segment) => segment.id === segmentId)
    )).toBe(true);
    expect(validateUpidDocument(document)).toMatchObject({
      structurallyValid: true,
      valid: false
    });
  });

  it('accepts recorded within-tolerance compatibility joins without widening beyond the planner envelope', () => {
    const healed = createUpidFromDxfEntities(
      [
        line(0, 0, 10, 0),
        line(10.004, 0, 10, 5),
        line(10, 5, 0, 5),
        line(0, 5, 0, 0)
      ],
      { endpointTolerance: 0.01, coincidenceEpsilon: 0.000001 }
    );

    expect(validateUpidDocument(healed)).toMatchObject({
      structurallyValid: true,
      valid: true
    });

    const widened = structuredClone(healed);
    const second = widened.segments.find((segment) => segment.id === widened.chains[0].segmentRefs[1].segmentId)!;
    second.start.x += 0.02;
    expect(validateUpidDocument(widened).structurallyValid).toBe(false);
  });

  it('validates and posts the bundled z18f25 compatibility joins', () => {
    const filePath = join(process.cwd(), 'DXF-test-subjects/z18f25.dxf');
    const parsed = parseDxf(readFileSync(filePath, 'utf8'));
    const document = dxfEntitiesToUpidDocument(parsed.entities, {}, {
      drawing: parsed.drawing,
      units: parsed.units,
      fileName: 'z18f25.dxf'
    });
    const report = validateUpidDocument(document);
    const posted = postUpidToGcode(document);

    expect(document.segments).toHaveLength(72);
    expect(report.structuralDiagnostics).toEqual([]);
    expect(report).toMatchObject({ structurallyValid: true, valid: true });
    expect(posted.status).toBe('ready');
    expect(posted.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'post-unexpected-gap'
    );
    expect(posted.body.split('\n').filter((line) => line.startsWith('G0 '))).toHaveLength(1);
  });
});

function closedDocument() {
  return createUpidFromDxfEntities([
    line(0, 0, 10, 0),
    line(10, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ]);
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
