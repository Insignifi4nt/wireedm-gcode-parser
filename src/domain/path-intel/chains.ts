import {
  distance,
  dot,
  endpointKey,
  orientedSegmentEnd,
  orientedSegmentStart,
  pathCutLength,
  requiredSegment,
  segmentEndTangent,
  segmentMap,
  segmentStartTangent
} from './segments';
import type {
  ChainBuildResult,
  EndpointClusterId,
  EndpointClusterResult,
  EndpointSide,
  OrientedSegmentRef,
  PathChain,
  PathDiagnostic,
  PathPlanningOptions,
  PathSegment,
  SegmentId
} from './types';
import { resolvePathPlanningOptions } from './segments';

interface SegmentClusterPair {
  segmentId: SegmentId;
  startClusterId: EndpointClusterId;
  endClusterId: EndpointClusterId;
}

interface IncidentEndpoint {
  segmentId: SegmentId;
  side: EndpointSide;
}

export function buildChains(
  segments: PathSegment[],
  endpointClusters: EndpointClusterResult,
  options: PathPlanningOptions = {}
): ChainBuildResult {
  const resolved = resolvePathPlanningOptions(options);
  const segmentsById = segmentMap(segments);
  const diagnostics: PathDiagnostic[] = [];
  const segmentPairs = mapSegmentClusterPairs(segments, endpointClusters);
  const pairBySegmentId = new Map(segmentPairs.map((pair) => [pair.segmentId, pair]));
  const adjacency = buildAdjacency(segmentPairs);
  const unused = new Set(segmentPairs.map((pair) => pair.segmentId));
  const chains: PathChain[] = [];

  for (const [clusterId, incidents] of adjacency) {
    if (incidents.length > 2) {
      diagnostics.push({
        id: `diag_chain_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'branching-topology',
        message: `Endpoint cluster ${clusterId} touches ${incidents.length} segment endpoints; continuation needs review.`,
        relatedSegmentIds: [...new Set(incidents.map((incident) => incident.segmentId))],
        relatedClusterIds: [clusterId],
        details: { degree: incidents.length }
      });
    }
  }

  for (const circle of segments.filter((segment) => segment.kind === 'circle')) {
    chains.push({
      id: nextChainId(chains.length),
      kind: 'closed-contour',
      segmentRefs: [{ segmentId: circle.id, reversed: false }],
      closed: true,
      startClusterId: null,
      endClusterId: null,
      metrics: {
        segmentCount: 1,
        cutLength: circle.length,
        gapLength: 0
      },
      diagnosticIds: []
    });
  }

  while (unused.size > 0) {
    const start = chooseNextStart(unused, pairBySegmentId, adjacency);
    const walked = walkChain(start, {
      adjacency,
      pairBySegmentId,
      unused,
      diagnostics,
      segmentsById
    });
    const id = nextChainId(chains.length);
    const gapLength = chainGapLength(walked.refs, segmentsById, walked.closed);
    const diagnosticIds: string[] = [];

    if (!walked.closed) {
      const diagnostic: PathDiagnostic = {
        id: `diag_chain_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'open-chain',
        message: `Built an open chain with ${walked.refs.length} segment(s); it can be cut, but it is not a closed contour.`,
        relatedSegmentIds: walked.refs.map((ref) => ref.segmentId),
        relatedClusterIds: [walked.startClusterId, walked.endClusterId].filter(
          (clusterId): clusterId is EndpointClusterId => clusterId !== null
        )
      };
      diagnostics.push(diagnostic);
      diagnosticIds.push(diagnostic.id);
    }

    if (walked.closed && gapLength > resolved.coincidenceEpsilon) {
      const diagnostic: PathDiagnostic = {
        id: `diag_chain_${String(diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'closed-chain-gap',
        message: `Closed contour uses endpoint healing and has ${format(gapLength)} total geometric gap to bridge while posting.`,
        relatedSegmentIds: walked.refs.map((ref) => ref.segmentId),
        relatedClusterIds: [walked.startClusterId].filter(
          (clusterId): clusterId is EndpointClusterId => clusterId !== null
        ),
        details: { gapLength }
      };
      diagnostics.push(diagnostic);
      diagnosticIds.push(diagnostic.id);
    }

    chains.push({
      id,
      kind: walked.closed ? 'closed-contour' : 'open-chain',
      segmentRefs: walked.refs,
      closed: walked.closed,
      startClusterId: walked.startClusterId,
      endClusterId: walked.endClusterId,
      metrics: {
        segmentCount: walked.refs.length,
        cutLength: pathCutLength(walked.refs, segmentsById),
        gapLength
      },
      diagnosticIds
    });
  }

  return { chains, diagnostics };
}

function mapSegmentClusterPairs(
  segments: PathSegment[],
  endpointClusters: EndpointClusterResult
): SegmentClusterPair[] {
  const pairs: SegmentClusterPair[] = [];

  for (const segment of segments) {
    if (segment.kind === 'circle') continue;

    const startClusterId = endpointClusters.endpointToCluster[endpointKey(segment.id, 'start')];
    const endClusterId = endpointClusters.endpointToCluster[endpointKey(segment.id, 'end')];
    if (!startClusterId || !endClusterId) continue;

    pairs.push({
      segmentId: segment.id,
      startClusterId,
      endClusterId
    });
  }

  return pairs;
}

function buildAdjacency(segmentPairs: SegmentClusterPair[]) {
  const adjacency = new Map<EndpointClusterId, IncidentEndpoint[]>();

  const add = (clusterId: EndpointClusterId, incident: IncidentEndpoint) => {
    const incidents = adjacency.get(clusterId) ?? [];
    incidents.push(incident);
    adjacency.set(clusterId, incidents);
  };

  for (const pair of segmentPairs) {
    add(pair.startClusterId, { segmentId: pair.segmentId, side: 'start' });
    add(pair.endClusterId, { segmentId: pair.segmentId, side: 'end' });
  }

  return adjacency;
}

function chooseNextStart(
  unused: Set<SegmentId>,
  pairBySegmentId: Map<SegmentId, SegmentClusterPair>,
  adjacency: Map<EndpointClusterId, IncidentEndpoint[]>
) {
  const candidates = [...unused].sort();

  for (const segmentId of candidates) {
    const pair = requiredPair(pairBySegmentId, segmentId);
    if ((adjacency.get(pair.startClusterId)?.length ?? 0) === 1) {
      return { segmentId, startClusterId: pair.startClusterId };
    }
    if ((adjacency.get(pair.endClusterId)?.length ?? 0) === 1) {
      return { segmentId, startClusterId: pair.endClusterId };
    }
  }

  const segmentId = candidates[0];
  return { segmentId, startClusterId: requiredPair(pairBySegmentId, segmentId).startClusterId };
}

interface WalkState {
  adjacency: Map<EndpointClusterId, IncidentEndpoint[]>;
  pairBySegmentId: Map<SegmentId, SegmentClusterPair>;
  unused: Set<SegmentId>;
  diagnostics: PathDiagnostic[];
  segmentsById: Map<SegmentId, PathSegment>;
}

function walkChain(
  start: { segmentId: SegmentId; startClusterId: EndpointClusterId },
  state: WalkState
) {
  const refs: OrientedSegmentRef[] = [];
  let currentSegmentId = start.segmentId;
  let currentClusterId = start.startClusterId;
  const initialClusterId = start.startClusterId;

  while (state.unused.has(currentSegmentId)) {
    const pair = requiredPair(state.pairBySegmentId, currentSegmentId);
    const ref = orientSegmentFromCluster(pair, currentClusterId);
    refs.push(ref);
    state.unused.delete(currentSegmentId);

    currentClusterId = otherCluster(pair, currentClusterId);

    if (currentClusterId === initialClusterId) break;

    const candidates = (state.adjacency.get(currentClusterId) ?? [])
      .filter((incident) => state.unused.has(incident.segmentId))
      .sort((a, b) => a.segmentId.localeCompare(b.segmentId));

    if (candidates.length === 0) break;

    if (candidates.length > 1) {
      state.diagnostics.push({
        id: `diag_chain_${String(state.diagnostics.length + 1).padStart(4, '0')}`,
        severity: 'warning',
        code: 'branching-topology',
        message: `Multiple unused continuations meet at endpoint cluster ${currentClusterId}; chose the smoothest tangent continuation.`,
        relatedSegmentIds: candidates.map((candidate) => candidate.segmentId),
        relatedClusterIds: [currentClusterId],
        details: { chosenSegmentId: chooseContinuation(candidates, refs, currentClusterId, state).segmentId }
      });
    }

    currentSegmentId = chooseContinuation(candidates, refs, currentClusterId, state).segmentId;
  }

  return {
    refs,
    closed: refs.length > 0 && currentClusterId === initialClusterId,
    startClusterId: initialClusterId,
    endClusterId: currentClusterId
  };
}

function chooseContinuation(
  candidates: IncidentEndpoint[],
  refs: OrientedSegmentRef[],
  currentClusterId: EndpointClusterId,
  state: WalkState
) {
  const previousRef = refs[refs.length - 1];
  if (!previousRef) return candidates[0];
  const previousSegment = requiredSegment(state.segmentsById, previousRef.segmentId);
  const previousTangent = segmentEndTangent(previousSegment, previousRef);

  return candidates
    .map((candidate) => {
      const pair = requiredPair(state.pairBySegmentId, candidate.segmentId);
      const nextRef = orientSegmentFromCluster(pair, currentClusterId);
      const nextSegment = requiredSegment(state.segmentsById, nextRef.segmentId);
      return {
        candidate,
        score: dot(previousTangent, segmentStartTangent(nextSegment, nextRef))
      };
    })
    .sort((a, b) => b.score - a.score || a.candidate.segmentId.localeCompare(b.candidate.segmentId))[0]
    .candidate;
}

function orientSegmentFromCluster(pair: SegmentClusterPair, clusterId: EndpointClusterId): OrientedSegmentRef {
  if (pair.startClusterId === clusterId) return { segmentId: pair.segmentId, reversed: false };
  if (pair.endClusterId === clusterId) return { segmentId: pair.segmentId, reversed: true };
  return { segmentId: pair.segmentId, reversed: false };
}

function otherCluster(pair: SegmentClusterPair, clusterId: EndpointClusterId) {
  return pair.startClusterId === clusterId ? pair.endClusterId : pair.startClusterId;
}

function chainGapLength(
  refs: OrientedSegmentRef[],
  segmentsById: Map<SegmentId, PathSegment>,
  closed: boolean
) {
  let gapLength = 0;

  for (let index = 0; index < refs.length - 1; index++) {
    const current = requiredSegment(segmentsById, refs[index].segmentId);
    const next = requiredSegment(segmentsById, refs[index + 1].segmentId);
    gapLength += distance(orientedSegmentEnd(current, refs[index]), orientedSegmentStart(next, refs[index + 1]));
  }

  if (closed && refs.length > 1) {
    const last = requiredSegment(segmentsById, refs[refs.length - 1].segmentId);
    const first = requiredSegment(segmentsById, refs[0].segmentId);
    gapLength += distance(orientedSegmentEnd(last, refs[refs.length - 1]), orientedSegmentStart(first, refs[0]));
  }

  return gapLength;
}

function requiredPair(pairs: Map<SegmentId, SegmentClusterPair>, segmentId: SegmentId) {
  const pair = pairs.get(segmentId);
  if (!pair) throw new Error(`Segment cluster pair not found: ${segmentId}`);
  return pair;
}

function nextChainId(index: number) {
  return `chain_${String(index + 1).padStart(4, '0')}`;
}

function format(value: number) {
  return Number(value.toFixed(9)).toString();
}
