import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';

import { buildChains } from '../chains';
import { clusterSegmentEndpoints } from '../endpointClusters';
import { pathSegmentsFromDxfEntities } from '../fromDxfEntities';
import {
  classifyPathSegmentIntersection,
  findPathSegmentIntersectionDiagnostics,
  MAX_LISTED_SEGMENT_PAIRS,
  pathSegmentsMayOverlap
} from '../intersections';
import { sanitizePathSegments } from '../sanitizeSegments';
import { createLineSegment } from '../segments';
import type { PathDiagnostic } from '../types';

const source = { sourceEntityIndex: 0, sourceEntityType: 'line' as const, layer: 'CUT', exact: true };

describe('bounded segment pair analysis', () => {
  it('lists the first crossings and summarizes the rest without unblocking any chain', () => {
    const { segments, chains } = prepared(crosshatchEntities(40));
    const capped = findPathSegmentIntersectionDiagnostics(segments, chains);
    const complete = findPathSegmentIntersectionDiagnostics(segments, chains, {}, { maxListed: Infinity });

    expect(complete).toHaveLength(1_600);
    expect(capped).toHaveLength(MAX_LISTED_SEGMENT_PAIRS + 1);
    expect(capped.slice(0, MAX_LISTED_SEGMENT_PAIRS)).toEqual(complete.slice(0, MAX_LISTED_SEGMENT_PAIRS));
    expect(capped.at(-1)).toMatchObject({
      id: 'diag_intersection_1001',
      severity: 'error',
      code: 'intersecting-topology',
      details: { omittedPairCount: 600 }
    });
    // Blocking reads related segments and chains, so the capped list must block the same ones.
    expect(relatedIds(capped)).toEqual(relatedIds(complete));
    expect(findPathSegmentIntersectionDiagnostics(segments, chains)).toEqual(capped);
  });

  it('bounds overlap diagnostics for partial overlaps and keeps exact duplicates grouped', () => {
    const partial = Array.from({ length: 60 }, (_, index) => line(index * 0.5, 0, index * 0.5 + 100, 0));
    const duplicates = Array.from({ length: 5 }, () => line(0, 10, 50, 10));
    const segments = pathSegmentsFromDxfEntities([...partial, ...duplicates]).segments;
    const capped = sanitizePathSegments(segments);
    const complete = sanitizePathSegments(segments, {}, { maxListed: Infinity });
    const overlaps = (result: typeof capped) => result.diagnostics.filter(({ code }) => code === 'overlapping-segment');

    expect(overlaps(complete)).toHaveLength(1_770);
    expect(overlaps(capped)).toHaveLength(MAX_LISTED_SEGMENT_PAIRS + 1);
    expect(overlaps(capped).at(-1)).toMatchObject({ severity: 'error', details: { omittedPairCount: 770 } });
    expect(relatedIds(overlaps(capped)).segments).toEqual(relatedIds(overlaps(complete)).segments);
    expect(capped.segments).toEqual(complete.segments);
    expect(capped.diagnostics.filter(({ code }) => code === 'duplicate-segment')).toHaveLength(1);
    expect(capped.diagnostics.map(({ id }) => id)).toEqual(
      capped.diagnostics.map((_, index) => `diag_sanitize_${String(index + 1).padStart(4, '0')}`)
    );
  });

  it('skips only line pairs that the classifier cannot report as overlapping', () => {
    let random = 0x2f6b;
    const next = () => {
      random = (random * 1_103_515_245 + 12_345) % 2 ** 31;
      return random / 2 ** 31;
    };
    for (let index = 0; index < 20_000; index++) {
      const x = next() * 100;
      const y = next() * 100;
      const angle = next() * Math.PI;
      const turn = [0, 1e-18, 1e-16, 1e-15, 1e-14, 1e-9, next()][index % 7] * (next() < 0.5 ? -1 : 1);
      const left = createLineSegment({ id: 'left', source, start: { x, y }, end: { x: x + 10 * Math.cos(angle), y: y + 10 * Math.sin(angle) } });
      const offset = next() * 5;
      const start = { x: x + offset * Math.cos(angle), y: y + offset * Math.sin(angle) };
      const right = createLineSegment({ id: 'right', source, start, end: {
        x: start.x + 10 * Math.cos(angle + turn),
        y: start.y + 10 * Math.sin(angle + turn)
      } });
      if (pathSegmentsMayOverlap(left, right)) continue;
      expect(classifyPathSegmentIntersection(left, right, 1e-5).kind).not.toBe('overlap');
    }
  });

  it('validates a saved crosshatch against its summary and reports unrecorded crossings in bounded form', () => {
    const document = createUpidFromDxfEntities(crosshatchEntities(40));
    const recorded = document.diagnostics.filter(({ code }) => code === 'intersecting-topology');
    expect(recorded).toHaveLength(MAX_LISTED_SEGMENT_PAIRS + 1);

    const validation = validateUpidDocument(document);
    expect(validation.structurallyValid).toBe(true);
    expect(validation.diagnostics.filter(({ id }) => id.startsWith('diag_upid_live_'))).toEqual([]);

    const recordedIds = new Set(recorded.map(({ id }) => id));
    const stripped = withoutDiagnostics(document, recordedIds);
    const live = validateUpidDocument(stripped).diagnostics.filter(({ id }) => id.startsWith('diag_upid_live_'));
    expect(live.filter(({ code }) => code === 'intersecting-topology')).toHaveLength(MAX_LISTED_SEGMENT_PAIRS + 1);
    expect(relatedIds(live).segments).toEqual(relatedIds(recorded).segments);
  });
});

function crosshatchEntities(count: number) {
  return Array.from({ length: count }, (_, index) => [
    line(0, index, count, index),
    line(index + 0.5, -1, index + 0.5, count)
  ]).flat();
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return { type: 'line' as const, layer: 'CUT', start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

function prepared(entities: ReturnType<typeof line>[]) {
  const segments = sanitizePathSegments(pathSegmentsFromDxfEntities(entities).segments).segments;
  return { segments, chains: buildChains(segments, clusterSegmentEndpoints(segments)).chains };
}

function relatedIds(diagnostics: PathDiagnostic[]) {
  return {
    segments: [...new Set(diagnostics.flatMap(({ relatedSegmentIds }) => relatedSegmentIds ?? []))].sort(),
    chains: [...new Set(diagnostics.flatMap(({ relatedChainIds }) => relatedChainIds ?? []))].sort()
  };
}

function withoutDiagnostics<Value>(value: Value, ids: Set<string>): Value {
  if (Array.isArray(value)) return value.map((entry) => withoutDiagnostics(entry, ids)) as Value;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (key === 'diagnostics' && Array.isArray(entry)) {
      return [[key, entry.filter((diagnostic: PathDiagnostic) => !ids.has(diagnostic.id))]];
    }
    if (key === 'diagnosticIds' && Array.isArray(entry)) return [[key, entry.filter((id: string) => !ids.has(id))]];
    return [[key, withoutDiagnostics(entry, ids)]];
  })) as Value;
}
