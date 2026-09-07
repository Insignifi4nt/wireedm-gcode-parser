import { useMemo } from 'react';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { createUpidProjectRail, type UpidManualDecisionKind, type UpidProjectRail } from '@/domain/upid/projectRail';

export function EditorProjectProvenance({ document }: { document: PathPlanningDocument }) {
  const projectRail = useMemo(() => createUpidProjectRail(document), [document]);
  const endpointTopology = projectRail.summary.topology;
  const sourceSummary = projectRail.summary.source;
  return <details className="mt-3 border-t border-border pt-2">
    <summary className="cursor-pointer text-muted-foreground">Source and topology</summary>
    <p
      className="mt-1 break-words text-muted-foreground"
      data-upid-topology-ambiguous={endpointTopology.ambiguousEndpointClusterCount}
      data-upid-topology-clusters={endpointTopology.endpointClusterCount}
      data-upid-topology-max-gap={endpointTopology.maxEndpointSnapGap.toFixed(3)}
      data-upid-topology-snapped={endpointTopology.snappedEndpointClusterCount}
      data-upid-topology-snapped-endpoints={endpointTopology.snappedEndpointCount}
      data-upid-topology-summary
    >
      Topology: {endpointTopology.endpointClusterCount} clusters / snapped{' '}
        {endpointTopology.snappedEndpointClusterCount} / max gap {endpointTopology.maxEndpointSnapGap.toFixed(3)} mm
      {endpointTopology.ambiguousEndpointClusterCount > 0 && (
        <> / ambiguous {endpointTopology.ambiguousEndpointClusterCount}</>
      )}
    </p>
    <p
      className="mt-1 text-[10px] text-muted-foreground"
    >
      {formatPathManualDecisionCount(projectRail.summary.manualDecisionCount)}
      {projectRail.summary.manualDecisionCount > 0 && (
        <span className="block">
          {formatPathManualDecisionBreakdown(projectRail.summary.manualDecisionCounts)}
        </span>
      )}
    </p>
    <p
      className="mt-1 break-words text-muted-foreground"
    >
      {formatProjectSourceSummary(sourceSummary)}
      <span className="block">Layers: {formatSourceLayers(sourceSummary.layers) || 'None'}</span>
    </p>

  </details>;
}

function formatPathManualDecisionCount(count: number) {
  if (count <= 0) return 'Automatic path plan';
  return `${count} manual ${count === 1 ? 'decision' : 'decisions'}`;
}

function formatPathManualDecisionBreakdown(counts: Record<UpidManualDecisionKind, number>) {
  return Object.entries(counts).filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind} ${count}`).join(' / ');
}

function formatProjectSourceSummary(source: UpidProjectRail['summary']['source']) {
  const parts = [
    `Source: ${formatCount(source.entityCount, 'entity')} / ${formatCount(source.segmentCount, 'segment')} / ${formatCount(source.layerCount, 'layer')}`
  ];

  if (source.blockNames.length > 0) {
    parts.push(`blocks ${source.blockNames.join(', ')}`);
  }

  if (source.insertBlockNames.length > 0) {
    parts.push(`inserts ${source.insertBlockNames.join(', ')}`);
  }

  if (source.approximatedSegmentCount > 0 || source.editedSegmentCount > 0) {
    parts.push(
      `exact ${source.exactSegmentCount} / approx ${source.approximatedSegmentCount} / edits ${source.editedSegmentCount}`
    );
  }

  return parts.join(' / ');
}

function formatCount(count: number, singular: string) {
  const plural = singular === 'entity' ? 'entities' : `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSourceLayers(layers: Array<string | null>) {
  return layers.map((layer) => layer ?? '-').join(', ');
}
