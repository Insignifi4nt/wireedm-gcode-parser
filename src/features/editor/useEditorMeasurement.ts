import { useCallback, useEffect, useMemo, useState } from 'react';
import { pickMeasurementPoint, type MeasurementPick } from '@/domain/editor/geometryMeasurement';
import { measureFeaturePair } from '@/domain/editor/geometryFeatureMeasurement';
import type { PathSegment, Point2 } from '@/domain/path-intel/types';

export type MeasurementRepeatMode = 'pair' | 'chain' | 'fixed';
type MeasurementPicks = [] | [MeasurementPick] | [MeasurementPick, MeasurementPick];

export function useEditorMeasurement(segments: readonly PathSegment[]) {
  const [picks, setPicks] = useState<MeasurementPicks>([]);
  const [hover, setHover] = useState<MeasurementPick | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [repeatMode, setRepeatMode] = useState<MeasurementRepeatMode>('pair');
  const [precision, setPrecision] = useState(3);
  const resolve = useCallback((cursor: Point2, worldUnitsPerPixel: number) => (
    pickMeasurementPoint({ segments, cursor, worldUnitsPerPixel, snapEnabled })
  ), [segments, snapEnabled]);
  const onHover = useCallback((cursor: Point2 | null, worldUnitsPerPixel: number) => {
    setHover(cursor ? resolve(cursor, worldUnitsPerPixel) : null);
  }, [resolve]);
  const onPick = useCallback((cursor: Point2, worldUnitsPerPixel: number) => {
    const picked = resolve(cursor, worldUnitsPerPixel);
    if (!picked) return;
    setPicks((previous) => {
      if (previous.length === 0) return [picked];
      if (previous.length === 1) return [previous[0], picked];
      if (repeatMode === 'fixed') return [previous[0], picked];
      if (repeatMode === 'chain') return [previous[1], picked];
      return [picked];
    });
    setHover(picked);
  }, [resolve, repeatMode]);
  const clear = useCallback(() => { setPicks([]); setHover(null); }, []);
  const featurePair = useMemo(() => {
    const first = picks[0];
    const second = picks[1] ?? hover;
    if (first?.kind !== 'geometry' || second?.kind !== 'geometry' || first.segmentId === second.segmentId) return null;
    const a = segments.find((segment) => segment.id === first.segmentId);
    const b = segments.find((segment) => segment.id === second.segmentId);
    return a && b ? measureFeaturePair(a, b) : null;
  }, [picks, hover, segments]);
  useEffect(clear, [segments, clear]);
  return { picks, hover, featurePair, snapEnabled, setSnapEnabled, repeatMode, setRepeatMode, precision, setPrecision, onHover, onPick, clear };
}

export type EditorMeasurementState = ReturnType<typeof useEditorMeasurement>;
