import { buildChains } from '@/domain/path-intel/chains';
import { endpointKey } from '@/domain/path-intel/segments';
import type { DiagnosticId, EndpointCluster, EndpointClusterId, EndpointClusterResult, PathChain, PathDiagnostic, PathPlanningDocument, SegmentId } from '@/domain/path-intel/types';

function isEndpointDiagnostic(diagnostic: PathDiagnostic) {
  return diagnostic.code === 'endpoint-cluster-snap' || diagnostic.code === 'ambiguous-endpoint-cluster' ||
    diagnostic.code === 'branching-topology' || diagnostic.code === 'open-chain' || diagnostic.code === 'closed-chain-gap';
}

export function preserveEndpointDiagnosticRefs(
  current: Pick<PathChain, 'diagnosticIds'>,
  previous: Pick<PathChain, 'diagnosticIds'>,
  endpointIds: Set<DiagnosticId>
) {
  current.diagnosticIds = [...new Set([...current.diagnosticIds, ...previous.diagnosticIds.filter((id) => endpointIds.has(id))])];
}

// Cluster numbers are positional. Only unanimous surviving endpoint correspondence
// can carry identity across a refresh. Rebuild topology facts, then reconcile ids
// and every stored diagnostic reference instead of trusting generated numbers.
export function refreshEndpointTopologyDiagnostics(
  document: PathPlanningDocument,
  previousClusters: EndpointCluster[],
  clusterResult: EndpointClusterResult
) {
  const successors = new Map<EndpointClusterId, EndpointClusterId[]>();
  for (const cluster of previousClusters) {
    const ids = cluster.members.flatMap(({ segmentId, side }) => {
      const id = clusterResult.endpointToCluster[endpointKey(segmentId, side)];
      return id === undefined ? [] : [id];
    });
    successors.set(cluster.id, [...new Set(ids)]);
  }
  const membersByClusterId = new Map(clusterResult.clusters.map(({ id, members }) =>
    [id, new Set(members.map(({ segmentId, side }) => endpointKey(segmentId, side)))]));
  const changedGroupingSegmentIds = new Set(previousClusters
    .filter((cluster) => {
      const ids = successors.get(cluster.id) ?? [];
      const members = ids.length === 1 ? membersByClusterId.get(ids[0]) : undefined;
      return !members || members.size !== cluster.members.length ||
        cluster.members.some(({ segmentId, side }) => !members.has(endpointKey(segmentId, side)));
    })
    .flatMap(({ members }) => members.map(({ segmentId }) => segmentId)));
  const segmentsById = new Map(document.segments.map((segment) => [segment.id, segment]));
  const descendants = new Map<SegmentId, SegmentId[]>();
  for (const segment of document.segments) {
    const parent = segment.source.edit?.parentSegmentId;
    if (parent) descendants.set(parent, [...(descendants.get(parent) ?? []), segment.id]);
  }
  const currentSegments = (ids: SegmentId[]) => [...new Set(ids.flatMap((id) => segmentsById.has(id) ? [id] : descendants.get(id) ?? []))];
  const currentClusters = (ids: EndpointClusterId[]) => [...new Set(ids.flatMap((id) => successors.get(id) ?? []))];
  const chainsByDiagnosticId = new Map(document.chains.flatMap((chain) => chain.diagnosticIds.map((id) => [id, chain] as const)));
  const rebuilt = [
    ...clusterResult.diagnostics,
    ...buildChains(document.segments, clusterResult, document.options).diagnostics.filter(({ code }) => code === 'branching-topology')
  ];
  const fromRebuiltFamily = ({ code }: PathDiagnostic) =>
    code === 'endpoint-cluster-snap' || code === 'ambiguous-endpoint-cluster' || code === 'branching-topology';
  const previous = document.diagnostics.filter(fromRebuiltFamily);
  const key = (diagnostic: PathDiagnostic, old: boolean): string | null => {
    const clusters = diagnostic.relatedClusterIds;
    if (clusters?.length) {
      const mapped = old ? clusters.map((id) => successors.get(id) ?? []) : clusters.map((id) => [id]);
      if (mapped.some((ids) => ids.length !== 1)) return null;
      const role = diagnostic.code === 'branching-topology' && diagnostic.details?.chosenSegmentId !== undefined ? 'continuation' : 'junction';
      return JSON.stringify([diagnostic.code, role, mapped.flat().sort()]);
    }
    // Ambiguity warnings carry segments rather than cluster ids. Require unchanged
    // endpoint grouping as well, so the same edges cannot silently name a new joint.
    const segmentIds = diagnostic.relatedSegmentIds ?? [];
    if (old && segmentIds.some((id) => !segmentsById.has(id))) return null;
    if (old && segmentIds.some((id) => changedGroupingSegmentIds.has(id))) return null;
    return JSON.stringify([diagnostic.code, [...segmentIds].sort()]);
  };
  const groupByKey = (diagnostics: PathDiagnostic[], old: boolean) => {
    const grouped = new Map<string, PathDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      const identity = key(diagnostic, old);
      if (identity !== null) grouped.set(identity, [...(grouped.get(identity) ?? []), diagnostic]);
    }
    return grouped;
  };
  const oldByKey = groupByKey(previous, true);
  const newByKey = groupByKey(rebuilt, false);
  const reserved = new Set(document.diagnostics.map(({ id }) => id));
  const retained = new Set<DiagnosticId>();
  let counter = 1;
  for (const diagnostic of rebuilt) {
    const identity = key(diagnostic, false);
    const matches = identity === null ? [] : oldByKey.get(identity) ?? [];
    if (identity !== null && matches.length === 1 && newByKey.get(identity)?.length === 1) {
      diagnostic.id = matches[0].id;
      retained.add(diagnostic.id);
    } else {
      let id: string;
      do { id = `diag_endpoint_refresh_${String(counter++).padStart(4, '0')}`; } while (reserved.has(id));
      diagnostic.id = id;
      reserved.add(id);
    }
  }
  const retired = new Set(previous.filter(({ id }) => !retained.has(id)).map(({ id }) => id));
  const kept = document.diagnostics.filter((diagnostic) => !fromRebuiltFamily(diagnostic)).map((diagnostic) => {
    const chain = chainsByDiagnosticId.get(diagnostic.id);
    if (chain && (diagnostic.code === 'open-chain' || diagnostic.code === 'closed-chain-gap')) {
      const clusters = diagnostic.code === 'open-chain' ? [chain.startClusterId, chain.endClusterId] : [chain.startClusterId];
      return {
        ...diagnostic,
        relatedSegmentIds: chain.segmentRefs.map(({ segmentId }) => segmentId),
        relatedClusterIds: clusters.filter((id): id is string => id !== null),
        ...(diagnostic.code === 'closed-chain-gap' ? { details: { ...diagnostic.details, gapLength: chain.metrics.gapLength } } : {})
      };
    }
    return {
      ...diagnostic,
      ...(diagnostic.relatedSegmentIds ? { relatedSegmentIds: currentSegments(diagnostic.relatedSegmentIds) } : {}),
      ...(diagnostic.relatedClusterIds ? { relatedClusterIds: currentClusters(diagnostic.relatedClusterIds) } : {})
    };
  });
  const first = document.diagnostics.findIndex(fromRebuiltFamily);
  kept.splice(first < 0 ? kept.length : first, 0, ...rebuilt);
  document.diagnostics = kept;
  for (const owner of [...document.chains, ...document.contours, ...document.pathElements]) {
    owner.diagnosticIds = owner.diagnosticIds.filter((id) => !retired.has(id));
  }
  const byId = new Map(document.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]));
  document.plan.diagnostics = document.plan.diagnostics.flatMap(({ id }) => {
    const diagnostic = byId.get(id);
    return diagnostic ? [diagnostic] : [];
  });
  return new Set(document.diagnostics.filter(isEndpointDiagnostic).map(({ id }) => id));
}
