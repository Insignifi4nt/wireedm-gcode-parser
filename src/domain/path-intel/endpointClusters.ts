import { distance, endpointKey, getSegmentEnd, getSegmentStart, pointsEqual } from './segments';
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
  const clusters = materializeClusters(exactGroups, joinedPairs, resolved.endpointTolerance, diagnostics);
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
  const used = new Set<number>();

  for (let index = 0; index < samples.length; index++) {
    if (used.has(index)) continue;
    const members = [samples[index]];
    used.add(index);

    for (let otherIndex = index + 1; otherIndex < samples.length; otherIndex++) {
      if (used.has(otherIndex)) continue;
      if (pointsEqual(samples[index].point, samples[otherIndex].point, epsilon)) {
        members.push(samples[otherIndex]);
        used.add(otherIndex);
      }
    }

    groups.push({
      id: `exact_${groups.length}`,
      members,
      point: centroid(members.map((member) => member.point))
    });
  }

  return groups;
}

function buildNearCandidates(groups: EndpointGroup[], tolerance: number, epsilon: number) {
  const candidates = new Map<number, NearCandidate[]>();

  for (let index = 0; index < groups.length; index++) {
    candidates.set(index, []);
  }

  for (let index = 0; index < groups.length; index++) {
    for (let otherIndex = index + 1; otherIndex < groups.length; otherIndex++) {
      const gap = distance(groups[index].point, groups[otherIndex].point);
      if (groupsShareSegment(groups[index], groups[otherIndex])) continue;
      if (gap <= epsilon || gap > tolerance) continue;
      candidates.get(index)?.push({ otherIndex, distance: gap });
      candidates.get(otherIndex)?.push({ otherIndex: index, distance: gap });
    }
  }

  for (const value of candidates.values()) {
    value.sort((a, b) => a.distance - b.distance || a.otherIndex - b.otherIndex);
  }

  return candidates;
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
  const pairs: Array<[number, number]> = [];
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

    pairs.push([index, candidate.otherIndex]);
    used.add(index);
    used.add(candidate.otherIndex);
  }

  return pairs;
}

function materializeClusters(
  exactGroups: EndpointGroup[],
  joinedPairs: Array<[number, number]>,
  tolerance: number,
  diagnostics: PathDiagnostic[]
) {
  const consumed = new Set<number>();
  const clusters: EndpointCluster[] = [];

  for (const [left, right] of joinedPairs) {
    consumed.add(left);
    consumed.add(right);
    const members = [...exactGroups[left].members, ...exactGroups[right].members];
    const cluster = buildCluster(`ec_unsorted_${clusters.length}`, members, 'within-tolerance', tolerance);
    diagnostics.push({
      id: `diag_cluster_${String(diagnostics.length + 1).padStart(4, '0')}`,
      severity: 'warning',
      code: 'endpoint-cluster-snap',
      message: `Joined one unique reciprocal endpoint pair within tolerance; max endpoint gap is ${format(cluster.maxPairDistance)}.`,
      relatedSegmentIds: [...new Set(members.map((member) => member.ref.segmentId))],
      relatedClusterIds: [cluster.id],
      details: {
        tolerance,
        maxPairDistance: cluster.maxPairDistance,
        point: cluster.point
      }
    });
    clusters.push(cluster);
  }

  exactGroups.forEach((group, index) => {
    if (consumed.has(index)) return;
    clusters.push(buildCluster(`ec_unsorted_${clusters.length}`, group.members, 'exact', tolerance));
  });

  return clusters.sort((a, b) => a.point.x - b.point.x || a.point.y - b.point.y || a.id.localeCompare(b.id));
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
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length
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
