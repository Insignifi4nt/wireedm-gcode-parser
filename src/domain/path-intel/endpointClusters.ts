import { distance, endpointKey, getSegmentEnd, getSegmentStart } from './segments';
import { SpatialHash } from './spatialIndex';
import type {
  EndpointCluster,
  EndpointClusterMember,
  EndpointClusterResult,
  EndpointRef,
  PathDiagnostic,
  PathPlanningOptions,
  PathSegment,
  Point2
} from './types';
import { resolvePathPlanningOptions } from './segments';

interface EndpointSample {
  ref: EndpointRef;
  point: Point2;
}

interface EndpointGroup {
  id: string;
  members: EndpointSample[];
  point: Point2;
}

interface NearCandidate {
  otherIndex: number;
  distance: number;
  toleranceUsed: number;
}

interface JoinedPair {
  left: number;
  right: number;
  toleranceUsed: number;
}

export function clusterSegmentEndpoints(
  segments: PathSegment[],
  options: PathPlanningOptions = {}
): EndpointClusterResult {
  const resolved = resolvePathPlanningOptions(options);
  const samples = collectEndpointSamples(segments);
  const exactGroups = buildExactGroups(samples, resolved.coincidenceEpsilon);
  const nearCandidates = buildNearCandidates(exactGroups, resolved.endpointTolerance, resolved.coincidenceEpsilon);
  const diagnostics: PathDiagnostic[] = [];
  const joinedPairs = chooseUniqueReciprocalPairs(exactGroups, nearCandidates, diagnostics, resolved.endpointTolerance);
  const clusters = materializeClusters(
    exactGroups,
    joinedPairs,
    resolved.coincidenceEpsilon,
    diagnostics
  );
  const endpointToCluster: Record<string, string> = {};

  clusters.forEach((cluster, index) => {
    const oldId = cluster.id;
    cluster.id = `ec_${String(index + 1).padStart(4, '0')}`;
    diagnostics.forEach((diagnostic) => {
      diagnostic.relatedClusterIds = diagnostic.relatedClusterIds?.map((id) => (id === oldId ? cluster.id : id));
    });
    for (const member of cluster.members) {
      endpointToCluster[endpointKey(member.segmentId, member.side)] = cluster.id;
    }
  });

  return { clusters, endpointToCluster, diagnostics };
}

function collectEndpointSamples(segments: PathSegment[]): EndpointSample[] {
  const samples: EndpointSample[] = [];

  for (const segment of segments) {
    if (segment.kind === 'circle') continue;

    samples.push({
      ref: { segmentId: segment.id, side: 'start' },
      point: getSegmentStart(segment)
    });
    samples.push({
      ref: { segmentId: segment.id, side: 'end' },
      point: getSegmentEnd(segment)
    });
  }

  return samples;
}

function buildExactGroups(samples: EndpointSample[], epsilon: number) {
  const groups: EndpointGroup[] = [];
  const memberIndex = new SpatialHash<number>({
    cellSize: positiveCellSize(epsilon),
    maxCellsPerBounds: 16
  });

  for (const sample of samples) {
    const candidateGroupIndices = [
      ...new Set(
        memberIndex.queryBounds(expandPoint(sample.point, epsilon))
      )
    ].sort((left, right) => left - right);
    const groupIndex = candidateGroupIndices.find((candidateIndex) =>
      groups[candidateIndex].members.every(
        (member) => distance(member.point, sample.point) <= epsilon
      )
    );

    if (groupIndex == null) {
      const nextIndex = groups.length;
      groups.push({
        id: `exact_${nextIndex}`,
        members: [sample],
        point: sample.point
      });
      memberIndex.insertPoint(sample.point, nextIndex);
      continue;
    }

    const group = groups[groupIndex];
    group.members.push(sample);
    group.point = centroid(group.members.map((member) => member.point));
    memberIndex.insertPoint(sample.point, groupIndex);
  }

  return groups;
}

function buildNearCandidates(groups: EndpointGroup[], tolerance: number, epsilon: number) {
  const candidates = new Map<number, NearCandidate[]>();

  for (let index = 0; index < groups.length; index++) {
    candidates.set(index, []);
  }

  const componentwiseCoincidenceTolerance = Math.SQRT2 * epsilon;
  const searchTolerance = Math.max(tolerance, componentwiseCoincidenceTolerance);
  if (searchTolerance <= epsilon || searchTolerance <= 0) return candidates;

  const groupIndex = new SpatialHash<number>({
    cellSize: positiveCellSize(searchTolerance),
    maxCellsPerBounds: 16
  });

  for (let index = 0; index < groups.length; index++) {
    const nearbyIndices = groupIndex.queryBounds(
      expandPoint(groups[index].point, searchTolerance)
    );
    for (const otherIndex of nearbyIndices) {
      const gap = distance(groups[index].point, groups[otherIndex].point);
      if (groupsShareSegment(groups[index], groups[otherIndex])) continue;
      if (gap <= epsilon) continue;
      const withinEndpointTolerance = gap <= tolerance;
      const withinComponentwiseCoincidence = pointsWithinComponentwiseEpsilon(
        groups[index].point,
        groups[otherIndex].point,
        epsilon
      );
      if (!withinEndpointTolerance && !withinComponentwiseCoincidence) continue;
      const toleranceUsed = withinEndpointTolerance
        ? tolerance
        : componentwiseCoincidenceTolerance;
      candidates.get(index)?.push({ otherIndex, distance: gap, toleranceUsed });
      candidates
        .get(otherIndex)
        ?.push({ otherIndex: index, distance: gap, toleranceUsed });
    }
    groupIndex.insertPoint(groups[index].point, index);
  }

  for (const value of candidates.values()) {
    value.sort((a, b) => a.distance - b.distance || a.otherIndex - b.otherIndex);
  }

  return candidates;
}

function positiveCellSize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function expandPoint(point: Point2, amount: number) {
  return {
    minX: point.x - amount,
    minY: point.y - amount,
    maxX: point.x + amount,
    maxY: point.y + amount
  };
}

function groupsShareSegment(left: EndpointGroup, right: EndpointGroup) {
  const leftSegmentIds = new Set(left.members.map((member) => member.ref.segmentId));
  return right.members.some((member) => leftSegmentIds.has(member.ref.segmentId));
}

function chooseUniqueReciprocalPairs(
  groups: EndpointGroup[],
  candidates: Map<number, NearCandidate[]>,
  diagnostics: PathDiagnostic[],
  tolerance: number
) {
  const pairs: JoinedPair[] = [];
  const used = new Set<number>();

  for (let index = 0; index < groups.length; index++) {
    if (used.has(index)) continue;
    const ownCandidates = candidates.get(index) ?? [];
    if (ownCandidates.length === 0) continue;

    if (groups[index].members.length !== 1 || hasNearestTie(ownCandidates)) {
      diagnostics.push(ambiguousEndpointDiagnostic(diagnostics.length, groups[index], ownCandidates, groups, tolerance));
      continue;
    }

    const candidate = ownCandidates[0];
    if (used.has(candidate.otherIndex)) continue;
    const otherCandidates = candidates.get(candidate.otherIndex) ?? [];

    if (
      groups[candidate.otherIndex].members.length !== 1 ||
      hasNearestTie(otherCandidates) ||
      otherCandidates[0]?.otherIndex !== index
    ) {
      diagnostics.push(
        ambiguousEndpointDiagnostic(diagnostics.length, groups[index], ownCandidates, groups, tolerance)
      );
      continue;
    }

    pairs.push({
      left: index,
      right: candidate.otherIndex,
      toleranceUsed: Math.max(candidate.toleranceUsed, otherCandidates[0].toleranceUsed)
    });
    used.add(index);
    used.add(candidate.otherIndex);
  }

  return pairs;
}

function materializeClusters(
  exactGroups: EndpointGroup[],
  joinedPairs: JoinedPair[],
  exactTolerance: number,
  diagnostics: PathDiagnostic[]
) {
  const consumed = new Set<number>();
  const clusters: EndpointCluster[] = [];

  for (const { left, right, toleranceUsed } of joinedPairs) {
    consumed.add(left);
    consumed.add(right);
    const members = [...exactGroups[left].members, ...exactGroups[right].members];
    const cluster = buildCluster(
      `ec_unsorted_${clusters.length}`,
      members,
      'within-tolerance',
      toleranceUsed
    );
    diagnostics.push({
      id: `diag_cluster_${String(diagnostics.length + 1).padStart(4, '0')}`,
      severity: 'warning',
      code: 'endpoint-cluster-snap',
      message: `Joined one unique reciprocal endpoint pair within tolerance; max endpoint gap is ${format(cluster.maxPairDistance)}.`,
      relatedSegmentIds: [...new Set(members.map((member) => member.ref.segmentId))],
      relatedClusterIds: [cluster.id],
      details: {
        tolerance: toleranceUsed,
        maxPairDistance: cluster.maxPairDistance,
        point: cluster.point
      }
    });
    clusters.push(cluster);
  }

  exactGroups.forEach((group, index) => {
    if (consumed.has(index)) return;
    clusters.push(
      buildCluster(
        `ec_unsorted_${clusters.length}`,
        group.members,
        'exact',
        exactTolerance
      )
    );
  });

  return clusters.sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y || a.id.localeCompare(b.id));
}

function pointsWithinComponentwiseEpsilon(left: Point2, right: Point2, epsilon: number) {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function buildCluster(
  id: string,
  samples: EndpointSample[],
  method: EndpointCluster['method'],
  tolerance: number
): EndpointCluster {
  const point = centroid(samples.map((sample) => sample.point));
  const maxPairDistance = pairDistance(samples.map((sample) => sample.point));
  const radius = samples.reduce((max, sample) => Math.max(max, distance(point, sample.point)), 0);
  const members: EndpointClusterMember[] = samples.map((sample) => ({
    ...sample.ref,
    point: sample.point
  }));

  return {
    id,
    point,
    members,
    method,
    toleranceUsed: tolerance,
    radius,
    maxPairDistance
  };
}

function ambiguousEndpointDiagnostic(
  index: number,
  group: EndpointGroup,
  candidates: NearCandidate[],
  groups: EndpointGroup[],
  tolerance: number
): PathDiagnostic {
  return {
    id: `diag_cluster_${String(index + 1).padStart(4, '0')}`,
    severity: 'warning',
    code: 'ambiguous-endpoint-cluster',
    message:
      'Skipped automatic endpoint snap because more than one near endpoint or an already connected endpoint could plausibly join.',
    relatedSegmentIds: [
      ...new Set([
        ...group.members.map((member) => member.ref.segmentId),
        ...candidates.flatMap((candidate) =>
          groups[candidate.otherIndex].members.map((member) => member.ref.segmentId)
        )
      ])
    ],
    details: {
      tolerance,
      candidateDistances: candidates.map((candidate) => candidate.distance)
    }
  };
}

function hasNearestTie(candidates: NearCandidate[]) {
  if (candidates.length < 2) return false;
  return Math.abs(candidates[0].distance - candidates[1].distance) <= 1e-12;
}

function centroid(points: Point2[]): Point2 {
  const anchor = points[0] ?? { x: 0, y: 0 };
  let meanOffsetX = 0;
  let meanOffsetY = 0;
  points.forEach((point, index) => {
    const count = index + 1;
    meanOffsetX += (point.x - anchor.x - meanOffsetX) / count;
    meanOffsetY += (point.y - anchor.y - meanOffsetY) / count;
  });
  return {
    x: anchor.x + meanOffsetX,
    y: anchor.y + meanOffsetY
  };
}

function pairDistance(points: Point2[]) {
  let max = 0;
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 1; second < points.length; second++) {
      max = Math.max(max, distance(points[first], points[second]));
    }
  }
  return max;
}

function format(value: number) {
  return Number(value.toFixed(9)).toString();
}
